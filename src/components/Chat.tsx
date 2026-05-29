import { useState, useEffect, useRef } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, limit, doc, where, getDocs, updateDoc, deleteDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Image, Search, Info, Phone, Video, Users, CheckCheck, Check, Ban, MoreVertical, Globe, X, ExternalLink, UserPlus, PhoneOff, PhoneCall, Volume2, Camera, CameraOff, VolumeX, ArrowLeft, Lock, Heart, Bell, MessageCircle, AlertTriangle, Loader2, Mic, MicOff, Calendar, Clock } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { format, formatDistanceToNow } from 'date-fns';
import { logActivity } from '../lib/activity';
import { VerificationBadge } from './VerificationBadge';
import { encryptText, decryptText } from '../lib/crypto';
import CallInterface from './CallInterface';

export default function Chat() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [activeChat, setActiveChat] = useState<string>('');
  const [selectedReceiver, setSelectedReceiver] = useState<any | null>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [typing, setTyping] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const typingTimeoutRef = useRef<any>(null);
  
  // Real-time Calling States
  const [callState, setCallState] = useState<'idle' | 'outgoing' | 'incoming' | 'active'>('idle');
  const [callType, setCallType] = useState<'voice' | 'video'>('voice');
  const [callerDetails, setCallerDetails] = useState<any>(null);
  const [callTimer, setCallTimer] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'ringing' | 'connected' | 'ended' | 'disconnected' | 'failed'>('connecting');
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [ping, setPing] = useState<number | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Friends & Navigation Directory tabs
  const [sidebarTab, setSidebarTab] = useState<'chats' | 'friends' | 'calls'>('chats');
  const [friendships, setFriendships] = useState<any[]>([]);
  const [missedCalls, setMissedCalls] = useState<any[]>([]);
  const [intrusiveNotifications, setIntrusiveNotifications] = useState<any[]>([]);

  // CallLog Entity and History States
  interface CallLog {
    id: string;
    callerId: string;
    callerName: string;
    receiverId: string;
    receiverName?: string;
    callType: 'voice' | 'video';
    status: 'missed' | 'accepted' | 'declined' | 'pending';
    createdAt: any;
    duration?: number;
  }
  const [callHistory, setCallHistory] = useState<CallLog[]>([]);

  // Listen to all call logs for history (outgoing and incoming) in real-time
  useEffect(() => {
    if (!auth.currentUser) return;
    
    const uid = auth.currentUser.uid;
    const qOutgoing = query(
      collection(db, 'missed_calls'),
      where('callerId', '==', uid)
    );
    const qIncoming = query(
      collection(db, 'missed_calls'),
      where('receiverId', '==', uid)
    );

    const updateHistory = (outgoingDocs: any[], incomingDocs: any[]) => {
      const combined = [...outgoingDocs, ...incomingDocs];
      const seen = new Set<string>();
      const unique = combined.filter(d => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      });

      const mapped: CallLog[] = unique.map(doc => {
        const data = doc.data ? doc.data() : doc;
        return {
          id: doc.id,
          callerId: data.callerId,
          callerName: data.callerName || 'Student',
          receiverId: data.receiverId,
          receiverName: data.receiverName || 'Student',
          callType: data.callType || 'voice',
          status: data.status || 'missed',
          createdAt: data.createdAt,
          duration: data.duration !== undefined ? data.duration : (data.status === 'accepted' ? 45 : 0)
        };
      });

      mapped.sort((a, b) => {
        const timeA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
        const timeB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
        return timeB - timeA;
      });

      setCallHistory(mapped);
    };

    let outgoingList: any[] = [];
    let incomingList: any[] = [];

    const unsubOutgoing = onSnapshot(qOutgoing, (snap) => {
      outgoingList = snap.docs;
      updateHistory(outgoingList, incomingList);
    });

    const unsubIncoming = onSnapshot(qIncoming, (snap) => {
      incomingList = snap.docs;
      updateHistory(outgoingList, incomingList);
    });

    return () => {
      unsubOutgoing();
      unsubIncoming();
    };
  }, [auth.currentUser]);

  // Listen to unacknowledged missed calls targeting current user
  useEffect(() => {
    if (!auth.currentUser) return;
    const path = 'missed_calls';
    const q = query(
      collection(db, path),
      where('receiverId', '==', auth.currentUser.uid),
      where('status', '==', 'missed'),
      where('acknowledged', '==', false)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMissedCalls(list);
    }, (error) => {
      console.error("Failed to load missed calls inside Chat component:", error);
    });
    return unsubscribe;
  }, [auth.currentUser]);

  // WebRTC Sandbox MediaStream state for local video preview
  const [localStream, _setLocalStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const setLocalStream = (stream: MediaStream | null) => {
    _setLocalStream(stream);
    localStreamRef.current = stream;
  };
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const [isRecipientOffline, setIsRecipientOffline] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Group call mesh connection states
  const [remoteStreams, setRemoteStreams] = useState<{
    [userId: string]: {
      stream: MediaStream;
      userName: string;
      userAvatar?: string;
    };
  }>({});
  const groupPeerConnectionsRef = useRef<{ [userId: string]: RTCPeerConnection }>({});

  // Image sharing states
  const [selectedImageBase64, setSelectedImageBase64] = useState<string | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  const socketRef = useRef<Socket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeChatRef = useRef(activeChat);
  const activeCallDocIdRef = useRef<string | null>(null);

  // Dynamic Blocking Lists
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [usersWhoBlockedMe, setUsersWhoBlockedMe] = useState<string[]>([]);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);

  // Listen to blocks in real time
  useEffect(() => {
    if (!auth.currentUser) return;
    const qMyBlocks = query(collection(db, 'blocks'), where('blockerId', '==', auth.currentUser.uid));
    const unsubMyBlocks = onSnapshot(qMyBlocks, (snap) => {
      setBlockedUserIds(snap.docs.map(doc => doc.data().blockedId));
    }, (error) => {
      console.error("Failed to fetch blocked users:", error);
    });

    const qBlocksMe = query(collection(db, 'blocks'), where('blockedId', '==', auth.currentUser.uid));
    const unsubBlocksMe = onSnapshot(qBlocksMe, (snap) => {
      setUsersWhoBlockedMe(snap.docs.map(doc => doc.data().blockerId));
    }, (error) => {
      console.error("Failed to fetch blocker users:", error);
    });

    return () => {
      unsubMyBlocks();
      unsubBlocksMe();
    };
  }, [auth.currentUser]);

  const toggleBlockUser = async (targetId: string, targetName: string) => {
    if (!auth.currentUser) return;
    const isBlocked = blockedUserIds.includes(targetId);

    if (isBlocked) {
      try {
        const q = query(
          collection(db, 'blocks'),
          where('blockerId', '==', auth.currentUser.uid),
          where('blockedId', '==', targetId)
        );
        const snap = await getDocs(q);
        const deletePromises = snap.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        logActivity(`Unblocked ${targetName}`);
        alert(`Successfully unblocked ${targetName}`);
      } catch (err) {
        console.error("Unblocking failed:", err);
      }
    } else {
      if (window.confirm(`Are you sure you want to block ${targetName}? You will not receive messages from each other.`)) {
        try {
          await addDoc(collection(db, 'blocks'), {
            blockerId: auth.currentUser.uid,
            blockedId: targetId,
            createdAt: serverTimestamp()
          });
          logActivity(`Blocked student ${targetName}`);
          alert(`Successfully blocked ${targetName}`);
          if (selectedReceiver?.uid === targetId) {
            setSelectedReceiver(null);
            setActiveChat('');
          }
        } catch (err) {
          console.error("Blocking failed:", err);
        }
      }
    }
  };

  const deleteChatHistory = async () => {
    if (!activeChat) return;
    const confirmClear = window.confirm("Are you sure you want to permanently clear all messages in this 1-to-1 conversation? This action cannot be undone.");
    if (!confirmClear) return;
    try {
      const q = query(collection(db, 'chats', activeChat, 'messages'));
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, 'chats', activeChat, 'messages', d.id)));
      await Promise.all(deletePromises);
      setMessages([]);
      alert("All conversation messages cleared successfully!");
    } catch (err) {
      console.error("Failed to delete chat history:", err);
      alert("Failed to clear chat history. Please try again.");
    }
  };

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  // Real-time listener for registered users
  useEffect(() => {
    if (!auth.currentUser) return;
    const path = 'users';
    const qUsers = query(collection(db, path), limit(150));
    const unsubscribe = onSnapshot(qUsers, (snapshot) => {
      const list = snapshot.docs
        .map(doc => ({ uid: doc.id, ...doc.data() }))
        .filter((u: any) => u.uid !== auth.currentUser?.uid);
      setStudents(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
    return unsubscribe;
  }, [auth.currentUser]);

  // Listen to friendships in real-time
  useEffect(() => {
    if (!auth.currentUser) return;
    const path = 'friendships';
    
    const q1 = query(collection(db, path), where('user1Id', '==', auth.currentUser.uid));
    const unsub1 = onSnapshot(q1, (snap1) => {
      const list = snap1.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFriendships(prev => {
        const remaining = prev.filter(item => item.user1Id !== auth.currentUser?.uid);
        return [...remaining, ...list];
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    const q2 = query(collection(db, path), where('user2Id', '==', auth.currentUser.uid));
    const unsub2 = onSnapshot(q2, (snap2) => {
      const list = snap2.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFriendships(prev => {
        const remaining = prev.filter(item => item.user2Id !== auth.currentUser?.uid);
        return [...remaining, ...list];
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [auth.currentUser]);

  // Listen to comments and likes on posts and reels in real-time
  useEffect(() => {
    if (!auth.currentUser) return;
    const mountTime = Date.now();

    const qNotifications = query(
      collection(db, 'feed_notifications'),
      where('receiverId', '==', auth.currentUser.uid),
      where('seen', '==', false)
    );

    const unsubscribe = onSnapshot(qNotifications, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const docData = change.doc.data();
          const docId = change.doc.id;
          
          // Only show as intrusive/pop-up notification if it was created after mount or around now
          const docTime = docData.createdAt?.toDate ? docData.createdAt.toDate().getTime() : Date.now();
          
          if (docTime >= mountTime - 10000 && docData.senderId !== auth.currentUser?.uid) {
            const actionWord = docData.type === 'like' ? 'liked your post/reel' : 'commented on your post/reel';
            const detail = docData.commentText || docData.postContent || '';
            const truncDetail = detail.length > 50 ? detail.substring(0, 50) + '...' : detail;
            const titleText = docData.type === 'like' ? '❤️ New Activity' : '💬 New Activity';
            
            setIntrusiveNotifications(prev => {
              if (prev.some(n => n.id === docId)) return prev;
              return [
                {
                  id: docId,
                  type: docData.type,
                  title: titleText,
                  description: `${docData.senderName} ${actionWord}: "${truncDetail}"`,
                  senderName: docData.senderName,
                  senderAvatar: docData.senderAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${docData.senderName}`,
                  metadata: { docId, ...docData }
                },
                ...prev
              ];
            });
          }
        }
      });
    });

    return unsubscribe;
  }, [auth.currentUser]);

  // Socket.io initialization and dynamic calling handshakes
  useEffect(() => {
    const socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });
    socketRef.current = socket;

    const joinRoom = () => {
      if (auth.currentUser) {
        socket.emit('join-user-room', auth.currentUser.uid);
      }
    };

    joinRoom();

    socket.on('connect', () => {
      console.log('Socket.io connected successfully!');
      joinRoom();
    });

    socket.on('reconnect', (attempt) => {
      console.log('Socket.io reconnected after attempts:', attempt);
      joinRoom();
    });

    socket.on('connect_error', (error) => {
      console.warn("Socket.io connection error, automatically retrying transport fallback:", error);
    });
    
    socket.on('receive-message', (data) => {
      if (data.chatId === activeChatRef.current) {
        setMessages(prev => {
          const isDuplicate = prev.some(m => m.id === data.id || (m.senderId === data.senderId && m.text === data.text && Math.abs(new Date(m.createdAt).getTime() - new Date(data.createdAt).getTime()) < 2000));
          if (isDuplicate) return prev;
          return [...prev, { ...data, createdAt: new Date() }];
        });
      }
    });

    socket.on('receive-message-notification', (data) => {
      if (data.chatId !== activeChatRef.current && data.senderId !== auth.currentUser?.uid) {
        const decrypted = data.isEncrypted ? decryptText(data.text, data.chatId) : data.text;
        const sampleText = decrypted || (data.imageUrl ? "Sent an image" : "New message");
        const notifId = 'msg-' + (data.id || Date.now());
        setIntrusiveNotifications(prev => {
          if (prev.some(n => n.id === notifId)) return prev;
          return [
            {
              id: notifId,
              type: 'new-message',
              title: `💬 New Message`,
              description: `From ${data.senderName}: "${sampleText}"`,
              senderName: data.senderName,
              senderAvatar: data.senderAvatar,
              metadata: data
            },
            ...prev
          ];
        });
      }
    });

    socket.on('user-typing', (data) => {
      if (data.chatId === activeChatRef.current && data.userId !== auth.currentUser?.uid) {
        setTyping(true);
        setTypingUser(data.userName || "Someone");
        
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
        typingTimeoutRef.current = setTimeout(() => {
          setTyping(false);
          setTypingUser(null);
        }, 3000);
      }
    });

    // Real-time telepathy handshakes for calling
    socket.on('incoming-call', (data) => {
      setCallState('incoming');
      setCallType(data.callType);
      setCallerDetails(data);
      setConnectionStatus('ringing');

      const notifId = 'call-' + Date.now();
      setIntrusiveNotifications(prev => [
        {
          id: notifId,
          type: 'incoming-call',
          title: `📞 Incoming ${data.callType === 'video' ? 'Video' : 'Voice'} Call`,
          description: `${data.callerName} is calling you right now.`,
          senderName: data.callerName,
          senderAvatar: data.callerAvatar,
          metadata: data
        },
        ...prev
      ]);
    });

    socket.on('call-accepted', (data) => {
      setCallState('active');
      setCallTimer(0);
      setConnectionStatus('connecting');
      if (activeCallDocIdRef.current) {
        updateDoc(doc(db, 'missed_calls', activeCallDocIdRef.current), { status: 'accepted' })
          .catch(err => console.error(err));
      }
      
      // Notify group call room to dynamically wire mesh connections
      socket.emit("join-group-call-room", {
        roomId: activeChatRef.current || 'global-room',
        userId: auth.currentUser?.uid,
        userName: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Student',
        userAvatar: auth.currentUser?.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser?.email}`
      });

      // Initiate local camera/mic stream
      navigator.mediaDevices.getUserMedia({ video: data.callType === 'video' || callType === 'video', audio: true })
        .then(stream => {
          setLocalStream(stream);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
          const otherId = data.receiverId || selectedReceiver?.uid;
          if (otherId) {
            initWebRTCPeerConnection(stream, otherId, true);
          }
        })
        .catch(err => console.warn("Camera/microphone streaming sandboxed or rejected:", err));
    });

    socket.on('call-timestamp-sync', (data) => {
      if (data && data.startTime) {
        setCallStartTime(data.startTime);
      }
    });

    socket.on("user-joined-group-call", (data) => {
      console.log("Group call participant joined:", data.userName);
      const stream = localStreamRef.current;
      if (stream) {
        initGroupPeerConnection(stream, data.userId, data.userName, true);
      }
    });

    socket.on("user-left-group-call", (data) => {
      console.log("Group call participant left:", data.userId);
      const peerId = data.userId;
      if (groupPeerConnectionsRef.current[peerId]) {
        groupPeerConnectionsRef.current[peerId].close();
        delete groupPeerConnectionsRef.current[peerId];
      }
      setRemoteStreams(prev => {
        const copy = { ...prev };
        delete copy[peerId];
        return copy;
      });
    });

    socket.on('webrtc-signal', async (data) => {
      // Mesh/Group Call handler
      if (data.senderId && data.senderId !== auth.currentUser?.uid) {
        let pc = groupPeerConnectionsRef.current[data.senderId];
        if (!pc) {
          const stream = localStreamRef.current;
          if (data.type === 'offer' && stream) {
            pc = initGroupPeerConnection(stream, data.senderId, data.senderName || "Student", false);
          }
        }

        if (pc) {
          try {
            if (data.type === 'offer') {
              await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              socket.emit('webrtc-signal', {
                targetId: data.senderId,
                senderId: auth.currentUser?.uid,
                senderName: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0],
                type: 'answer',
                answer: pc.localDescription
              });
            } else if (data.type === 'answer') {
              await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            } else if (data.type === 'candidate') {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
            return; // Swallowed by group handler
          } catch (meshErr) {
            console.error("Group WebRTC mesh signal processing failed:", meshErr);
          }
        }
      }

      // 1-on-1 peer connection legacy fallback
      const pc = peerConnectionRef.current;
      if (!pc) return;
      try {
        if (data.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('webrtc-signal', {
            targetId: data.senderId,
            senderId: auth.currentUser?.uid,
            type: 'answer',
            answer: pc.localDescription
          });
        } else if (data.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.type === 'candidate') {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.error("WebRTC handling signaling request failed:", err);
      }
    });

    socket.on('call-rejected', () => {
      setConnectionStatus('ended');
      setTimeout(() => {
        setCallState('idle');
        setCallerDetails(null);
        stopMediaTracks();
      }, 1500);
    });

    socket.on('call-ended', () => {
      setConnectionStatus('ended');
      setTimeout(() => {
        setCallState('idle');
        setCallerDetails(null);
        stopMediaTracks();
      }, 1500);
    });

    return () => {
      socket.disconnect();
      stopMediaTracks();
    };
  }, [callType]);

  // Handle autoAccept from background notification redirect
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const autoAccept = urlParams.get('autoAccept');
    const incomingCallType = urlParams.get('callType') as 'voice' | 'video';
    const cid = urlParams.get('callerId');
    const cname = urlParams.get('callerName');
    const cavatar = urlParams.get('callerAvatar');

    if (autoAccept === 'true' && cid && incomingCallType) {
      const details = {
        callerId: cid,
        callerName: decodeURIComponent(cname || "Student"),
        callerAvatar: decodeURIComponent(cavatar || ""),
        callType: incomingCallType
      };

      setCallType(incomingCallType);
      setCallerDetails(details);
      setCallState('active');
      setConnectionStatus('connecting');

      // Crucial: emit accept-call to the signaling server
      socketRef.current?.emit('accept-call', {
        callerId: cid,
        receiverId: auth.currentUser?.uid,
        callType: incomingCallType
      });

      // Fetch dynamic streaming instantly
      navigator.mediaDevices.getUserMedia({ video: incomingCallType === 'video', audio: true })
        .then(stream => {
          setLocalStream(stream);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
          initWebRTCPeerConnection(stream, cid, true);
        })
        .catch(err => console.warn("Camera streaming error on autoAccept:", err));

      // Clean query params from URL gracefully
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [students, socketRef.current]);

  // Manage Call active timer
  useEffect(() => {
    let timerInterval: any;
    if (callState === 'active') {
      timerInterval = setInterval(() => {
        if (callStartTime) {
          setCallTimer(Math.floor((Date.now() - callStartTime) / 1000));
        } else {
          setCallTimer(prev => prev + 1);
        }
      }, 1000);
    } else {
      setCallTimer(0);
    }
    return () => clearInterval(timerInterval);
  }, [callState, callStartTime]);

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
            console.warn("Could not query RTCPeerConnection stats:", err);
          }
        }
      }, 2000);
    } else {
      setPing(null);
    }
    return () => clearInterval(pingInterval);
  }, [callState]);

  const initGroupPeerConnection = (stream: MediaStream, otherId: string, otherName: string, isCaller: boolean) => {
    try {
      if (groupPeerConnectionsRef.current[otherId]) {
        groupPeerConnectionsRef.current[otherId].close();
      }

      console.log(`Setting up new mesh peer connection for classmate: ${otherName} (ID: ${otherId})`);
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      groupPeerConnectionsRef.current[otherId] = pc;

      // Handle connection status changes
      pc.oniceconnectionstatechange = () => {
        console.log(`Mesh connection state with student ${otherId} changed to: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setConnectionStatus('connected');
        }
      };

      // Add local audio and video tracks to this peer
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Track received remote streams for this peer
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          console.log(`Received active video track for student: ${otherName}`);
          setRemoteStreams(prev => ({
            ...prev,
            [otherId]: {
              stream: event.streams[0],
              userName: otherName
            }
          }));
        }
      };

      // Emit ICE candidates back to classmate
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('webrtc-signal', {
            targetId: otherId,
            senderId: auth.currentUser?.uid,
            senderName: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0],
            type: 'candidate',
            candidate: event.candidate
          });
        }
      };

      if (isCaller) {
        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer))
          .then(() => {
            socketRef.current?.emit('webrtc-signal', {
              targetId: otherId,
              senderId: auth.currentUser?.uid,
              senderName: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0],
              type: 'offer',
              offer: pc.localDescription
            });
          })
          .catch(err => console.error("Mesh Offer construction failed:", err));
      }

      return pc;
    } catch (e) {
      console.error("Critical: Failed to build group RTCPeerConnection:", e);
      throw e;
    }
  };

  const initWebRTCPeerConnection = (stream: MediaStream, otherId: string, isCaller: boolean) => {
    try {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      peerConnectionRef.current = pc;

      // Track connection status changes
      const handleWebRTCReconnect = () => {
        console.warn("RTCPeerConnection dropped. Triggering automatic re-negotiation with iceRestart: true...");
        pc.createOffer({ iceRestart: true })
          .then(async (offer) => {
            await pc.setLocalDescription(offer);
            socketRef.current?.emit('webrtc-signal', {
              targetId: otherId,
              senderId: auth.currentUser?.uid,
              type: 'offer',
              offer: pc.localDescription
            });
          })
          .catch(err => console.error("WebRTC re-negotiation failed:", err));
      };

      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState;
        console.log("WebRTC iceConnectionState change:", iceState);
        if (iceState === 'checking') {
          setConnectionStatus('connecting');
        } else if (iceState === 'connected' || iceState === 'completed') {
          setConnectionStatus('connected');
        } else if (iceState === 'disconnected') {
          setConnectionStatus('disconnected');
          handleWebRTCReconnect();
        } else if (iceState === 'failed') {
          setConnectionStatus('failed');
          handleWebRTCReconnect();
        }
      };

      pc.onconnectionstatechange = () => {
        const connState = pc.connectionState;
        console.log("WebRTC connectionState change:", connState);
        if (connState === 'connecting') {
          setConnectionStatus('connecting');
        } else if (connState === 'connected') {
          setConnectionStatus('connected');
        } else if (connState === 'disconnected') {
          setConnectionStatus('disconnected');
          handleWebRTCReconnect();
        } else if (connState === 'failed') {
          setConnectionStatus('failed');
          handleWebRTCReconnect();
        }
      };

      // Add local tracks
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Track received remote streams
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        }
      };

      // ICE handshake candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('webrtc-signal', {
            targetId: otherId,
            senderId: auth.currentUser?.uid,
            type: 'candidate',
            candidate: event.candidate
          });
        }
      };

      if (isCaller) {
        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer))
          .then(() => {
            socketRef.current?.emit('webrtc-signal', {
              targetId: otherId,
              senderId: auth.currentUser?.uid,
              type: 'offer',
              offer: pc.localDescription
            });
          })
          .catch(err => console.error("WebRTC offer generation status err:", err));
      }
    } catch (e) {
      console.error("Failed to initialize RTCPeerConnection:", e);
    }
  };

  const requestMedia = async (type: 'voice' | 'video') => {
    try {
      const constraints = type === 'video' ? { video: true, audio: true } : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return stream;
    } catch (err: any) {
      console.error("Camera/Mic Media permission error:", err);
      let errMsg = "Microphone or Camera permission was denied, or is not supported by your sandboxed browser.";
      
      const isSafariOrIOS = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
      if (isSafariOrIOS) {
        errMsg += "\n\n💡 Safari/iOS Troubleshooting:\nGo to Settings -> Safari -> Camera (and Microphone), change access to 'Allow', then refresh this tab to apply.";
      } else {
        errMsg += "\n\n💡 Troubleshooting Hint:\nPlease click the media lock/camera icon in your address bar, click 'Allow' or reset permissions, and refresh the browser tab.";
      }
      
      alert(errMsg);
      throw err;
    }
  };

  const stopMediaTracks = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Tear down group mesh peer connections
    Object.keys(groupPeerConnectionsRef.current).forEach(peerId => {
      try {
        groupPeerConnectionsRef.current[peerId].close();
      } catch (e) {
        console.warn("Error closing group peer:", peerId, e);
      }
    });
    groupPeerConnectionsRef.current = {};
    setRemoteStreams({});

    if (socketRef.current && activeChatRef.current) {
      socketRef.current.emit("leave-group-call-room", {
        roomId: activeChatRef.current,
        userId: auth.currentUser?.uid
      });
    }

    setIsRecipientOffline(false);
    setMicMuted(false);
    setCameraOff(false);
  };

  const toggleMic = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setMicMuted(prev => !prev);
    }
  };

  const toggleCamera = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setCameraOff(prev => !prev);
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    if (localStream && peerConnectionRef.current) {
      const videoSender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender && localStream.getVideoTracks()[0]) {
        videoSender.replaceTrack(localStream.getVideoTracks()[0]);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        setIsScreenSharing(true);
        if (peerConnectionRef.current) {
          const videoSender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
          if (videoSender && stream.getVideoTracks()[0]) {
            videoSender.replaceTrack(stream.getVideoTracks()[0]);
          }
        }
        stream.getVideoTracks()[0].onended = () => {
          stopScreenShare();
        };
      } catch (err) {
        console.error("Failed to share screen:", err);
      }
    } else {
      stopScreenShare();
    }
  };

  // Calling action methods
  const startCall = async (type: 'voice' | 'video') => {
    if (!auth.currentUser || !selectedReceiver) return;

    // Check if the user is offline using dynamic online state
    const targetStudent = students.find((s: any) => s.uid === selectedReceiver.uid) || selectedReceiver;
    const isOffline = !targetStudent.online;
    setIsRecipientOffline(isOffline);

    setConnectionStatus('ringing');
    setCallType(type);
    setCallState('outgoing');
    
    const callPayload = {
      callerId: auth.currentUser.uid,
      callerName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Student',
      callerAvatar: auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
      receiverId: selectedReceiver.uid,
      callType: type,
      receiverName: selectedReceiver.displayName || selectedReceiver.email?.split('@')[0] || 'Student',
      receiverAvatar: selectedReceiver.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${selectedReceiver.email}`
    };
    
    setCallerDetails(callPayload);

    if (isOffline) {
      // Direct offline call notification write
      addDoc(collection(db, 'missed_calls'), {
        callerId: auth.currentUser.uid,
        callerName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Student',
        receiverId: selectedReceiver.uid,
        receiverName: selectedReceiver.displayName || selectedReceiver.email?.split('@')[0] || 'Student',
        callType: type,
        status: 'missed',
        createdAt: serverTimestamp(),
        acknowledged: false
      }).catch(err => console.error("Failed to register immediate offline missed call:", err));

      logActivity(`Placed a ${type} call to offline classmate ${targetStudent.displayName || targetStudent.email}`);
    } else {
      socketRef.current?.emit('call-user', callPayload);
      logActivity(`Placed a real-time student ${type} call to ${selectedReceiver.displayName}`);

      addDoc(collection(db, 'missed_calls'), {
        callerId: auth.currentUser.uid,
        callerName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Student',
        receiverId: selectedReceiver.uid,
        receiverName: selectedReceiver.displayName || selectedReceiver.email?.split('@')[0] || 'Student',
        callType: type,
        status: 'pending',
        createdAt: serverTimestamp(),
        acknowledged: false
      }).then(docRef => {
        activeCallDocIdRef.current = docRef.id;
      }).catch(err => console.error("Failed to register outgoing call:", err));
    }

    // Activate media stream
    try {
      const stream = await requestMedia(type);
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Join group call signaling network room immediately
      socketRef.current?.emit("join-group-call-room", {
        roomId: activeChatRef.current || 'global-room',
        userId: auth.currentUser?.uid,
        userName: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Student',
        userAvatar: auth.currentUser?.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser?.email}`
      });
    } catch (err) {
      console.warn("Media activation interrupted:", err);
    }

    // Auto-timeout after 35 seconds if unanswered
    setTimeout(() => {
      setCallState(current => {
        if (current === 'outgoing') {
          alert(`${targetStudent.displayName || 'The student'} did not answer the call.`);
          endActiveCall();
        }
        return current;
      });
    }, 35000);
  };

  const acceptIncomingCall = async () => {
    if (!callerDetails) return;
    socketRef.current?.emit('accept-call', {
      callerId: callerDetails.callerId,
      receiverId: auth.currentUser?.uid,
      callType: callType
    });
    setCallState('active');
    setConnectionStatus('connecting');
    setCallTimer(0);
    logActivity(`Accepted peer ${callType} call connection request`);

    // Mark pending missed call document as accepted
    const q = query(
      collection(db, 'missed_calls'),
      where('callerId', '==', callerDetails.callerId),
      where('receiverId', '==', auth.currentUser?.uid),
      where('status', '==', 'pending')
    );
    getDocs(q).then(snapshot => {
      snapshot.docs.forEach(d => {
        updateDoc(doc(db, 'missed_calls', d.id), { status: 'accepted' });
      });
    }).catch(err => console.error(err));

    // Join group call signaling network room
    socketRef.current?.emit("join-group-call-room", {
      roomId: activeChatRef.current || 'global-room',
      userId: auth.currentUser?.uid,
      userName: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Student',
      userAvatar: auth.currentUser?.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser?.email}`
    });

    try {
      const stream = await requestMedia(callType);
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      initWebRTCPeerConnection(stream, callerDetails.callerId, false);
    } catch (err) {
      console.warn("Media activation during call answer failed:", err);
    }
  };

  const rejectIncomingCall = () => {
    if (!callerDetails) return;
    socketRef.current?.emit('reject-call', {
      callerId: callerDetails.callerId,
      receiverId: auth.currentUser?.uid
    });
    setConnectionStatus('ended');
    setTimeout(() => {
      setCallState('idle');
      setCallerDetails(null);
      stopMediaTracks();
    }, 1500);
    logActivity(`Declined voice/video call handshake.`);

    // Set pending record status to 'missed'
    const q = query(
      collection(db, 'missed_calls'),
      where('callerId', '==', callerDetails.callerId),
      where('receiverId', '==', auth.currentUser?.uid),
      where('status', '==', 'pending')
    );
    getDocs(q).then(snapshot => {
      snapshot.docs.forEach(d => {
        updateDoc(doc(db, 'missed_calls', d.id), { status: 'missed' });
      });
    }).catch(err => console.error(err));
  };

  const endActiveCall = () => {
    if (!callerDetails) return;
    const otherPartyId = callerDetails.callerId === auth.currentUser?.uid ? callerDetails.receiverId : callerDetails.callerId;
    socketRef.current?.emit('end-call', {
      otherPartyId
    });

    // If caller cancels before acceptance, mark call document as missed!
    if (callState === 'outgoing' && activeCallDocIdRef.current) {
      updateDoc(doc(db, 'missed_calls', activeCallDocIdRef.current), { status: 'missed', duration: 0 })
        .catch(err => console.error(err));
    } else if (callState === 'active' && activeCallDocIdRef.current) {
      updateDoc(doc(db, 'missed_calls', activeCallDocIdRef.current), { status: 'accepted', duration: callTimer })
        .catch(err => console.error(err));
    }

    setConnectionStatus('ended');
    setTimeout(() => {
      setCallState('idle');
      setCallerDetails(null);
      stopMediaTracks();
    }, 1500);
    logActivity(`Ended student call channel session.`);
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleAddFriend = async (targetStudent: any) => {
    if (!auth.currentUser) return;
    const isAlreadyFriend = friendships.some(f => 
      (f.user1Id === auth.currentUser?.uid && f.user2Id === targetStudent.uid) ||
      (f.user1Id === targetStudent.uid && f.user2Id === auth.currentUser?.uid)
    );

    if (isAlreadyFriend) {
      alert("This student is already added as a friend!");
      return;
    }

    try {
      await addDoc(collection(db, 'friendships'), {
        user1Id: auth.currentUser.uid,
        user1Name: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0],
        user2Id: targetStudent.uid,
        user2Name: targetStudent.displayName || targetStudent.email?.split('@')[0],
        createdAt: serverTimestamp()
      });
      await logActivity(`Added @${targetStudent.displayName || 'student'} as a friend in real time.`);
      alert(`Success! Handshake completed. Added ${targetStudent.displayName || 'student'} to friends directory.`);
    } catch (err) {
      console.error("Add friendship database write failed:", err);
    }
  };

  // Join designated channel room when activeChat changes
  useEffect(() => {
    if (!auth.currentUser || !activeChat) {
      setMessages([]);
      return;
    }
    if (socketRef.current) {
      socketRef.current.emit('join-chat', activeChat);
    }

    const messagesPath = `chats/${activeChat}/messages`;
    // Subscribe to Firestore changes for current active chat
    const q = query(
      collection(db, 'chats', activeChat, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt && typeof doc.data().createdAt.toDate === 'function' ? doc.data().createdAt.toDate() : new Date()
      }));
      setMessages(msgs);

      // Instantly mark opponent's incoming messages as seen in real-time
      snapshot.docs.forEach((d) => {
        const data = d.data();
        if (data.senderId !== auth.currentUser?.uid && !data.seen) {
          updateDoc(d.ref, { seen: true })
            .catch(err => console.error("Error updating seen state:", err));
        }
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, messagesPath);
    });

    return () => {
      unsubscribe();
    };
  }, [activeChat, auth.currentUser]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImageBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim() && !selectedImageBase64) return;
    if (!auth.currentUser || !activeChat) return;

    const rawText = inputText;
    const encryptedText = rawText ? encryptText(rawText, activeChat) : '';

    const messageData = {
      chatId: activeChat,
      senderId: auth.currentUser.uid,
      senderName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Student',
      senderAvatar: auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email || 'cc'}`,
      text: encryptedText,
      imageUrl: selectedImageBase64 || null,
      isEncrypted: true,
      seen: false,
      createdAt: serverTimestamp()
    };

    // Emit via socket for instant hot-path delivery
    socketRef.current?.emit('send-message', { ...messageData, createdAt: new Date().toISOString() });

    // Persist to Firestore
    try {
      await addDoc(collection(db, 'chats', activeChat, 'messages'), messageData);
      setInputText('');
      setSelectedImageBase64(null);
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const handleTyping = () => {
    socketRef.current?.emit('typing', {
      chatId: activeChat,
      userId: auth.currentUser?.uid,
      userName: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || "Someone"
    });
  };

  // Web Speech API Voice Speech-to-Text Input handler
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript;
          }
        }
        if (transcript) {
          setInputText(prev => prev + (prev ? ' ' : '') + transcript);
          // Emit typing event as they speak
          socketRef.current?.emit('typing', {
            chatId: activeChat,
            userId: auth.currentUser?.uid,
            userName: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || "Someone"
          });
        }
      };

      rec.onerror = (e: any) => {
        console.error("Speech recognition error:", e);
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
    }
  }, [activeChat]);

  const toggleSpeechRecognition = () => {
    if (!recognitionRef.current) {
      alert("Voice Speech-to-Text is not supported or permission denied in this browser.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error("Failed to start speech recognition:", err);
      }
    }
  };

  const handleSelectStudent = async (student: any) => {
    setSelectedReceiver(student);
    const dmRoomId = [auth.currentUser?.uid, student.uid].sort().join('_');
    setActiveChat(dmRoomId);

    // Acknowledge all unacknowledged missed calls from this selected student
    try {
      if (auth.currentUser) {
        const q = query(
          collection(db, 'missed_calls'),
          where('receiverId', '==', auth.currentUser.uid),
          where('callerId', '==', student.uid),
          where('status', '==', 'missed'),
          where('acknowledged', '==', false)
        );
        const snap = await getDocs(q);
        const updatePromises = snap.docs.map(d => updateDoc(doc(db, 'missed_calls', d.id), { acknowledged: true }));
        await Promise.all(updatePromises);
      }
    } catch (err) {
      console.error("Acknowledge calls on select failed:", err);
    }
  };

  const dismissIntrusiveNotification = async (notif: any) => {
    setIntrusiveNotifications(prev => prev.filter(n => n.id !== notif.id));
    
    // If it's a Firestore feed_notification, mark it as seen in DB!
    if ((notif.type === 'like' || notif.type === 'comment') && notif.metadata?.docId) {
      try {
        await updateDoc(doc(db, 'feed_notifications', notif.metadata.docId), { seen: true });
      } catch (err) {
        console.error("Failed to dismiss database feed notification:", err);
      }
    }
  };

  const handleNotificationClick = async (notif: any) => {
    await dismissIntrusiveNotification(notif);
    
    if (notif.type === 'new-message' && notif.metadata?.chatId) {
      const senderId = notif.metadata.senderId;
      const foundStudent = students.find(s => s.uid === senderId);
      if (foundStudent) {
        handleSelectStudent(foundStudent);
      }
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const userIdQuery = params.get('userId');
    if (userIdQuery && students.length > 0) {
      const match = students.find((s: any) => s.uid === userIdQuery);
      if (match) {
        handleSelectStudent(match);
        navigate('/chat', { replace: true });
      }
    }
  }, [students, navigate]);

  const activeStudent = selectedReceiver 
    ? students.find((s: any) => s.uid === selectedReceiver.uid) || selectedReceiver 
    : null;

  const filteredStudents = students.filter(student => {
    if (blockedUserIds.includes(student.uid) || usersWhoBlockedMe.includes(student.uid)) {
      return false;
    }
    const sName = (student.displayName || '').toLowerCase();
    const sEmail = (student.email || '').toLowerCase();
    const queryTerm = searchQuery.toLowerCase();
    return sName.includes(queryTerm) || sEmail.includes(queryTerm);
  });

  const activeFriendships = friendships.filter(f => {
    const friendId = f.user1Id === auth.currentUser?.uid ? f.user2Id : f.user1Id;
    return !blockedUserIds.includes(friendId) && !usersWhoBlockedMe.includes(friendId);
  });

  return (
    <div className="flex h-[calc(100vh-8rem)] lg:gap-6 italic-none bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
      {/* Chat Sidebar */}
      <div className={`flex-col w-full lg:w-80 border-r border-slate-100 shrink-0 ${selectedReceiver ? 'hidden lg:flex' : 'flex'}`}>
        <div className="p-6 border-b border-slate-50">
          <h2 className="text-xl font-black italic-none tracking-tight mb-4">Corridor Deck</h2>
          
          {/* Real-time Dynamic Navigation Tabs */}
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-50 rounded-xl mb-4 text-[10px] sm:text-xs font-bold">
            <button
              onClick={() => setSidebarTab('chats')}
              className={`py-2 px-1 text-center rounded-lg transition-all ${sidebarTab === 'chats' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Chats
            </button>
            <button
              onClick={() => setSidebarTab('friends')}
              className={`py-2 px-1 text-center rounded-lg transition-all ${sidebarTab === 'friends' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Friends ({friendships.length})
            </button>
            <button
              onClick={() => setSidebarTab('calls')}
              className={`py-2 px-1 text-center rounded-lg transition-all ${sidebarTab === 'calls' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              History
            </button>
          </div>

          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={sidebarTab === 'chats' ? "Search students..." : "Search directories..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-150 rounded-xl text-xs font-semibold italic-none focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto italic-none space-y-4 py-4">
          
          {sidebarTab === 'chats' ? (
            <>
              {/* DM Student List Header */}
              <div className="px-6 flex items-center justify-between">
                <span className="text-xs font-mono font-black text-slate-400 uppercase tracking-wider">Active Students ({filteredStudents.length})</span>
              </div>

              <div className="px-3 space-y-1">
                {filteredStudents.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6 italic-none">No students found</p>
                ) : (
                  filteredStudents.map((student) => {
                    const dmId = [auth.currentUser?.uid, student.uid].sort().join('_');
                    const isSelected = activeChat === dmId;
                    const unreadMissed = missedCalls.filter(call => call.callerId === student.uid);
                    const hasMissed = unreadMissed.length > 0;
                    return (
                      <button
                        key={student.uid}
                        onClick={() => handleSelectStudent(student)}
                        className={`w-full p-3.5 flex gap-3 rounded-2xl transition-all ${
                          isSelected
                            ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600 font-bold'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="relative shrink-0">
                          <img 
                            src={student.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${student.email}`} 
                            className="w-11 h-11 rounded-full object-cover border border-slate-100 shadow-xs" 
                            alt="" 
                            referrerPolicy="no-referrer"
                          />
                          {student.online && (
                            <span className="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-green-500 ring-2 ring-white animate-pulse" />
                          )}
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <div className="flex justify-between items-center mb-0.5">
                            <h4 className="font-bold text-sm truncate flex items-center gap-1.5">
                              {student.displayName || student.email?.split('@')[0]}
                              <VerificationBadge email={student.email} verified={student.verified} />
                            </h4>
                            {hasMissed && (
                              <motion.span 
                                animate={{ scale: [1, 1.05, 1] }}
                                transition={{ repeat: Infinity, duration: 2 }}
                                className="px-2 py-0.5 bg-red-500 text-white rounded-full text-[9px] font-black tracking-wider uppercase shrink-0 border border-white flex items-center gap-1 shadow-lg shadow-red-100"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                                Missed
                              </motion.span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 truncate italic-none">
                            @{student.email?.split('@')[0]}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : sidebarTab === 'friends' ? (
            <>
              {/* Friends directory */}
              <div className="px-6">
                <span className="text-xs font-mono font-black text-slate-400 uppercase tracking-wider">My Friends ({activeFriendships.length})</span>
              </div>
              
              <div className="px-3 space-y-1">
                {activeFriendships.length === 0 ? (
                  <p className="text-[11px] text-slate-400/80 text-center py-6">Add friends from the Student hallway below to enable speed dials.</p>
                ) : (
                  activeFriendships.map((f) => {
                    const friendId = f.user1Id === auth.currentUser?.uid ? f.user2Id : f.user1Id;
                    const friendName = f.user1Id === auth.currentUser?.uid ? f.user2Name : f.user1Name;
                    const studentObj = students.find(s => s.uid === friendId);
                    
                    return (
                      <div
                        key={f.id}
                        className="p-3 bg-slate-50/60 hover:bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <div className="relative shrink-0">
                            <img
                              src={studentObj?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${friendName}`}
                              className="w-8 h-8 rounded-full object-cover"
                              alt=""
                            />
                            {studentObj?.online && (
                              <span className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-white animate-pulse" />
                            )}
                          </div>
                          <span className="text-xs font-bold text-slate-800 truncate">{friendName}</span>
                        </div>
                        <button
                          onClick={() => {
                            if (studentObj) {
                              handleSelectStudent(studentObj);
                            } else {
                              // Fallback construct
                              const mockStudent = { uid: friendId, displayName: friendName, avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${friendName}` };
                              handleSelectStudent(mockStudent);
                            }
                          }}
                          className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-mono font-black text-[9px] rounded-lg tracking-wider uppercase transition-all"
                        >
                          Chat
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add Friends Hub */}
              <div className="px-6 pt-2">
                <span className="text-xs font-mono font-black text-slate-400 uppercase tracking-wider">Discover Students</span>
              </div>

              <div className="px-3 space-y-1.5">
                {filteredStudents.slice(0, 10).map((student) => {
                  const isFriend = friendships.some(f => 
                    (f.user1Id === auth.currentUser?.uid && f.user2Id === student.uid) ||
                    (f.user1Id === student.uid && f.user2Id === auth.currentUser?.uid)
                  );

                  return (
                    <div
                      key={student.uid}
                      className="p-3 border border-slate-100 hover:border-slate-200 bg-white rounded-2xl flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 truncate" onClick={() => navigate(`/profile/${student.uid}`)}>
                        <img
                          src={student.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${student.email}`}
                          className="w-8 h-8 rounded-full cursor-pointer object-cover border border-slate-100"
                          alt=""
                        />
                        <div className="truncate text-left leading-tight">
                          <span className="text-xs font-bold text-slate-800 tracking-tight block truncate cursor-pointer hover:text-blue-600">{student.displayName}</span>
                          <span className="text-[9px] text-slate-400 truncate block">@{student.email?.split('@')[0]}</span>
                        </div>
                      </div>
                      
                      {isFriend ? (
                        <span className="text-[10px] text-green-600 font-bold bg-green-50 px-2 py-1 rounded-lg border border-green-100">Friend</span>
                      ) : (
                        <button
                          onClick={() => handleAddFriend(student)}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-all"
                          title="Add Friend in Real Time"
                        >
                          <UserPlus size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {/* Call History directory */}
              <div className="px-6 flex items-center justify-between">
                <span className="text-xs font-mono font-black text-slate-400 uppercase tracking-wider">
                  Call History ({callHistory.length})
                </span>
                {callHistory.length > 0 && (
                  <button 
                    onClick={async () => {
                      if (confirm("Clear call history logs?")) {
                        try {
                          const q = query(
                            collection(db, "missed_calls"),
                            where("callerId", "==", auth.currentUser?.uid)
                          );
                          const q2 = query(
                            collection(db, "missed_calls"),
                            where("receiverId", "==", auth.currentUser?.uid)
                          );
                          const snapshots = await Promise.all([getDocs(q), getDocs(q2)]);
                          const deletePromises: any[] = [];
                          snapshots.forEach(snap => {
                            snap.docs.forEach(docSnap => {
                              deletePromises.push(deleteDoc(doc(db, "missed_calls", docSnap.id)));
                            });
                          });
                          await Promise.all(deletePromises);
                          logActivity("Cleared personal call history.");
                        } catch (err) {
                          console.error("Failed to clear history:", err);
                        }
                      }
                    }}
                    className="text-[10px] text-red-500 hover:text-red-600 font-bold uppercase tracking-wider transition-colors"
                  >
                    Clear All
                  </button>
                )}
              </div>

              <div className="px-3 space-y-1.5 overflow-y-auto max-h-[50vh] scrollbar-thin">
                {callHistory.length === 0 ? (
                  <div className="text-center py-10 px-4">
                    <Phone className="mx-auto text-slate-300 mb-2" size={24} />
                    <p className="text-xs text-slate-400 font-semibold leading-relaxed">No call sessions recorded yet.</p>
                  </div>
                ) : (
                  callHistory.map((log) => {
                    const isOutgoing = log.callerId === auth.currentUser?.uid;
                    const peerName = isOutgoing ? log.receiverName : log.callerName;
                    const formattedDate = log.createdAt?.seconds 
                      ? formatDistanceToNow(new Date(log.createdAt.seconds * 1000), { addSuffix: true })
                      : "Just now";

                    const isMissed = log.status === "missed" || log.status === "declined";

                    return (
                      <div
                        key={log.id}
                        className="p-3 border border-slate-100 hover:border-slate-200 bg-white rounded-2xl flex items-center justify-between gap-3 transition-all shadow-sm"
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <div className={`p-2 rounded-xl shrink-0 ${
                            isMissed 
                              ? "bg-red-50 text-red-600" 
                              : "bg-green-50 text-green-600"
                          }`}>
                            {log.callType === "video" ? <Video size={16} /> : <Phone size={16} />}
                          </div>
                          <div className="truncate text-left leading-tight">
                            <span className="text-xs font-black text-slate-800 tracking-tight block truncate">
                              {peerName}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                                isMissed 
                                  ? "bg-red-50 text-red-500 border border-red-100" 
                                  : "bg-green-50 text-green-600 border border-green-100"
                              }`}>
                                {isOutgoing ? "Outgoing" : "Incoming"} {isMissed ? "Missed" : "Completed"}
                              </span>
                              <span className="text-[9px] text-slate-400 flex items-center gap-0.5 whitespace-nowrap">
                                <Clock size={9} /> {log.duration ? `${Math.floor(log.duration / 60)}m ${log.duration % 60}s` : "0s"}
                              </span>
                            </div>
                            <span className="text-[9px] text-slate-400 block mt-1 font-mono">{formattedDate}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            const peerId = isOutgoing ? log.receiverId : log.callerId;
                            const target = students.find((s: any) => s.uid === peerId);
                            if (target) {
                              handleSelectStudent(target);
                              setTimeout(() => {
                                startCall(log.callType);
                              }, 300);
                            } else {
                              alert("Speed-dial callback requires classmate to be online.");
                            }
                          }}
                          className={`p-1.5 rounded-xl border transition-all shrink-0 ${
                            isMissed 
                              ? "border-red-100 hover:bg-red-50 text-red-500" 
                              : "border-green-100 hover:bg-green-50 text-green-500"
                          }`}
                          title="Instant Callback"
                        >
                          <PhoneCall size={14} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col min-w-0 bg-slate-50/20 ${!selectedReceiver ? 'hidden lg:flex' : 'flex'}`}>
        {/* Chat Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {activeStudent ? (
              <>
                <button
                  onClick={() => {
                    setSelectedReceiver(null);
                    setActiveChat('');
                  }}
                  className="lg:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-xl mr-1 shrink-0"
                  title="Back to Corridor Deck"
                >
                  <ArrowLeft size={18} />
                </button>
                <img 
                  src={activeStudent.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${activeStudent.email}`}
                  onClick={() => navigate(`/profile/${activeStudent.uid}`)}
                  className="w-11 h-11 rounded-full object-cover border border-slate-100 shadow-sm cursor-pointer hover:ring-2 hover:ring-blue-100 transition-all"
                  alt="" 
                  referrerPolicy="no-referrer"
                />
                <div>
                  <h3 
                    onClick={() => navigate(`/profile/${activeStudent.uid}`)}
                    className="font-bold leading-tight flex items-center gap-2 cursor-pointer hover:text-blue-600 transition-colors"
                  >
                    {activeStudent.displayName || activeStudent.email?.split('@')[0]}
                    <VerificationBadge email={activeStudent.email} verified={activeStudent.verified} />
                  </h3>
                  <p className="text-[10px] text-slate-400 italic-none flex items-center gap-1.5 leading-snug">
                    {activeStudent.online ? (
                      <span className="flex items-center gap-1 text-green-500 font-bold">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse inline-block" /> Online
                      </span>
                    ) : (
                      <span className="text-slate-400 font-semibold">
                        Offline {activeStudent.lastActive ? (
                          `• Last seen ${(() => {
                            try {
                              const date = typeof activeStudent.lastActive.toDate === 'function' 
                                ? activeStudent.lastActive.toDate() 
                                : activeStudent.lastActive.seconds 
                                  ? new Date(activeStudent.lastActive.seconds * 1000) 
                                  : new Date(activeStudent.lastActive);
                              return formatDistanceToNow(date, { addSuffix: true });
                            } catch (e) {
                              return 'recently';
                            }
                          })()}`
                        ) : 'recently'}
                      </span>
                    )}
                    <span>• {activeStudent.email}</span>
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="w-11 h-11 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center font-bold">
                  <Users size={20} />
                </div>
                <div>
                  <h3 className="font-bold leading-tight text-slate-700">No Chat Selected</h3>
                  <p className="text-[10px] text-slate-400 italic-none">
                    Choose a classmate to start calling or chatting
                  </p>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeStudent && (
              <>
                <button 
                  onClick={() => startCall('voice')}
                  className="p-2.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all active:scale-95"
                  title="Start Real Time Voice Call"
                >
                  <Phone size={19} />
                </button>
                <button 
                  onClick={() => startCall('video')}
                  className="p-2.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all active:scale-95"
                  title="Start Real Time Video Call"
                >
                  <Video size={19} />
                </button>

                {/* Conversation Block Dynamic Settings Dropdown Menu */}
                <div className="relative">
                  <button
                    onClick={() => setShowHeaderMenu(!showHeaderMenu)}
                    className="p-2.5 text-slate-500 hover:text-blue-650 hover:bg-slate-50 rounded-xl transition-all"
                    title="Conversation Settings"
                  >
                    <MoreVertical size={19} />
                  </button>
                  <AnimatePresence>
                    {showHeaderMenu && (
                      <>
                        <div className="fixed inset-0 z-45" onClick={() => setShowHeaderMenu(false)} />
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: 10 }}
                          className="absolute right-0 mt-2 w-52 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden"
                        >
                          {/* 1. View Profile Button */}
                          <button
                            onClick={() => {
                              navigate(`/profile/${activeStudent.uid}`);
                              setShowHeaderMenu(false);
                            }}
                            className="w-full px-4 py-3 flex items-center gap-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-100"
                          >
                            <ExternalLink size={15} className="text-blue-500 shrink-0" />
                            <span>View Student Profile</span>
                          </button>

                          {/* 2. Clear Chat History Button */}
                          <button
                            onClick={() => {
                              deleteChatHistory();
                              setShowHeaderMenu(false);
                            }}
                            className="w-full px-4 py-3 flex items-center gap-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-100"
                          >
                            <span>🗑️</span>
                            <span>Clear Conversation</span>
                          </button>

                          {/* 3. Report Account Button */}
                          <button
                            onClick={() => {
                              setShowReportModal(true);
                              setShowHeaderMenu(false);
                            }}
                            className="w-full px-4 py-3 flex items-center gap-2.5 text-left text-xs font-bold text-amber-600 hover:bg-amber-50 transition-colors border-b border-slate-100"
                          >
                            <span>⚠️</span>
                            <span>Report Student</span>
                          </button>

                          {/* 4. Block/Unblock Button */}
                          <button
                            onClick={() => {
                              toggleBlockUser(activeStudent.uid, activeStudent.displayName || activeStudent.email?.split('@')[0]);
                              setShowHeaderMenu(false);
                            }}
                            className="w-full px-4 py-3 flex items-center gap-2.5 text-left text-xs font-bold text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Ban size={15} className="text-red-500 shrink-0" />
                            {blockedUserIds.includes(activeStudent.uid) ? 'Unblock Student' : 'Block Student'}
                          </button>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Messages List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide italic-none bg-slate-50/50">
          {!selectedReceiver ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-white/40 rounded-[2rem] border border-slate-150/40">
              <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4 border border-blue-100 shadow-sm shadow-blue-50">
                <Users size={28} className="animate-pulse" />
              </div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Direct Campus Calling & Chat</h3>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5 uppercase tracking-widest font-black">Direct Line Corridor</p>
              <p className="text-xs text-slate-500 max-w-sm mt-3 leading-relaxed">
                Connect with your fellow students instantly. Click on any active classmate or classmate in your friends directory to place live voice calls, FaceTimes, and exchange secure files and messages.
              </p>
              <div className="grid grid-cols-2 gap-3 mt-6 w-full max-w-md">
                <div className="p-4 bg-white border border-slate-100 rounded-2xl text-left shadow-xs">
                  <h5 className="font-bold text-xs text-slate-800 flex items-center gap-1.5 mb-1 text-emerald-600">
                    <Phone size={14} /> Voice Call
                  </h5>
                  <p className="text-[10px] text-slate-400 leading-normal font-sans">High-performance real-time latency-free calling with students.</p>
                </div>
                <div className="p-4 bg-white border border-slate-100 rounded-2xl text-left shadow-xs">
                  <h5 className="font-bold text-xs text-slate-800 flex items-center gap-1.5 mb-1 text-indigo-600">
                    <Video size={14} /> FaceTime Video
                  </h5>
                  <p className="text-[10px] text-slate-400 leading-normal font-sans">Interactive peer-to-peer live video feeds streams.</p>
                </div>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-400">
              <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 mb-3">
                <Users size={24} />
              </div>
              <h4 className="font-bold text-slate-700 mb-1">No messages yet</h4>
              <p className="text-xs max-w-xs leading-relaxed">Send a friendly greeting to start the conversation! All student messages are secure.</p>
            </div>
          ) : (
            messages.map((msg, i) => {
              const isMe = msg.senderId === auth.currentUser?.uid;
              return (
                <motion.div
                  key={msg.id || i}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}
                >
                  {!isMe && (
                    <img 
                      src={msg.senderAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${msg.senderName}`} 
                      onClick={() => navigate(`/profile/${msg.senderId}`)}
                      className="w-8 h-8 rounded-full shadow-sm mt-auto object-cover border border-slate-200 cursor-pointer hover:ring-2 hover:ring-blue-100 transition-all bg-white" 
                      alt="" 
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className={`max-w-[70%] italic-none`}>
                    {!isMe && (
                      <span 
                        onClick={() => navigate(`/profile/${msg.senderId}`)}
                        className="text-[10px] font-bold text-slate-400 ml-2 mb-1 block italic-none cursor-pointer hover:text-blue-600 transition-colors"
                      >
                        {msg.senderName}
                      </span>
                    )}
                    <div className={`p-1.5 rounded-2xl text-sm italic-none ${
                      isMe 
                        ? 'bg-slate-900 text-white rounded-br-none' 
                        : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-sm'
                    }`}>
                      {/* Render custom Base64 uploaded photo if present in chat */}
                      {msg.imageUrl && (
                        <div className="rounded-xl overflow-hidden mb-1.5 max-w-sm max-h-60 border border-slate-100">
                          <img 
                            src={msg.imageUrl} 
                            className="w-full h-full object-cover cursor-zoom-in" 
                            alt="Attached file" 
                            referrerPolicy="no-referrer"
                            onClick={() => window.open(msg.imageUrl, '_blank')}
                          />
                        </div>
                      )}
                      
                      {msg.text && (
                        <div className="px-3.5 py-2 leading-relaxed whitespace-pre-wrap flex items-start justify-between gap-1.5">
                          <span>{msg.isEncrypted ? decryptText(msg.text, activeChat) : msg.text}</span>
                          {msg.isEncrypted && (
                            <Lock size={12} className="inline-block text-emerald-500 hover:text-emerald-400 shrink-0 mt-1" title="End-to-End Encrypted" />
                          )}
                        </div>
                      )}
                    </div>
                    <div className={`flex items-center gap-1 mt-1 text-[9px] text-slate-400 ${isMe ? 'justify-end' : ''}`}>
                      {msg.createdAt && format(msg.createdAt, 'HH:mm')}
                      {isMe && (
                        msg.seen ? (
                          <CheckCheck size={11} className="text-blue-600 stroke-[3px]" title="Seen" />
                        ) : (
                          <Check size={11} className="text-slate-400 stroke-[2px]" title="Sent" />
                        )
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
          {typing && typingUser && (
            <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 pl-3 py-1">
              <div className="flex gap-1 items-center bg-slate-150/40 px-3 py-1.5 rounded-full border border-slate-200/60">
                <span className="w-1.5 h-1.5 bg-slate-450 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 bg-slate-450 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 bg-slate-450 rounded-full animate-bounce" />
                <span className="text-[10px] ml-1 font-semibold text-slate-500 font-sans">
                  <span className="font-extrabold text-slate-800">{typingUser}</span> is typing...
                </span>
              </div>
            </motion.div>
          )}
          <div ref={scrollRef} />
        </div>

        {/* Input Area */}
        {selectedReceiver && (
          <div className="p-4 border-t border-slate-100 italic-none">
            {/* Base64 Input image preview */}
            <AnimatePresence>
              {selectedImageBase64 && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="mb-3 relative max-w-[120px] rounded-xl overflow-hidden shadow-md border border-slate-200/60 bg-white p-1"
                >
                  <img src={selectedImageBase64} className="w-full h-24 object-cover rounded-lg" alt="Thumbnail" />
                  <button
                    onClick={() => setSelectedImageBase64(null)}
                    className="absolute top-2 right-2 p-1 bg-slate-950/80 hover:bg-slate-950 text-white rounded-full transition-all"
                  >
                    <X size={10} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-2xl italic-none ring-1 ring-slate-200">
              <input
                type="file"
                accept="image/*"
                ref={chatFileInputRef}
                onChange={handleImageSelect}
                className="hidden"
              />
              <button 
                type="button"
                onClick={() => chatFileInputRef.current?.click()}
                className="p-2.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors shrink-0"
                title="Add Image Attachment"
              >
                <Image size={20} />
              </button>
              <input
                type="text"
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  handleTyping();
                }}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder={`Message ${selectedReceiver.displayName}...`}
                className="flex-1 bg-transparent border-none focus:ring-0 text-sm italic-none outline-none py-2"
              />
              <button
                type="button"
                onClick={toggleSpeechRecognition}
                className={`p-2.5 rounded-xl transition-all relative cursor-pointer flex items-center justify-center shrink-0 ${
                  isListening 
                    ? "bg-red-50 text-red-600 ring-2 ring-red-500/20" 
                    : "text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                }`}
                title={isListening ? "Listening (Click to Stop)" : "Speech-to-Text Voice Dictation"}
              >
                {isListening ? (
                  <>
                    <span className="absolute inset-0 bg-red-500/15 rounded-xl animate-ping" />
                    <Mic className="relative z-10 text-red-600 animate-pulse" size={20} />
                  </>
                ) : (
                  <Mic size={20} />
                )}
              </button>
              <button
                onClick={sendMessage}
                disabled={!inputText.trim() && !selectedImageBase64}
                className={`p-2 rounded-xl italic-none transition-all ${
                  inputText.trim() || selectedImageBase64 ? "bg-blue-600 text-white shadow-lg shadow-blue-100" : "text-slate-300"
                }`}
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        )}
      </div>
      <CallInterface
        callState={callState}
        callType={callType}
        connectionStatus={connectionStatus}
        localStream={localStream}
        remoteStream={remoteStream}
        micMuted={micMuted}
        cameraOff={cameraOff}
        isScreenSharing={isScreenSharing}
        callerDetails={callerDetails}
        callTimer={callTimer}
        acceptCall={acceptIncomingCall}
        declineCall={rejectIncomingCall}
        endCall={endActiveCall}
        toggleMic={toggleMic}
        toggleCamera={toggleCamera}
        toggleScreenShare={toggleScreenShare}
        isRecipientOffline={isRecipientOffline}
        ping={ping}
        remoteStreams={
          Object.keys(remoteStreams).length > 0 
            ? remoteStreams 
            : (remoteStream 
                ? { 
                    'single-remote': { 
                      stream: remoteStream, 
                      userName: callerDetails?.callerId === auth.currentUser?.uid 
                        ? (callerDetails?.receiverName || "Remote Student") 
                        : (callerDetails?.callerName || "Remote Student") 
                    } 
                  } 
                : {})
        }
      />

      {/* Real-Time Intrusive Floating Notifications list */}
      <div className="absolute top-4 right-4 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none pr-4">
        <AnimatePresence>
          {intrusiveNotifications.map((notif) => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, x: 100, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.95 }}
              className="pointer-events-auto w-full bg-slate-900 border border-slate-800 text-white rounded-2xl shadow-2xl p-4 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 px-2 text-[10px] font-black uppercase tracking-widest bg-blue-600 rounded-full text-white inline-flex items-center gap-1">
                    <Bell size={10} className="animate-bounce" /> {notif.title}
                  </span>
                </div>
                <button
                  onClick={() => dismissIntrusiveNotification(notif)}
                  className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-all"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex items-start gap-3">
                <img
                  src={notif.senderAvatar}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-800"
                />
                <div className="flex-1 min-w-0 pr-1 text-left">
                  <p className="text-sm font-bold truncate text-slate-100">{notif.senderName}</p>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed break-words">{notif.description}</p>
                </div>
              </div>

              {/* Action grid depending on the notification type */}
              <div className="flex gap-2 border-t border-slate-800/80 pt-2.5 mt-1 justify-end">
                {notif.type === 'incoming-call' && (
                  <>
                    <button
                      onClick={() => {
                        acceptIncomingCall();
                        dismissIntrusiveNotification(notif);
                      }}
                      className="px-3.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1"
                    >
                      <Phone size={12} /> Answer
                    </button>
                    <button
                      onClick={() => {
                        rejectIncomingCall();
                        dismissIntrusiveNotification(notif);
                      }}
                      className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1"
                    >
                      <PhoneOff size={12} /> Decline
                    </button>
                  </>
                )}
                {notif.type === 'new-message' && (
                  <button
                    onClick={() => handleNotificationClick(notif)}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1"
                  >
                    <MessageCircle size={12} /> Open Chat
                  </button>
                )}
                {(notif.type === 'like' || notif.type === 'comment') && (
                  <button
                    onClick={() => dismissIntrusiveNotification(notif)}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ⚠️ Beautiful Responsive Report Student Modal */}
      <AnimatePresence>
        {showReportModal && activeStudent && (
          <div className="fixed inset-0 z-[190] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowReportModal(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white border border-slate-200 p-6 rounded-3xl max-w-sm w-full shadow-2xl relative z-10 text-slate-800 font-sans"
            >
              <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-100">
                <AlertTriangle size={22} className="text-amber-500 animate-bounce" />
              </div>
              <h3 className="text-lg font-black tracking-tight text-slate-900 text-center">Report Student</h3>
              <p className="text-xs text-slate-505 text-center leading-relaxed mt-1 font-medium">
                You are reporting <span className="font-extrabold text-slate-950">{activeStudent.displayName || activeStudent.email}</span>. Please specify the issue to submit to the campus admin desk.
              </p>
              
              <textarea
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                rows={4}
                placeholder="Abusive language, spam, harassment, malicious items or security breach..."
                className="w-full mt-4 p-3 border border-slate-200 rounded-2xl text-xs outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all font-sans"
              />

              <div className="flex gap-3 mt-5">
                <button
                  type="button"
                  disabled={isSubmittingReport}
                  onClick={() => setShowReportModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmittingReport || !reportReason.trim()}
                  onClick={async () => {
                    setIsSubmittingReport(true);
                    try {
                      await addDoc(collection(db, 'reports'), {
                        reporterId: auth.currentUser?.uid,
                        reporterName: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || "Student",
                        reportedId: activeStudent.uid,
                        reportedName: activeStudent.displayName || activeStudent.email || "Unknown Student",
                        reason: reportReason.trim(),
                        createdAt: new Date().toISOString()
                      });
                      await logActivity(`Submitted safety report on ${activeStudent.displayName || activeStudent.email}`);
                      alert(`The report for "${activeStudent.displayName || activeStudent.email}" has been sent successfully to the campus admin desk for immediate review.`);
                      setReportReason("");
                      setShowReportModal(false);
                    } catch (err) {
                      console.error("Report submission failed:", err);
                      alert("Could not send report. Please try again.");
                    } finally {
                      setIsSubmittingReport(false);
                    }
                  }}
                  className="flex-1 py-2.5 bg-red-655 hover:bg-red-750 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase shadow-md shadow-red-50 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isSubmittingReport ? (
                    <>
                      <Loader2 size={12} className="animate-spin" /> Submitting
                    </>
                  ) : (
                    "Report"
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

