import { useState, useEffect, useRef } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, increment, where, arrayUnion, arrayRemove } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, MessageCircle, Share2, Play, Pause, Music2, MapPin, Plus, X, Video, Send, Sparkles, Upload } from 'lucide-react';
import { logActivity } from '../lib/activity';

export default function Reels() {
  const [reels, setReels] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCaption, setNewCaption] = useState('');
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [selectedVideoBase64, setSelectedVideoBase64] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  // Comments support
  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [commentsReelId, setCommentsReelId] = useState<string | null>(null);
  const [reelComments, setReelComments] = useState<any[]>([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [userProfile, setUserProfile] = useState<any>(null);
  const [friendsList, setFriendsList] = useState<string[]>([]);
  const [activeMenuReelId, setActiveMenuReelId] = useState<string | null>(null);

  // Suggested high quality stock student clips to pick from
  const templates = [
    { name: "Tech Lab / Campus Walk", url: "https://assets.mixkit.co/videos/preview/mixkit-man-working-on-his-laptop-in-a-coffee-shop-42353-large.mp4" },
    { name: "Study Session Vibe", url: "https://assets.mixkit.co/videos/preview/mixkit-writing-on-a-notebook-with-a-fountain-pen-42337-large.mp4" },
    { name: "Coffee Shop Review", url: "https://assets.mixkit.co/videos/preview/mixkit-pouring-coffee-into-a-cup-42407-large.mp4" }
  ];

  // Sync user profile for real updates
  useEffect(() => {
    if (!auth.currentUser) return;
    const unsubscribe = onSnapshot(doc(db, 'users', auth.currentUser.uid), (docSnap) => {
      if (docSnap.exists()) {
        setUserProfile(docSnap.data());
      }
    });
    return unsubscribe;
  }, [auth.currentUser]);

  // Sync real-time comments for active reel
  useEffect(() => {
    if (!commentsReelId) {
      setReelComments([]);
      return;
    }
    const qComments = query(
      collection(db, 'posts', commentsReelId, 'comments'),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(qComments, (snapshot) => {
      setReelComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.warn("Failed to subscribe to reel comments:", error);
    });
    return unsubscribe;
  }, [commentsReelId]);

  useEffect(() => {
    if (!auth.currentUser) return;
    const path = 'posts';

    // Query posts that are video/reels
    const q = query(
      collection(db, path),
      where('mediaType', '==', 'video'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setReels(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return unsubscribe;
  }, [auth.currentUser]);

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) { // 50MB safety threshold for base64 storage
        alert("For performance and database throughput, please select a short video under 50MB.");
        return;
      }
      setVideoFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedVideoBase64(reader.result as string);
        setNewVideoUrl(''); // clear URL template
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCreateReel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !newCaption.trim()) return;

    setLoading(true);
    try {
      // Use device upload if present, otherwise external URL template
      const finalVideoUrl = selectedVideoBase64 || newVideoUrl.trim() || "https://assets.mixkit.co/videos/preview/mixkit-man-working-on-his-laptop-in-a-coffee-shop-42353-large.mp4";
      
      const campusDomain = auth.currentUser.email?.split('@')[1];
      const campusCode = campusDomain ? campusDomain.split('.')[0].toUpperCase() : 'UNILAG';

      await addDoc(collection(db, 'posts'), {
        userId: auth.currentUser.uid,
        userName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0],
        userAvatar: auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
        content: newCaption,
        mediaType: 'video',
        videoUrl: finalVideoUrl,
        likesCount: 0,
        commentsCount: 0,
        campus: campusCode,
        createdAt: serverTimestamp()
      });

      // Log real-time activity metrics
      await logActivity(`Published a campus reel video: "${newCaption.slice(0, 30)}..."`);

      setNewCaption('');
      setNewVideoUrl('');
      setSelectedVideoBase64(null);
      setVideoFileName(null);
      setShowAddModal(false);
    } catch (error) {
      console.error("Failed to post reel:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async (reelId: string, likedBy: string[] = []) => {
    if (!auth.currentUser) return;
    const postRef = doc(db, 'posts', reelId);
    const userId = auth.currentUser.uid;
    const hasLiked = likedBy.includes(userId);

    // Optimistic state update for instant, lightning-fast UI responsiveness
    setReels(prevReels => prevReels.map(r => {
      if (r.id === reelId) {
        const nextLikedBy = hasLiked 
          ? (r.likedBy || []).filter((uid: string) => uid !== userId) 
          : [...(r.likedBy || []), userId];
        const nextLikesCount = hasLiked 
          ? Math.max(0, (r.likesCount || 0) - 1) 
          : (r.likesCount || 0) + 1;
        return { ...r, likedBy: nextLikedBy, likesCount: nextLikesCount };
      }
      return r;
    }));

    try {
      if (hasLiked) {
        await updateDoc(postRef, {
          likesCount: increment(-1),
          likedBy: arrayRemove(userId)
        });
        await logActivity(`Removed like from a student reel.`);
      } else {
        await updateDoc(postRef, {
          likesCount: increment(1),
          likedBy: arrayUnion(userId)
        });

        // Core Post/Reel notification creation
        const reelDoc = reels.find(r => r.id === reelId);
        if (reelDoc && reelDoc.userId !== userId) {
          await addDoc(collection(db, 'feed_notifications'), {
            receiverId: reelDoc.userId,
            senderId: userId,
            senderName: userProfile?.displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Campus Student',
            senderAvatar: userProfile?.avatarUrl || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
            type: 'like',
            postId: reelId,
            postContent: reelDoc.content || '',
            createdAt: serverTimestamp(),
            seen: false
          });
        }

        await logActivity(`Liked a student reel!`);
      }
    } catch (e) {
      console.error("Failed to like reel:", e);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !commentsReelId || !newCommentText.trim()) return;

    const textToSubmit = newCommentText.trim();
    setNewCommentText('');

    // Pre-populate locally for super-fast reactive interface
    const tempId = 'temp-' + Date.now();
    const tempComment = {
      id: tempId,
      userId: auth.currentUser.uid,
      userName: userProfile?.displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Campus Student',
      userAvatar: userProfile?.avatarUrl || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
      content: textToSubmit,
      createdAt: { toDate: () => new Date() }
    };
    
    setReelComments(prev => [...prev, tempComment]);

    // Optimistically bump comments count in current reels view
    setReels(prev => prev.map(r => r.id === commentsReelId ? { ...r, commentsCount: (r.commentsCount || 0) + 1 } : r));

    try {
      const reelRef = doc(db, 'posts', commentsReelId);
      
      // Save comment in subcollection
      await addDoc(collection(db, 'posts', commentsReelId, 'comments'), {
        userId: auth.currentUser.uid,
        userName: userProfile?.displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Campus Student',
        userAvatar: userProfile?.avatarUrl || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
        content: textToSubmit,
        createdAt: serverTimestamp()
      });

      // Update counter on parent
      await updateDoc(reelRef, {
        commentsCount: increment(1)
      });

      // Dispatch real-time interaction notification to reel owner
      const reelDoc = reels.find(r => r.id === commentsReelId);
      if (reelDoc && reelDoc.userId !== auth.currentUser.uid) {
        await addDoc(collection(db, 'feed_notifications'), {
          receiverId: reelDoc.userId,
          senderId: auth.currentUser.uid,
          senderName: userProfile?.displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Campus Student',
          senderAvatar: userProfile?.avatarUrl || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
          type: 'comment',
          postId: commentsReelId,
          postContent: reelDoc.content || '',
          commentText: textToSubmit,
          createdAt: serverTimestamp(),
          seen: false
        });
      }

      await logActivity(`Commented on student reel: "${textToSubmit.substring(0, 20)}..."`);
    } catch (err) {
      console.error("Failed to post comment to reel:", err);
      // Rollback optimistic state if fails
      setReelComments(prev => prev.filter(c => c.id !== tempId));
      setReels(prev => prev.map(r => r.id === commentsReelId ? { ...r, commentsCount: Math.max(0, (r.commentsCount || 1) - 1) } : r));
    }
  };

  return (
    <div className="h-[calc(100vh-12rem)] max-w-md mx-auto relative bg-slate-900 rounded-[2rem] overflow-hidden shadow-2xl">
      {reels.length === 0 ? (
        <div className="h-full w-full flex flex-col justify-center items-center text-center p-8 bg-slate-950 text-white italic-none">
          <div className="w-16 h-16 bg-blue-600/10 text-blue-500 rounded-3xl flex items-center justify-center mb-6 border border-blue-500/20">
            <Video size={28} />
          </div>
          <h3 className="text-xl font-bold mb-2">No Campus Reels Yet</h3>
          <p className="text-sm text-slate-400 mb-8 max-w-xs leading-relaxed">
            Be the pioneer! Create and upload the very first short video of student life at your university.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-6 py-3.5 bg-blue-600 hover:bg-blue-700 rounded-2xl font-bold text-sm transition-all active:scale-95 shadow-xl shadow-blue-500/20"
          >
            <Plus size={18} /> Publish First Reel
          </button>
        </div>
      ) : (
        <div className="h-full overflow-y-scroll snap-y snap-mandatory scrollbar-hide">
          {reels.map((reel, i) => (
            <div key={reel.id} className="h-full w-full snap-start relative italic-none">
              <video
                src={reel.videoUrl}
                className="w-full h-full object-cover"
                autoPlay={i === activeIndex && isPlaying}
                loop
                muted
                playsInline
              />

              {/* Overlay Gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />

              {/* Floating Trigger to Add */}
              <button
                onClick={() => setShowAddModal(true)}
                className="absolute top-4 right-4 p-3 bg-white/15 hover:bg-white/25 backdrop-blur-md rounded-2xl hover:scale-105 transition-all text-white border border-white/10 z-10"
                title="Publish Campus Reel"
              >
                <Plus size={20} />
              </button>

              {/* Content Body */}
              <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col gap-4 pointer-events-auto">
                <div className="flex items-end justify-between gap-4">
                  <div className="flex-1 text-white space-y-4">
                    <div className="flex items-center gap-2 group">
                      <img 
                        src={reel.userAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${reel.userName}`} 
                        className="w-10 h-10 rounded-full border-2 border-white shadow-lg object-cover" 
                        alt="" 
                      />
                      <div className="italic-none">
                        <h4 className="font-bold flex items-center gap-1 italic-none">
                          {reel.userName}
                          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                        </h4>
                        <p className="text-[10px] text-white/70 italic-none flex items-center gap-1 font-bold uppercase tracking-wider">
                          <MapPin size={8} /> {reel.campus}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm leading-relaxed line-clamp-2 italic-none">{reel.content}</p>
                    <div className="flex items-center gap-2 text-xs text-white/80 bg-white/10 backdrop-blur-md px-3 py-2 rounded-xl italic-none border border-white/10 w-fit">
                      <Music2 size={12} className="shrink-0 animate-pulse" />
                      <span className="truncate italic-none max-w-[120px]">Original audio</span>
                    </div>
                  </div>

                  {/* Vertical Actions */}
                  <div className="flex flex-col gap-6 italic-none mb-2 select-none">
                    <motion.button 
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => handleLike(reel.id, reel.likedBy || [])}
                      className="flex flex-col items-center gap-1 group focus:outline-none"
                    >
                      <div className="p-3 bg-white/10 backdrop-blur-xl rounded-2xl group-hover:bg-red-500/20 transition-all border border-white/20 relative">
                        <Heart size={22} className={`text-white transition-all duration-300 ${(reel.likedBy || []).includes(auth.currentUser?.uid) ? "fill-red-500 text-red-500 scale-110" : ""}`} />
                      </div>
                      <span className="text-[10px] font-black text-white">{reel.likesCount || 0}</span>
                    </motion.button>

                    <motion.button 
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => {
                        setCommentsReelId(reel.id);
                        setShowCommentsModal(true);
                      }}
                      className="flex flex-col items-center gap-1 group focus:outline-none"
                    >
                      <div className="p-3 bg-white/10 backdrop-blur-xl rounded-2xl group-hover:bg-blue-500/20 transition-all border border-white/20">
                        <MessageCircle size={22} className="text-white group-hover:text-blue-500 transition-colors" />
                      </div>
                      <span className="text-[10px] font-black text-white">{reel.commentsCount || 0}</span>
                    </motion.button>

                    <motion.button 
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => {
                        const messageToShare = `Watch this amazing student reel from @${reel.userName || 'student'} on Campus-Connect! 🎬 "${reel.content || 'Video Reel'}"\n\nJoin the campus network here: ${window.location.origin}`;
                        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(messageToShare)}`;
                        window.open(whatsappUrl, '_blank');
                      }}
                      className="flex flex-col items-center gap-1 group focus:outline-none"
                    >
                      <div className="p-3 bg-white/10 backdrop-blur-xl rounded-2xl group-hover:bg-emerald-500/25 transition-all border border-white/20">
                        <Share2 size={22} className="text-white group-hover:text-emerald-400 transition-colors" />
                      </div>
                      <span className="text-[10px] font-black text-emerald-400">Share</span>
                    </motion.button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Floating dot-based scroll indicator */}
      {reels.length > 0 && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-10">
          {reels.map((_, i) => (
            <div 
              key={i} 
              onClick={() => setActiveIndex(i)}
              className={`w-1 rounded-full cursor-pointer transition-all ${i === activeIndex ? 'bg-white h-7' : 'bg-white/25 h-3'}`} 
            />
          ))}
        </div>
      )}

      {/* Add Reel Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white max-w-sm w-full rounded-3xl border border-slate-200 p-6 shadow-2xl relative z-10 text-slate-800"
            >
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
                <span className="text-sm font-bold flex items-center gap-1.5">
                  <Sparkles size={16} className="text-blue-500" /> Share Campus Reel
                </span>
                <button 
                  onClick={() => setShowAddModal(false)}
                  className="p-1 hover:bg-slate-100 rounded-full transition-all"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleCreateReel} className="space-y-4 text-left">
                <div>
                  <label className="text-xs font-mono font-black text-slate-400 uppercase">Caption</label>
                  <textarea
                    required
                    value={newCaption}
                    onChange={(e) => setNewCaption(e.target.value)}
                    placeholder="Describe your student reel, add tags like #UniLife, #SciLab..."
                    className="w-full mt-1.5 p-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-xs leading-relaxed"
                    rows={3}
                  />
                </div>

                {/* Device Internal Storage Video upload */}
                <div>
                  <label className="text-xs font-mono font-black text-slate-400 uppercase mb-1.5 block">Upload Video from Device</label>
                  <input
                    type="file"
                    accept="video/*"
                    ref={videoInputRef}
                    onChange={handleVideoSelect}
                    className="hidden"
                  />
                  <div 
                    onClick={() => videoInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-200 hover:border-blue-500 rounded-2xl p-4 bg-slate-50 flex flex-col items-center justify-center cursor-pointer transition-all hover:bg-blue-50/20 text-center"
                  >
                    <Upload size={24} className="text-slate-400 mb-1.5" />
                    <span className="text-[11px] font-bold text-slate-700">
                      {videoFileName ? `Selected: ${videoFileName}` : "Select MP4/WebM video from phone/PC"}
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-1 font-mono">Max size 50MB for corridor storage</span>
                  </div>
                  {selectedVideoBase64 && (
                    <div className="mt-2 text-[10px] text-green-600 font-bold flex items-center gap-1">
                      <span>✓ Ready to upload! Cached locally.</span>
                      <button type="button" onClick={() => { setSelectedVideoBase64(null); setVideoFileName(null); }} className="text-red-500 underline ml-2">Clear</button>
                    </div>
                  )}
                </div>

                {!selectedVideoBase64 && (
                  <>
                    <div>
                      <label className="text-xs font-mono font-black text-slate-400 uppercase">Or Video URL</label>
                      <input
                        type="url"
                        value={newVideoUrl}
                        onChange={(e) => setNewVideoUrl(e.target.value)}
                        placeholder="Enter mp4 link (or leave blank to use template)"
                        className="w-full mt-1.5 p-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-medium"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[10px] font-mono font-black text-slate-400 uppercase">Or Choose a Beautiful Template:</span>
                      <div className="flex flex-col gap-2">
                        {templates.map((tmpl) => (
                          <button
                            key={tmpl.name}
                            type="button"
                            onClick={() => setNewVideoUrl(tmpl.url)}
                            className={`text-left p-2.5 rounded-xl border text-xs transition-colors flex items-center justify-between font-bold ${
                              newVideoUrl === tmpl.url 
                                ? 'bg-blue-50 border-blue-600 text-blue-700' 
                                : 'bg-white border-slate-250/60 hover:bg-slate-50 text-slate-800'
                            }`}
                          >
                            <span>{tmpl.name}</span>
                            {newVideoUrl === tmpl.url && <span className="text-[10px] text-blue-600">Selected</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  disabled={loading || !newCaption.trim() || (!selectedVideoBase64 && !newVideoUrl.trim() && !templates.some(t => t.url === newVideoUrl))}
                  className="w-full py-3.5 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all active:scale-95 text-xs flex items-center justify-center gap-2 mt-6"
                >
                  {loading ? (
                    "Publishing..."
                  ) : (
                    <>
                      <Send size={14} /> Publish Reel
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Real-time Comments Drawer */}
      <AnimatePresence>
        {showCommentsModal && (
          <div className="absolute inset-0 z-[110] flex items-end">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowCommentsModal(false);
                setCommentsReelId(null);
              }}
              className="absolute inset-0 bg-black"
            />

            {/* Sliding Panel */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="bg-white w-full rounded-t-[2.5rem] p-6 pb-8 shadow-2xl relative z-10 text-slate-800 flex flex-col h-[75%] border-t border-slate-100"
            >
              {/* Header handle */}
              <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-4 cursor-pointer hover:bg-slate-300" onClick={() => { setShowCommentsModal(false); setCommentsReelId(null); }} />
              
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
                <span className="text-sm font-black flex items-center gap-1.5 text-slate-900">
                  <MessageCircle size={18} className="text-blue-500" />
                  Student Dialogue ({reelComments.length})
                </span>
                <button 
                  onClick={() => {
                    setShowCommentsModal(false);
                    setCommentsReelId(null);
                  }}
                  className="p-1 hover:bg-slate-100 rounded-full transition-all text-slate-500"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Comments Scrollable Feed */}
              <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
                {reelComments.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                    <MessageCircle size={32} className="opacity-20 mb-2 text-slate-400" />
                    <p className="text-xs font-bold text-slate-800">No student comments yet.</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Be the first to say something!</p>
                  </div>
                ) : (
                  reelComments.map((comment) => (
                    <div key={comment.id} className="flex gap-3 text-xs leading-relaxed">
                      <img 
                        src={comment.userAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${comment.userName}`} 
                        className="w-8 h-8 rounded-full border border-slate-200 shrink-0 object-cover" 
                        alt="" 
                      />
                      <div className="bg-slate-50 border border-slate-100 rounded-2xl px-3.5 py-2 flex-1 relative text-left">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-extrabold text-slate-900">{comment.userName}</span>
                          <span className="text-[9px] text-slate-400 font-mono">
                            {comment.createdAt?.toDate ? format(comment.createdAt.toDate(), 'HH:mm') : 'now'}
                          </span>
                        </div>
                        <p className="text-slate-700 italic-none whitespace-pre-wrap">{comment.content}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Submission Input Box */}
              <form onSubmit={handleAddComment} className="mt-4 flex items-center gap-2 pt-2 border-t border-slate-100">
                <input
                  type="text"
                  required
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder="Add a real-time comment..."
                  className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-xs text-slate-800"
                />
                <button
                  type="submit"
                  disabled={!newCommentText.trim()}
                  className="p-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-2xl transition-all active:scale-95"
                >
                  <Send size={15} />
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
