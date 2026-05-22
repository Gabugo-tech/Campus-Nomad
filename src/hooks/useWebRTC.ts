import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export type CallState = 'idle' | 'outgoing' | 'incoming' | 'active';
export type CallType = 'voice' | 'video';
export type ConnectionStatus = 'connecting' | 'ringing' | 'connected' | 'ended' | 'disconnected' | 'failed';

interface WebRTCConfig {
  socketUrl?: string;
  userId: string;
  userName: string;
  userAvatar: string;
}

export function useWebRTC(roomId: string, config: WebRTCConfig) {
  const { socketUrl, userId, userName, userAvatar } = config;
  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<CallType>('voice');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [callerDetails, setCallerDetails] = useState<any>(null);
  const [callTimer, setCallTimer] = useState(0);
  const [ping, setPing] = useState<number | null>(null);

  // Monitor active session stats and latency (ping)
  useEffect(() => {
    let pingInterval: any;
    if (callState === 'active') {
      pingInterval = setInterval(async () => {
        const pc = peerConnectionRef.current;
        if (pc) {
          try {
            const stats = await pc.getStats();
            stats.forEach(report => {
              if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                const rtt = report.currentRoundTripTime;
                if (rtt !== undefined) {
                  setPing(Math.round(rtt * 1000));
                }
              }
            });
          } catch (err) {
            console.warn("Could not query RTCPeerConnection stats in hook:", err);
          }
        }
      }, 2005);
    } else {
      setPing(null);
    }
    return () => clearInterval(pingInterval);
  }, [callState]);

  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const originalVideoTrackRef = useRef<MediaStreamTrack | null>(null);

  // Fallback Google STUN configuration as request
  const iceConfiguration: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Connect socket on load
  useEffect(() => {
    const url = socketUrl || window.location.origin;
    const socket = io(url, {
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.on('connect_error', (error) => {
      console.warn("Socket.io hook connection error (silenced):", error.message);
    });

    socket.emit('join-user-room', userId);

    socket.on('incoming-call', (data) => {
      setCallState('incoming');
      setCallType(data.callType);
      setCallerDetails(data);
      setConnectionStatus('ringing');
    });

    socket.on('call-accepted', async (data) => {
      setCallState('active');
      setCallTimer(0);
      setConnectionStatus('connecting');
      
      const stream = localStreamRef.current;
      if (stream) {
        initPeerConnection(stream, data.receiverId, true);
      }
    });

    socket.on('call-rejected', () => {
      setConnectionStatus('ended');
      setTimeout(() => {
        cleanup();
      }, 1500);
    });

    socket.on('call-ended', () => {
      setConnectionStatus('ended');
      setTimeout(() => {
        cleanup();
      }, 1500);
    });

    socket.on('webrtc-signal', async (data) => {
      const pc = peerConnectionRef.current;
      if (!pc) return;
      try {
        if (data.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('webrtc-signal', {
            targetId: data.senderId,
            senderId: userId,
            type: 'answer',
            answer: pc.localDescription
          });
        } else if (data.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.type === 'candidate') {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.error("WebRTC processing signal error:", err);
      }
    });

    return () => {
      socket.disconnect();
      cleanup();
    };
  }, [roomId, userId]);

  // Manage call subscription duration timer
  useEffect(() => {
    let interval: any;
    if (callState === 'active') {
      interval = setInterval(() => {
        setCallTimer(prev => prev + 1);
      }, 1000);
    } else {
      setCallTimer(0);
    }
    return () => clearInterval(interval);
  }, [callState]);

  const initPeerConnection = (stream: MediaStream, otherPartyId: string, isCaller: boolean) => {
    try {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      const pc = new RTCPeerConnection(iceConfiguration);
      peerConnectionRef.current = pc;

      // Attach tracks
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Handle remote track arriving
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
          setConnectionStatus('connected');
        }
      };

      // Handle candidate exchange
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current?.emit('webrtc-signal', {
            targetId: otherPartyId,
            senderId: userId,
            type: 'candidate',
            candidate: event.candidate
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const handleHookWebRTCReconnect = () => {
          console.warn("RTCPeerConnection state dropped in hook. Triggering automatic iceRestart renegotiation...");
          pc.createOffer({ iceRestart: true })
            .then(async (offer) => {
              await pc.setLocalDescription(offer);
              socketRef.current?.emit('webrtc-signal', {
                targetId: otherPartyId,
                senderId: userId,
                type: 'offer',
                offer: pc.localDescription
              });
            })
            .catch(err => console.error("WebRTC hook re-negotiation offer creation failed:", err));
        };

        switch (pc.connectionState) {
          case 'connected':
            setConnectionStatus('connected');
            break;
          case 'disconnected':
            setConnectionStatus('disconnected');
            handleHookWebRTCReconnect();
            break;
          case 'failed':
            setConnectionStatus('failed');
            handleHookWebRTCReconnect();
            break;
          case 'closed':
            setConnectionStatus('ended');
            break;
          default:
            break;
        }
      };

      // If caller, send session draft offer
      if (isCaller) {
        pc.createOffer()
          .then(async (offer) => {
            await pc.setLocalDescription(offer);
            socketRef.current?.emit('webrtc-signal', {
              targetId: otherPartyId,
              senderId: userId,
              type: 'offer',
              offer: pc.localDescription
            });
          })
          .catch(err => console.error("Creating session offer error:", err));
      }
    } catch (error) {
      console.error("PeerConnection initiation failed:", error);
    }
  };

  const startCall = async (type: CallType, receiverId: string, receiverName: string, receiverAvatar: string) => {
    setCallType(type);
    setCallState('outgoing');
    setConnectionStatus('connecting');

    const constraints = {
      video: type === 'video',
      audio: true
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);
      localStreamRef.current = stream;
      if (stream.getVideoTracks().length > 0) {
        originalVideoTrackRef.current = stream.getVideoTracks()[0];
      }

      const callPayload = {
        callerId: userId,
        callerName: userName,
        callerAvatar: userAvatar,
        receiverId,
        callType: type,
        roomId
      };

      setCallerDetails({ callerId: userId, callerName: receiverName, callerAvatar: receiverAvatar, receiverId, callType: type });
      socketRef.current?.emit('call-user', callPayload);
    } catch (err) {
      console.error("Accessing MediaStream device failed:", err);
      setConnectionStatus('failed');
      setTimeout(() => setCallState('idle'), 2000);
    }
  };

  const acceptCall = async () => {
    if (!callerDetails) return;
    setCallState('active');
    setConnectionStatus('connecting');

    const constraints = {
      video: callType === 'video',
      audio: true
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);
      localStreamRef.current = stream;
      if (stream.getVideoTracks().length > 0) {
        originalVideoTrackRef.current = stream.getVideoTracks()[0];
      }

      socketRef.current?.emit('accept-call', {
        callerId: callerDetails.callerId,
        receiverId: userId
      });

      // Initialise receiver peer connection
      initPeerConnection(stream, callerDetails.callerId, false);
    } catch (error) {
      console.error("Media permission check failed on accept:", error);
      socketRef.current?.emit('reject-call', {
        callerId: callerDetails.callerId,
        receiverId: userId
      });
      cleanup();
    }
  };

  const declineCall = () => {
    if (!callerDetails) return;
    socketRef.current?.emit('reject-call', {
      callerId: callerDetails.callerId,
      receiverId: userId
    });
    cleanup();
  };

  const endCall = () => {
    const otherId = callerDetails?.callerId === userId ? callerDetails?.receiverId : callerDetails?.callerId;
    if (otherId) {
      socketRef.current?.emit('end-call', { otherPartyId: otherId });
    }
    cleanup();
  };

  const toggleMic = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setMicMuted(!micMuted);
    }
  };

  const toggleCamera = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setCameraOff(!cameraOff);
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        
        if (peerConnectionRef.current) {
          const senders = peerConnectionRef.current.getSenders();
          const videoSender = senders.find(sender => sender.track?.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(screenTrack);
          }
        }

        screenTrack.onended = () => {
          stopScreenShare();
        };

        setIsScreenSharing(true);
      } catch (err) {
        console.warn("Screen share declined or failed:", err);
      }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = () => {
    if (originalVideoTrackRef.current && peerConnectionRef.current) {
      const senders = peerConnectionRef.current.getSenders();
      const videoSender = senders.find(sender => sender.track?.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(originalVideoTrackRef.current);
      }
    }
    setIsScreenSharing(false);
  };

  const cleanup = () => {
    setCallState('idle');
    setConnectionStatus('connecting');
    setCallTimer(0);
    setCallerDetails(null);
    setMicMuted(false);
    setCameraOff(false);
    setIsScreenSharing(false);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
  };

  return {
    callState,
    callType,
    connectionStatus,
    localStream,
    remoteStream,
    micMuted,
    cameraOff,
    isScreenSharing,
    callerDetails,
    callTimer,
    ping,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMic,
    toggleCamera,
    toggleScreenShare
  };
}
