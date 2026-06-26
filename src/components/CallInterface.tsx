import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, CameraOff, Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Maximize2, Minimize2, ScreenShare, Volume2, ShieldCheck, Loader2, Layers } from 'lucide-react';
import { cn } from '../lib/utils';

export interface CallInterfaceProps {
  callState: 'idle' | 'outgoing' | 'incoming' | 'active';
  callType: 'voice' | 'video';
  connectionStatus: 'connecting' | 'ringing' | 'connected' | 'ended' | 'disconnected' | 'failed';
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micMuted: boolean;
  cameraOff: boolean;
  isScreenSharing: boolean;
  callerDetails: any;
  callTimer: number;
  acceptCall: () => void;
  declineCall: () => void;
  endCall: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => void;
  isRecipientOffline?: boolean;
  ping?: number | null;
  packetLoss?: number | null;
  jitter?: number | null;
  remoteStreams?: {
    [peerId: string]: {
      stream: MediaStream;
      userName: string;
      userAvatar?: string;
    };
  };
}

const FILTERS = [
  { name: 'Normal', value: 'none' },
  { name: 'Warm 🧡', value: 'sepia(0.3) saturate(1.4) contrast(1.1)' },
  { name: 'Cool 🩵', value: 'hue-rotate(180deg) saturate(1.2)' },
  { name: 'Sepia 🤎', value: 'sepia(0.8)' },
  { name: 'Grayscale 🖤', value: 'grayscale(1)' },
  { name: 'Invert 💙', value: 'invert(1)' }
];

// Helper component for rendering multiple video feeds with custom CSS filters and rounded layouts
function VideoFeed({ 
  id, 
  name, 
  stream, 
  isLocal, 
  filterStyle,
  blurLevel = 'none'
}: { 
  id: string; 
  name: string; 
  stream: MediaStream; 
  isLocal: boolean; 
  filterStyle?: string; 
  blurLevel?: 'none' | 'light' | 'medium' | 'deep';
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || !stream || blurLevel === 'none' || !isLocal) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isActive = true;

    const render = () => {
      if (!isActive) return;

      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        // Draw basic frame
        ctx.drawImage(video, 0, 0, width, height);

        // Process blurred frame
        const blurPx = blurLevel === 'light' ? 8 : blurLevel === 'medium' ? 16 : 28;

        if (!tempCanvasRef.current) {
          tempCanvasRef.current = document.createElement('canvas');
        }
        const tempCanvas = tempCanvasRef.current;
        if (tempCanvas.width !== width || tempCanvas.height !== height) {
          tempCanvas.width = width;
          tempCanvas.height = height;
        }

        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          tempCtx.clearRect(0, 0, width, height);
          
          tempCtx.filter = `blur(${blurPx}px)`;
          tempCtx.drawImage(video, 0, 0, width, height);
          tempCtx.filter = 'none';

          tempCtx.globalCompositeOperation = 'destination-out';
          
          const centerX = width / 2;
          const centerY = height / 2;
          
          const focalWidth = Math.min(width, height) * 0.20;
          const shadowWidth = Math.max(width, height) * 0.48;

          const gradient = tempCtx.createRadialGradient(
            centerX, centerY, focalWidth,
            centerX, centerY, shadowWidth
          );
          
          gradient.addColorStop(0, 'rgba(0, 0, 0, 1.0)');
          gradient.addColorStop(0.35, 'rgba(0, 0, 0, 0.8)');
          gradient.addColorStop(0.8, 'rgba(0, 0, 0, 0.2)');
          gradient.addColorStop(1, 'rgba(0, 0, 0, 0.0)');

          tempCtx.fillStyle = gradient;
          tempCtx.beginPath();
          tempCtx.arc(centerX, centerY, Math.max(width, height), 0, 2 * Math.PI);
          tempCtx.fill();

          tempCtx.globalCompositeOperation = 'source-over';

          ctx.drawImage(tempCanvas, 0, 0);
        }
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      isActive = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [blurLevel, isLocal, stream]);

  const showCanvas = isLocal && blurLevel !== 'none';

  return (
    <div 
      id={`active-video-container-${id}`}
      className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-lg flex items-center justify-center aspect-[4/3] w-full transition-all duration-300 hover:shadow-2xl hover:border-slate-700/60"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={cn(
          "w-full h-full object-cover rounded-2xl shadow-xl border border-slate-800/50",
          showCanvas ? "hidden" : "block"
        )}
        style={{ filter: (!showCanvas && filterStyle) ? filterStyle : 'none' }}
      />

      {showCanvas && (
        <canvas
          ref={canvasRef}
          className="w-full h-full object-cover rounded-2xl shadow-xl border border-slate-800/50"
          style={{ filter: filterStyle || 'none' }}
        />
      )}

      <span className="absolute bottom-3 left-3 bg-slate-950/75 text-white text-[10px] font-mono font-black uppercase tracking-widest px-2 py-1 rounded-lg border border-slate-800/80 shadow-md">
        {name} {isLocal && " (You)"}
      </span>
    </div>
  );
}

export default function CallInterface({
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
  acceptCall,
  declineCall,
  endCall,
  toggleMic,
  toggleCamera,
  toggleScreenShare,
  isRecipientOffline = false,
  ping = null,
  packetLoss = null,
  jitter = null,
  remoteStreams = {}
}: CallInterfaceProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeFilterIndex, setActiveFilterIndex] = useState(0);
  const [blurLevel, setBlurLevel] = useState<'none' | 'light' | 'medium' | 'deep'>('none');

  const activeFilter = FILTERS[activeFilterIndex].value;

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, callState, cameraOff]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, callState]);

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  if (callState === 'idle') return null;

  return (
    <AnimatePresence>
      <div className={cn(
        "fixed transition-all duration-300 z-[180] flex items-center justify-center p-4",
        isMinimized 
          ? "bottom-6 right-6 top-auto left-auto w-80 h-48 pointer-events-auto shadow-2xl rounded-3xl overflow-hidden border border-slate-700/60" 
          : "inset-0 pointer-events-auto bg-slate-950/90 backdrop-blur-md"
      )}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className={cn(
            "bg-slate-900 text-white shadow-2xl relative flex flex-col justify-between overflow-hidden",
            isMinimized 
              ? "w-full h-full p-4 rounded-3xl" 
              : "max-w-md w-full h-[85vh] md:h-auto md:aspect-[9/16] max-h-[750px] rounded-[2.5rem] p-6 md:p-8 border border-slate-800"
          )}
        >
          {/* Top Bar / Mini-Controllers */}
          <div className="flex items-center justify-between w-full relative z-25 mb-4">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-blue-500 animate-pulse" />
              <span className="text-[10px] font-mono tracking-widest text-slate-400 font-extrabold uppercase">
                {callType} call • end-to-end
              </span>
            </div>
            
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1.5 hover:bg-white/10 rounded-lg transition-transform text-slate-400 hover:text-white"
              title={isMinimized ? "Maximize Window" : "Minimize Window"}
            >
              {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
            </button>
          </div>

          {/* Core Status & Feeds Section */}
          <div className="flex-1 flex flex-col items-center justify-center gap-6 relative z-10 my-4 text-center overflow-y-auto">
            
            {/* Outgoing Dialing Card */}
            {callState === 'outgoing' && (
              <div className="space-y-4 w-full px-2 py-4">
                <div className="relative w-24 h-24 mx-auto mb-2">
                  <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping" />
                  <img
                    src={callerDetails?.callerAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${callerDetails?.receiverId || 'cc'}`}
                    className="w-24 h-24 rounded-full object-cover border-4 border-slate-850 shadow-lg relative z-10"
                    alt=""
                  />
                </div>
                <h3 className="text-xl font-black">{callerDetails?.callerName || "Campus Student"}</h3>
                <div className="flex items-center justify-center gap-1.5 py-1.5 px-4 bg-slate-950/50 rounded-full border border-slate-800 w-fit mx-auto">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" />
                  <span className="text-[10px] font-mono font-bold tracking-wider text-blue-200">
                    {connectionStatus.toUpperCase()}...
                  </span>
                </div>

                {/* Highly Visible Offline Warning Message */}
                {isRecipientOffline && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-red-950/60 border border-red-850/40 p-4 rounded-2xl max-w-xs mx-auto flex items-start gap-3 text-left shadow-lg"
                  >
                    <span className="text-lg shrink-0">⚠️</span>
                    <div>
                      <p className="text-[10px] font-black text-red-400 uppercase tracking-wider">Recipient is Offline</p>
                      <p className="text-[9px] text-red-200 font-medium leading-relaxed mt-0.5">
                        This classmate is not online right now. Your attempt was immediately logged as a missed call notification on their Corridor Desk.
                      </p>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {/* Incoming Alert Card */}
            {callState === 'incoming' && (
              <div className="space-y-4 py-4">
                <div className="relative w-24 h-24 mx-auto mb-2">
                  <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping" />
                  <img
                    src={callerDetails?.callerAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${callerDetails?.callerId || 'cc'}`}
                    className="w-24 h-24 rounded-full object-cover border-4 border-slate-850 shadow-lg relative z-10"
                    alt=""
                  />
                </div>
                <h3 className="text-xl font-black">{callerDetails?.callerName || "Campus Student"}</h3>
                <span className="text-xs text-slate-400 block font-semibold animate-pulse">
                  Campus Corridor Ringing...
                </span>
              </div>
            )}

            {/* Connected/Active Session Dashboard */}
            {callState === 'active' && (
              <div className="w-full h-full flex flex-col justify-between flex-1 py-1">
                <div className="flex items-center justify-between bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 text-xs font-mono mb-4">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      "w-2 h-2 rounded-full",
                      connectionStatus === 'connected' ? "bg-green-500 animate-pulse" : "bg-amber-500"
                    )} />
                    <span className="text-[10px] text-slate-300 font-bold">{connectionStatus.toUpperCase()}</span>
                    {ping !== undefined && ping !== null && (
                      <span className={cn(
                        "ml-2 text-[9px] px-1.5 py-0.5 rounded-md font-mono font-extrabold",
                        ping < 120 ? "text-green-400 bg-green-500/10 border border-green-500/20" :
                        ping < 260 ? "text-amber-400 bg-amber-500/10 border border-amber-500/20" :
                        "text-red-400 bg-red-500/10 border border-red-500/20"
                      )}>
                        {ping} ms RTT
                      </span>
                    )}
                    {packetLoss !== undefined && packetLoss !== null && (
                      <span className={cn(
                        "ml-1 text-[9px] px-1.5 py-0.5 rounded-md font-mono font-extrabold",
                        packetLoss < 3 ? "text-green-400 bg-green-500/10 border border-green-500/20" :
                        packetLoss < 12 ? "text-amber-400 bg-amber-500/10 border border-amber-500/20" :
                        "text-red-400 bg-red-500/10 border border-red-500/20"
                      )}>
                        {packetLoss} Loss
                      </span>
                    )}
                    {jitter !== undefined && jitter !== null && (
                      <span className={cn(
                        "ml-1 text-[9px] px-1.5 py-0.5 rounded-md font-mono font-extrabold",
                        jitter < 15 ? "text-green-400 bg-green-500/10 border border-green-500/20" :
                        jitter < 40 ? "text-amber-400 bg-amber-500/10 border border-amber-500/20" :
                        "text-red-400 bg-red-500/10 border border-red-500/20"
                      )}>
                        {jitter} ms Jitter
                      </span>
                    )}
                  </div>
                  <span className="font-extrabold text-blue-400">{formatTimer(callTimer)}</span>
                </div>
                {/* Cam visual streaming area (Dynamic Grid layouts) */}
                {callType === 'video' ? (
                  (() => {
                    const activeFeeds: { id: string; name: string; stream: MediaStream; isLocal: boolean }[] = [];
                    if (localStream && !cameraOff) {
                      activeFeeds.push({ id: 'local', name: 'You', stream: localStream, isLocal: true });
                    }
                    const keys = Object.keys(remoteStreams);
                    if (keys.length > 0) {
                      keys.forEach(peerId => {
                        activeFeeds.push({
                          id: peerId,
                          name: remoteStreams[peerId].userName || 'Remote Student',
                          stream: remoteStreams[peerId].stream,
                          isLocal: false
                        });
                      });
                    } else if (remoteStream) {
                      activeFeeds.push({
                        id: 'remote',
                        name: callerDetails?.callerName || 'Remote Student',
                        stream: remoteStream,
                        isLocal: false
                      });
                    }

                    return (
                      <div 
                        id="active-call-grid"
                        className={cn(
                          "grid gap-3 w-full rounded-2xl overflow-hidden relative bg-slate-950 border border-slate-850 shadow-2xl flex-1 min-h-[200px] p-2 overflow-y-auto max-h-[420px]",
                          // Forces a single-column stack on screens smaller than 640px to ensure both streams are fully visible.
                          // On screens larger than 645px, splits into 2 columns if multiple video feeds exist.
                          activeFeeds.length <= 1 ? "grid-cols-1 max-w-sm mx-auto" : "grid-cols-1 sm:grid-cols-2"
                        )}
                      >
                        {cameraOff && activeFeeds.length === 0 && (
                          <div className="col-span-full flex flex-col items-center justify-center text-slate-500 gap-1.5 font-sans py-12">
                            <CameraOff size={32} className="text-slate-600 animate-pulse" />
                            <span className="text-[10px] uppercase font-mono tracking-widest font-black text-slate-500">All Cameras Off</span>
                          </div>
                        )}
                        {activeFeeds.map(feed => (
                          <VideoFeed
                            key={feed.id}
                            id={feed.id}
                            name={feed.name}
                            stream={feed.stream}
                            isLocal={feed.isLocal}
                            filterStyle={feed.isLocal ? activeFilter : 'none'}
                            blurLevel={feed.isLocal ? blurLevel : 'none'}
                          />
                        ))}
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex-1 flex items-center justify-center py-6">
                    <div className="w-20 h-20 bg-blue-950/40 rounded-full flex items-center justify-center text-blue-400 animate-pulse border border-blue-900/30">
                      <Volume2 size={36} />
                    </div>
                  </div>
                )}

                <div className="mt-3">
                  <h4 className="text-sm font-extrabold text-slate-200">
                    {callerDetails?.callerId === callerDetails?.receiverId ? "Campus Connect" : (callerDetails?.callerName || "Student")}
                  </h4>
                  <p className="text-[10px] text-slate-500 font-mono">Secure TLS 1.3 Transmission</p>
                </div>
              </div>
            )}
          </div>

          {/* Action Call Controls Panel */}
          <div className="relative z-20 flex hover:opacity-100 justify-center items-center gap-4 mt-auto pt-4 border-t border-slate-800/60">
            {callState === 'incoming' ? (
              <div className="flex flex-col sm:flex-row gap-3 w-full justify-center px-2">
                <button
                  onClick={declineCall}
                  className="w-full sm:w-auto px-6 py-3 bg-red-650 hover:bg-red-700 text-white rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95"
                  title="Decline Calling Line"
                >
                  <PhoneOff size={16} /> Decline
                </button>
                <button
                  onClick={acceptCall}
                  className="w-full sm:w-auto px-6 py-3 bg-green-650 hover:bg-green-700 text-white rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 animate-bounce"
                  title="Answer Calling Line"
                >
                  <Phone size={16} /> Answer
                </button>
              </div>
            ) : (
              <div className="flex gap-4 items-center">
                <button
                  onClick={toggleMic}
                  className={cn(
                    "p-3 rounded-2xl border text-slate-300 transition-all hover:bg-slate-800 active:scale-90",
                    micMuted ? "bg-red-950/60 border-red-800 text-red-500" : "bg-slate-800/60 border-slate-750"
                  )}
                  title={micMuted ? "Unmute Mic" : "Mute Mic"}
                >
                  {micMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>

                <button
                  onClick={endCall}
                  className="p-4 bg-red-600 hover:bg-red-700 hover:rotate-12 hover:scale-105 text-white rounded-full transition-all active:scale-90 shadow-xl border border-red-500/30 flex items-center justify-center"
                  title="Hang Up"
                >
                  <PhoneOff size={22} />
                </button>

                {callType === 'video' && (
                  <>
                    <button
                      onClick={toggleCamera}
                      className={cn(
                        "p-3 rounded-2xl border text-slate-300 transition-all hover:bg-slate-800 active:scale-90",
                        cameraOff ? "bg-red-950/60 border-red-800 text-red-500" : "bg-slate-800/60 border-slate-750"
                      )}
                      title={cameraOff ? "Cam On" : "Cam Off"}
                    >
                      {cameraOff ? <VideoOff size={18} /> : <Video size={18} />}
                    </button>

                    <button
                      onClick={() => setActiveFilterIndex(prev => (prev + 1) % FILTERS.length)}
                      className={cn(
                        "p-3 rounded-2xl border text-slate-300 transition-all hover:bg-slate-800 active:scale-90 bg-slate-800/60 border-slate-755",
                        activeFilterIndex > 0 && "bg-amber-950/60 border-amber-800 text-amber-500 font-bold"
                      )}
                      title={`Video Effect: ${FILTERS[activeFilterIndex].name}`}
                    >
                      <Sparkles size={18} />
                    </button>

                    <button
                      onClick={() => {
                        setBlurLevel(prev => {
                          if (prev === 'none') return 'light';
                          if (prev === 'light') return 'medium';
                          if (prev === 'medium') return 'deep';
                          return 'none';
                        });
                      }}
                      className={cn(
                        "p-3 rounded-2xl border text-slate-300 transition-all hover:bg-slate-800 active:scale-90 bg-slate-800/60 border-slate-755 flex items-center gap-1.5",
                        blurLevel !== 'none' && "bg-blue-950/60 border-blue-800 text-blue-400 font-bold shadow-md"
                      )}
                      title={`Background Blur: ${blurLevel.toUpperCase()}`}
                    >
                      <Layers size={18} className={cn(blurLevel !== 'none' && "animate-pulse text-blue-400")} />
                      {blurLevel !== 'none' && (
                        <span className="text-[9px] font-mono tracking-wider uppercase font-black px-1 py-0.5 rounded bg-blue-500/10 text-blue-300">
                          {blurLevel === 'light' ? 'Light' : blurLevel === 'medium' ? 'Med' : 'Deep'}
                        </span>
                      )}
                    </button>

                    <button
                      onClick={toggleScreenShare}
                      className={cn(
                        "p-3 rounded-2xl border text-slate-300 transition-all hover:bg-slate-800 active:scale-90 bg-slate-800/60 border-slate-755",
                        isScreenSharing && "bg-blue-950/60 border-blue-800 text-blue-500"
                      )}
                      title="Share Desktop"
                    >
                      <ScreenShare size={18} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
