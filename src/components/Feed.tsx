import { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, increment, arrayUnion, arrayRemove, where, deleteDoc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Image, Send, Heart, MessageCircle, Share2, MoreHorizontal, CheckCircle2, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { VerificationBadge } from './VerificationBadge';
import { cn } from '../lib/utils';

export default function Feed() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'my-campus' | 'global'>('global');
  const [usersMap, setUsersMap] = useState<Record<string, { email: string; verified: boolean }>>({});
  const [liveNotifications, setLiveNotifications] = useState<any[]>([]);

  // WhatsApp-like ephemeral statuses (expire after 24 hrs)
  const [statusesList, setStatusesList] = useState<any[]>([]);
  const [showCreateStatusModal, setShowCreateStatusModal] = useState(false);
  const [newStatusText, setNewStatusText] = useState('');
  const [newStatusImage, setNewStatusImage] = useState<string | null>(null);
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);
  
  const [activeStatusUserGroup, setActiveStatusUserGroup] = useState<any | null>(null); // contains individual student uid + list of their stories
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const statusFileRef = useRef<HTMLInputElement>(null);

  // Friends & Visibility Control state
  const [friendsList, setFriendsList] = useState<string[]>([]);
  const [activeMenuPostId, setActiveMenuPostId] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editContentText, setEditContentText] = useState('');
  const [postVisibility, setPostVisibility] = useState<'public' | 'friends'>('public');

  // Direct Reply states
  const [expandedReplyPostId, setExpandedReplyPostId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);

  // Pull to refresh states and ref trackers
  const [pullY, setPullY] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (window.scrollY === 0 && !isRefreshing) {
      startYRef.current = e.touches[0].clientY;
      isPullingRef.current = true;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isPullingRef.current || isRefreshing) return;
    const currentY = e.touches[0].clientY;
    const diffY = currentY - startYRef.current;

    if (diffY > 0) {
      const calculatedPull = Math.min(diffY * 0.35, 80);
      setPullY(calculatedPull);
      
      if (calculatedPull > 10) {
        if (e.cancelable) e.preventDefault();
      }
    }
  };

  const handleTouchEnd = async () => {
    if (!isPullingRef.current) return;
    isPullingRef.current = false;

    if (pullY >= 55) {
      setIsRefreshing(true);
      setPullY(45); // lock at refreshing indicator display height

      try {
        await logActivity("Refreshed their campus feed page.");
        // We simulate a reload duration for smooth, responsive UX
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (err) {
        console.warn("Pull-to-refresh log activity failed:", err);
      } finally {
        setIsRefreshing(false);
        setPullY(0);
      }
    } else {
      setPullY(0);
    }
  };

  // Sync unread notifications for current user in real-time
  useEffect(() => {
    if (!auth.currentUser) return;
    const qNotifications = query(
      collection(db, 'feed_notifications'),
      where('receiverId', '==', auth.currentUser.uid),
      where('seen', '==', false)
    );
    const unsubscribe = onSnapshot(qNotifications, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLiveNotifications(list);
    }, (error) => {
      console.error("Failed to subscribe to real-time feed notifications:", error);
    });
    return unsubscribe;
  }, [auth.currentUser]);

  const dismissNotification = async (notifId: string) => {
    try {
      await updateDoc(doc(db, 'feed_notifications', notifId), { seen: true });
    } catch (err) {
      console.error("Failed to mark notification as seen:", err);
    }
  };

  // Image Upload States
  const [postImageBase64, setPostImageBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active Expand Comments State (tracks expanded postId)
  const [expandedPostComments, setExpandedPostComments] = useState<{ [postId: string]: boolean }>({});

  useEffect(() => {
    if (!auth.currentUser) return;
    const path = 'users';
    // Real time users map lookup
    const unsubUsers = onSnapshot(
      collection(db, path), 
      (snapshot) => {
        const map: Record<string, { email: string; verified: boolean }> = {};
        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          map[doc.id] = {
            email: data.email || '',
            verified: !!data.verified,
          };
        });
        setUsersMap(map);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );

    return () => unsubUsers();
  }, [auth.currentUser]);

  useEffect(() => {
    if (!auth.currentUser) return;
    
    // Check verification status and fetch campus details in real-time
    const userPath = `users/${auth.currentUser.uid}`;
    const unsubUser = onSnapshot(
      doc(db, 'users', auth.currentUser.uid), 
      (docSnap) => {
        const data = docSnap.data();
        if (data) {
          setIsVerified(data.verified || false);
          setUserProfile(data);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, userPath);
      }
    );

    // Sync user's verified friends checklist to filter private posts
    let unsub1 = () => {};
    let unsub2 = () => {};
    if (auth.currentUser) {
      const q1 = query(collection(db, 'friendships'), where('user1Id', '==', auth.currentUser.uid));
      const q2 = query(collection(db, 'friendships'), where('user2Id', '==', auth.currentUser.uid));
      unsub1 = onSnapshot(q1, (snap1) => {
        const ids = snap1.docs.map(d => d.data().user2Id);
        setFriendsList(prev => Array.from(new Set([...prev, ...ids])));
      });
      unsub2 = onSnapshot(q2, (snap2) => {
        const ids = snap2.docs.map(d => d.data().user1Id);
        setFriendsList(prev => Array.from(new Set([...prev, ...ids])));
      });
    }

    // Real-time statuses (last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const qStatuses = query(
      collection(db, 'statuses'),
      where('createdAt', '>=', twentyFourHoursAgo)
    );
    const unsubStatuses = onSnapshot(qStatuses, (snap) => {
      const allStatuses = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort by createdAt chronologically asc
      allStatuses.sort((a: any, b: any) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return tA - tB;
      });
      setStatusesList(allStatuses);
    }, (error) => {
      console.error("Failed to load statuses in real-time:", error);
    });

    const postsPath = 'posts';
    const q = query(collection(db, postsPath), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q, 
      (snapshot) => {
        const p = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setPosts(p);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, postsPath);
      }
    );

    return () => {
      unsubUser();
      unsubscribe();
      unsub1();
      unsub2();
      unsubStatuses();
    };
  }, [auth.currentUser]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPostImageBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePost = async () => {
    if (!content.trim() && !postImageBase64) return;
    if (!auth.currentUser || !isVerified) return;

    try {
      const campusCode = userProfile?.campus || 'CAMPUS';
      await addDoc(collection(db, 'posts'), {
        userId: auth.currentUser.uid,
        userName: userProfile?.displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0],
        userAvatar: userProfile?.avatarUrl || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
        content,
        mediaType: 'text',
        mediaUrl: postImageBase64 || null,
        likesCount: 0,
        commentsCount: 0,
        campus: campusCode,
        createdAt: serverTimestamp(),
        visibility: postVisibility || 'public'
      });
      setContent('');
      setPostImageBase64(null);
      setPostVisibility('public');
    } catch (error) {
      console.error("Error adding post:", error);
    }
  };

  const handleAddDirectReply = async (postId: string, postOwnerId: string, postContentText: string) => {
    if (!replyText.trim() || !auth.currentUser) return;
    setSubmittingReply(true);

    try {
      const parentRef = doc(db, 'posts', postId);
      const textToSubmit = replyText.trim();
      setReplyText('');
      setExpandedReplyPostId(null);

      // Save comment item inside posts subcollection
      await addDoc(collection(db, 'posts', postId, 'comments'), {
        userId: auth.currentUser.uid,
        userName: userProfile?.displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Campus Student',
        userAvatar: userProfile?.avatarUrl || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
        content: textToSubmit,
        createdAt: serverTimestamp()
      });

      // Update counters
      await updateDoc(parentRef, {
        commentsCount: increment(1)
      });

      // Broadcast real-time activity notification
      if (postOwnerId && postOwnerId !== auth.currentUser.uid) {
        await addDoc(collection(db, 'feed_notifications'), {
          receiverId: postOwnerId,
          senderId: auth.currentUser.uid,
          senderName: userProfile?.displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0],
          senderAvatar: userProfile?.avatarUrl || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?id=${auth.currentUser.uid}`,
          type: 'comment',
          postId: postId,
          postContent: postContentText || '',
          commentText: textToSubmit,
          createdAt: serverTimestamp(),
          seen: false
        });
      }

      await logActivity(`Submitted direct input reply: "${textToSubmit.substring(0, 24)}..."`);
    } catch (err) {
      console.error("Failed to post direct reply:", err);
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleLike = async (post: any) => {
    if (!auth.currentUser) return;
    const postId = post.id;
    const likedBy = post.likedBy || [];
    const postRef = doc(db, 'posts', postId);
    const userId = auth.currentUser.uid;
    const hasLiked = likedBy.includes(userId);

    try {
      if (hasLiked) {
        await updateDoc(postRef, {
          likesCount: increment(-1),
          likedBy: arrayRemove(userId)
        });
      } else {
        await updateDoc(postRef, {
          likesCount: increment(1),
          likedBy: arrayUnion(userId)
        });

        // Trigger real-time notification
        if (post.userId && post.userId !== userId) {
          addDoc(collection(db, 'feed_notifications'), {
            receiverId: post.userId,
            senderId: userId,
            senderName: userProfile?.displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Campus Student',
            senderAvatar: userProfile?.avatarUrl || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
            type: 'like',
            postId: postId,
            postContent: post.content || '',
            createdAt: serverTimestamp(),
            seen: false
          }).catch(err => console.error("Failed to create like notification:", err));
        }
      }
    } catch (e) {
      console.error("Failed to like post:", e);
    }
  };

  const handleShareToWhatsApp = (post: any) => {
    const postLink = `${window.location.origin}/?postId=${post.id}`;
    const textToSend = `Check out this post from @${post.userName} on Campus-Nomad: "${post.content}"\n\nRead original post here: ${postLink}`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(textToSend)}`;
    window.open(url, '_blank');
  };

  const handleStatusImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setNewStatusImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleCreateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || (!newStatusText.trim() && !newStatusImage)) return;
    setIsSubmittingStatus(true);
    try {
      await addDoc(collection(db, 'statuses'), {
        userId: auth.currentUser.uid,
        userName: userProfile?.displayName || auth.currentUser.email?.split('@')[0] || 'Student',
        userAvatar: userProfile?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.uid}`,
        content: newStatusText.trim(),
        mediaUrl: newStatusImage,
        createdAt: serverTimestamp(),
        campus: userProfile?.campus || 'CAMPUS'
      });
      setNewStatusText('');
      setNewStatusImage(null);
      setShowCreateStatusModal(false);
    } catch (err) {
      console.error("Failed to upload status:", err);
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  const handleDeleteStatus = async (statusId: string) => {
    try {
      await deleteDoc(doc(db, 'statuses', statusId));
      setActiveStatusUserGroup(null);
    } catch (err) {
      console.error("Failed to delete status:", err);
    }
  };

  const toggleComments = (postId: string) => {
    setExpandedPostComments(prev => ({
      ...prev,
      [postId]: !prev[postId]
    }));
  };

  // Filter posts based on campus if active tab is 'my-campus' AND check visibility rules
  const sharedPostId = new URLSearchParams(window.location.search).get('postId');

  const filteredPostsRaw = posts.filter(post => {
    // If it's the shared deep link post, always include it regardless of tab
    if (sharedPostId && post.id === sharedPostId) {
      return true;
    }

    // 1. Campus constraint
    if (activeTab === 'my-campus') {
      const myCampus = userProfile?.campus || '';
      const campusMatch = (post.campus || '').toLowerCase() === myCampus.toLowerCase();
      if (!campusMatch) return false;
    }
    
    // 2. Friends / Privacy visibility check
    if (post.visibility === 'friends') {
      const isOwner = post.userId === auth.currentUser?.uid;
      const isAdmin = auth.currentUser?.email === 'nnanwubagabriel@gmail.com';
      const isFriend = friendsList.includes(post.userId);
      return isOwner || isAdmin || isFriend;
    }

    return true; // Public
  });

  // Sort: If there's a sharedPostId, place it at the very top of the list!
  const filteredPosts = [...filteredPostsRaw].sort((a, b) => {
    if (sharedPostId) {
      if (a.id === sharedPostId) return -1;
      if (b.id === sharedPostId) return 1;
    }
    return 0; // maintain original chronological order
  });

  // Group active ephemeral statuses by student userId
  const groupedStatuses: Record<string, { userId: string; userName: string; userAvatar: string; items: any[] }> = {};
  statusesList.forEach(status => {
    const sUserId = status.userId || '';
    if (!groupedStatuses[sUserId]) {
      groupedStatuses[sUserId] = {
        userId: sUserId,
        userName: status.userName || 'Student',
        userAvatar: status.userAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${sUserId}`,
        items: []
      };
    }
    groupedStatuses[sUserId].items.push(status);
  });

  return (
    <div 
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="space-y-6 max-w-2xl mx-auto select-none"
    >
      {/* 📥 Pull-to-Refresh Indicator Banner */}
      {(pullY > 0 || isRefreshing) && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: pullY || 45 }}
          exit={{ opacity: 0, height: 0 }}
          className="w-full overflow-hidden flex items-center justify-center gap-2 bg-gradient-to-r from-blue-50/50 to-slate-50/50 border border-dashed border-slate-200/60 rounded-[1.5rem] py-1 shadow-inner relative z-30"
        >
          {isRefreshing ? (
            <div className="flex items-center gap-2 text-blue-600">
              <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-[10px] font-sans font-black uppercase tracking-widest leading-none">
                Refreshing Feed...
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-500">
              <motion.span 
                animate={{ rotate: pullY >= 55 ? 180 : 0 }}
                className="text-xs"
              >
                ⬇️
              </motion.span>
              <span className="text-[10px] font-mono leading-none font-bold uppercase tracking-widest">
                {pullY >= 55 ? "Release to sync feed" : "Pull down to refresh"}
              </span>
            </div>
          )}
        </motion.div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('my-campus')}
          className={`pb-3 px-2 text-sm font-bold transition-colors relative ${activeTab === 'my-campus' ? 'text-blue-600' : 'text-slate-500'}`}
        >
          My Campus ({userProfile?.campus || 'CAMPUS'})
          {activeTab === 'my-campus' && (
            <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('global')}
          className={`pb-3 px-2 text-sm font-bold transition-colors relative ${activeTab === 'global' ? 'text-blue-600' : 'text-slate-500'}`}
        >
          Global Arena
          {activeTab === 'global' && (
            <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
          )}
        </button>
      </div>

      {/* Ephemeral WhatsApp-like Status Stories Bar */}
      <div className="flex gap-4 items-center overflow-x-auto py-3 px-4 bg-white border border-slate-200 rounded-[2rem] shadow-smScroll bar no-scrollbar no-scroll-decoration scrollbar-none shrink-0 select-none">
        {/* Helper calculations */}
        {(() => {
          const myId = auth.currentUser?.uid || '';
          const myGroup = groupedStatuses[myId];
          const otherGroups = Object.values(groupedStatuses).filter((g: any) => g.userId !== myId);

          return (
            <>
              {/* Add/View My Status */}
              <div className="flex flex-col items-center shrink-0">
                <div className="relative cursor-pointer group" onClick={() => {
                  if (myGroup) {
                    setActiveStatusUserGroup(myGroup);
                    setActiveStoryIndex(0);
                  } else {
                    setShowCreateStatusModal(true);
                  }
                }}>
                  <div className={cn(
                    "w-14 h-14 rounded-full p-0.5 flex items-center justify-center transition-all bg-white border-2",
                    myGroup ? "border-blue-500 scale-102" : "border-slate-200 border-dashed hover:border-slate-400"
                  )}>
                    <img 
                      src={userProfile?.avatarUrl || auth.currentUser?.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser?.email}`}
                      className="w-full h-full rounded-full object-cover bg-slate-50"
                      alt="My Avatar"
                    />
                  </div>
                  {/* Plus Badge if no current status upload is active */}
                  {!myGroup && (
                    <div className="absolute bottom-0 right-0 w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center border-2 border-white text-white font-bold text-xs shadow-sm">
                      +
                    </div>
                  )}
                </div>
                <span className="text-[10px] font-bold text-slate-500 mt-1 max-w-[65px] truncate">My Status</span>
              </div>

              {/* Other student statuses */}
              {otherGroups.map((g: any) => {
                const hasViewerActive = activeStatusUserGroup?.userId === g.userId;
                return (
                  <div key={g.userId} className="flex flex-col items-center shrink-0">
                    <button 
                      onClick={() => {
                        setActiveStatusUserGroup(g);
                        setActiveStoryIndex(0);
                      }}
                      className="relative cursor-pointer focus:outline-none transition-transform active:scale-95"
                    >
                      <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-yellow-400 via-orange-500 to-indigo-600 p-0.5 flex items-center justify-center scale-102">
                        <div className="w-full h-full rounded-full bg-white p-0.5 flex items-center justify-center">
                          <img 
                            src={g.userAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${g.userId}`} 
                            className="w-full h-full rounded-full object-cover bg-slate-50" 
                            alt={g.userName} 
                          />
                        </div>
                      </div>
                    </button>
                    <span className="text-[10px] font-bold text-slate-800 dark:text-slate-200 mt-1 max-w-[65px] truncate text-center">
                      {g.userName}
                    </span>
                  </div>
                );
              })}

              {/* Empty state nudge to post first status if empty */}
              {otherGroups.length === 0 && (
                <div onClick={() => setShowCreateStatusModal(true)} className="flex items-center gap-2 cursor-pointer text-left pl-2 select-none group">
                  <div className="text-[10px] font-bold text-slate-400 group-hover:text-blue-600 transition-colors">
                    <p className="font-extrabold text-slate-700">What's happening? 🚀</p>
                    <p className="text-[9px] text-slate-400 font-medium">Tap to share a disappearing study snap status!</p>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Create Post */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex gap-4">
          <img 
            src={userProfile?.avatarUrl || auth.currentUser?.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser?.email}`} 
            className="w-11 h-11 rounded-full object-cover border-2 border-white shadow-md bg-white shrink-0" 
            alt="Me" 
          />
          <div className="flex-1 min-w-0">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={isVerified ? "Tell Campus-Nomad what's happening or add a study snap..." : "Verify your account to write posts to the dynamic feed"}
              disabled={!isVerified}
              className="w-full bg-transparent border-none focus:ring-0 text-slate-800 placeholder-slate-400 resize-none min-h-[85px] outline-none text-sm leading-relaxed"
            />

            {/* Post Image Mini Preview */}
            <AnimatePresence>
              {postImageBase64 && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="relative mt-2 rounded-2xl overflow-hidden max-h-60 border border-slate-100 bg-slate-50"
                >
                  <img src={postImageBase64} className="w-full h-full object-cover" alt="Selected upload" />
                  <button
                    onClick={() => setPostImageBase64(null)}
                    className="absolute top-2 right-2 p-1.5 bg-slate-900/80 hover:bg-slate-950 text-white rounded-full transition-all"
                  >
                    <X size={14} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-2">
              <div className="flex gap-2 items-center">
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleImageSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => isVerified && fileInputRef.current?.click()}
                  disabled={!isVerified}
                  className={`p-2.5 rounded-xl transition-colors ${
                    isVerified 
                      ? 'text-slate-500 hover:text-blue-600 hover:bg-blue-50' 
                      : 'text-slate-350 cursor-not-allowed'
                  }`}
                  title="Upload campus snap image"
                >
                  <Image size={20} />
                </button>

                {isVerified && (
                  <select
                    value={postVisibility}
                    onChange={(e) => setPostVisibility(e.target.value as any)}
                    className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-bold text-slate-600 focus:outline-none"
                    title="Control who is able to see this upload in the arena"
                  >
                    <option value="public">🌍 Public Arena</option>
                    <option value="friends">👥 Friends Only Check</option>
                  </select>
                )}
              </div>
              <button
                onClick={handlePost}
                disabled={(!content.trim() && !postImageBase64) || !isVerified}
                className={`px-5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all text-xs ${
                  (content.trim() || postImageBase64) && isVerified
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-200 hover:bg-blue-700 hover:-translate-y-0.5"
                    : "bg-slate-100 text-slate-400 cursor-not-allowed"
                }`}
              >
                <Send size={14} />
                Publish Post
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Feed Posts */}
      <div className="space-y-5">
        {loading ? (
          Array(3).fill(0).map((_, i) => (
            <div key={i} className="h-48 bg-white border border-slate-200 rounded-3xl animate-pulse" />
          ))
        ) : filteredPosts.length === 0 ? (
          <div className="text-center py-16 bg-white border border-slate-200 rounded-[2rem] p-8">
            <MessageCircle size={48} className="mx-auto text-slate-300 mb-4 stroke-1 animate-pulse" />
            <h3 className="text-lg font-bold text-slate-800 mb-1">No Posts Yet</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              Be the very first verified student to write a post in this arena. Write a shoutout!
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {filteredPosts.map((post) => {
              const showComments = !!expandedPostComments[post.id];
              const isShared = post.id === sharedPostId;
              
              return (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, y: 35, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  whileHover={{ y: -4, scale: 1.006, boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.04), 0 4px 6px -4px rgb(0 0 0 / 0.04)" }}
                  transition={{ type: "spring", stiffness: 350, damping: 25 }}
                  className={cn(
                    "bg-white border rounded-[2rem] transition-colors overflow-hidden",
                    isShared ? "border-blue-500 ring-2 ring-blue-500/20" : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  {isShared && (
                    <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[10px] font-black uppercase tracking-wider py-2 px-5 flex items-center justify-between">
                      <span>🔗 SHARED POST LINK • VIP PINNED</span>
                      <span className="bg-white/20 px-2 py-0.5 rounded-full text-[9px] font-sans">CORRIDOR ACCESS</span>
                    </div>
                  )}
                  <div className="p-5 flex gap-4">
                    <img 
                      src={post.userAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${post.userName}`} 
                      className="w-11 h-11 rounded-full object-cover border border-slate-100 shadow-xs shrink-0 bg-slate-50" 
                      alt="" 
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5 leading-tight">
                            {post.userName}
                            <VerificationBadge 
                              email={usersMap[post.userId]?.email || (post.userId === auth.currentUser?.uid ? auth.currentUser?.email || undefined : undefined)} 
                              verified={usersMap[post.userId]?.verified} 
                            />
                            <span className="text-[10px] text-blue-600 bg-blue-50/70 border border-blue-100 rounded-full px-2 py-0.5 leading-none font-bold uppercase tracking-wide">
                              {post.campus}
                            </span>
                          </h4>
                          <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black mt-0.5">
                            {post.createdAt ? formatDistanceToNow(post.createdAt.toDate()) : 'just now'} ago
                          </p>
                        </div>
                        <div className="relative">
                          <button 
                            onClick={() => setActiveMenuPostId(activeMenuPostId === post.id ? null : post.id)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all focus:outline-none" 
                            title="Post Options"
                          >
                            <MoreHorizontal size={18} />
                          </button>
                          
                          {activeMenuPostId === post.id && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setActiveMenuPostId(null)} />
                              <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-2xl shadow-xl py-2 z-50 text-xs">
                                {(post.userId === auth.currentUser?.uid || auth.currentUser?.email === 'nnanwubagabriel@gmail.com') ? (
                                  <>
                                    <button 
                                      onClick={() => {
                                        setEditingPostId(post.id);
                                        setEditContentText(post.content || '');
                                        setActiveMenuPostId(null);
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-slate-50 font-bold text-slate-700"
                                    >
                                      📝 Edit Post Content
                                    </button>
                                    <div className="border-t border-slate-100 my-1"></div>
                                    <div className="px-4 py-1.5 text-[9px] uppercase tracking-wider text-slate-450 font-mono font-black">Visibility controls:</div>
                                    <button 
                                      onClick={async () => {
                                        await updateDoc(doc(db, 'posts', post.id), { visibility: 'public' });
                                        setActiveMenuPostId(null);
                                      }}
                                      className={`w-full text-left px-4 py-2 hover:bg-slate-50 text-[11px] font-bold ${(!post.visibility || post.visibility === 'public') ? 'text-blue-600 bg-blue-50/50' : 'text-slate-600'}`}
                                    >
                                      🌍 Public Arena Link
                                    </button>
                                    <button 
                                      onClick={async () => {
                                        await updateDoc(doc(db, 'posts', post.id), { visibility: 'friends' });
                                        setActiveMenuPostId(null);
                                      }}
                                      className={`w-full text-left px-4 py-2 hover:bg-slate-50 text-[11px] font-bold ${(post.visibility === 'friends') ? 'text-blue-600 bg-blue-50/50' : 'text-slate-600'}`}
                                    >
                                      👥 Friends Only Check
                                    </button>
                                    <div className="border-t border-slate-100 my-1"></div>
                                    <button 
                                      onClick={async () => {
                                        if (window.confirm("Are you positive you wish to permanently delete this post from the campus feed? This is irreversible.")) {
                                          // Optimistic deletion to make the action instant and ultra-responsive in the UI
                                          setPosts(prev => prev.filter(p => p.id !== post.id));
                                          
                                          try {
                                            await deleteDoc(doc(db, 'posts', post.id));
                                            await logActivity("Deleted a campus feed post permanently.");
                                          } catch (err) {
                                            console.error("Failed to delete post:", err);
                                            alert("Could not complete safety deletion on backend.");
                                          }
                                        }
                                        setActiveMenuPostId(null);
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600 font-bold transition-colors cursor-pointer"
                                    >
                                      🗑️ Delete Post
                                    </button>
                                  </>
                                ) : (
                                  <div className="px-4 py-2 text-slate-400 font-extrabold italic text-center">
                                    No Admin Permissions
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {editingPostId === post.id ? (
                        <div className="mt-3 space-y-2">
                          <textarea
                            value={editContentText}
                            onChange={(e) => setEditContentText(e.target.value)}
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-xs text-slate-800"
                            rows={3}
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => setEditingPostId(null)}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={async () => {
                                if (editContentText.trim()) {
                                  await updateDoc(doc(db, 'posts', post.id), { content: editContentText.trim() });
                                  setEditingPostId(null);
                                }
                              }}
                              className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl text-xs transition-colors"
                            >
                              Save Updates
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 text-slate-800 leading-relaxed text-sm whitespace-pre-wrap">
                          {post.content}
                          {post.visibility === 'friends' && (
                            <span className="inline-flex items-center gap-1.5 ml-2.5 text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-150 px-2.5 py-0.5 rounded-full font-bold">
                              👥 Friends Only
                            </span>
                          )}
                        </div>
                      )}

                      {/* Render Post custom Base64 image */}
                      {post.mediaUrl && (
                        <div className="mt-3 rounded-2xl overflow-hidden border border-slate-100 max-h-96 bg-slate-50">
                          <img 
                            src={post.mediaUrl} 
                            className="w-full h-full object-cover hover:scale-101 transition-transform duration-300 cursor-zoom-in" 
                            alt="Snap" 
                            referrerPolicy="no-referrer"
                            onClick={() => window.open(post.mediaUrl, '_blank')}
                          />
                        </div>
                      )}

                      {/* Interactive Actions Grid (LIKE, COMMENT, SHARE TO WHATSAPP ONLY as requested) */}
                      <div className="mt-4 flex items-center gap-6 pt-3 border-t border-slate-100">
                        <motion.button
                          whileHover={{ scale: 1.15 }}
                          whileTap={{ scale: 0.85 }}
                          onClick={() => handleLike(post)}
                          className="flex items-center gap-1.5 text-slate-500 hover:text-red-600 transition-all group focus:outline-none"
                        >
                          <Heart size={18} className={`transition-all duration-300 ${
                            (post.likedBy || []).includes(auth.currentUser?.uid) 
                              ? "fill-red-500 text-red-500 scale-110" 
                              : ""
                          }`} />
                          <span className="text-xs font-bold">{post.likesCount || 0}</span>
                        </motion.button>
                        
                        <button 
                          onClick={() => toggleComments(post.id)}
                          className={`flex items-center gap-1.5 transition-colors ${expandedPostComments[post.id] ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600'}`}
                        >
                          <MessageCircle size={18} />
                          <span className="text-xs font-bold">{post.commentsCount || 0}</span>
                        </button>

                        <button
                          onClick={() => navigate(`/chat?userId=${post.userId}`)}
                          className="flex items-center gap-1 font-bold text-xs text-slate-500 hover:text-blue-650 hover:bg-slate-50 transition-colors px-2.5 py-1 rounded-full border border-transparent"
                          title="Reply direct to student chat"
                        >
                          💬 Reply
                        </button>

                        <button 
                          onClick={() => handleShareToWhatsApp(post)}
                          className="flex items-center gap-1.5 text-slate-500 hover:text-emerald-600 transition-colors bg-emerald-50 hover:bg-emerald-100/60 px-2.5 py-1 rounded-full border border-emerald-100"
                          title="Share to WhatsApp only"
                        >
                          <Share2 size={14} className="text-emerald-500 fill-emerald-50" />
                          <span className="text-[10px] font-bold text-emerald-600">WhatsApp</span>
                        </button>
                      </div>

                      {/* Reply Text Area Expansion */}
                      <AnimatePresence>
                        {expandedReplyPostId === post.id && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-3.5 pt-3 border-t border-dashed border-slate-200/60 overflow-hidden"
                          >
                            <form 
                              onSubmit={(e) => {
                                e.preventDefault();
                                handleAddDirectReply(post.id, post.userId, post.content);
                              }}
                              className="flex gap-2 text-left"
                            >
                              <input
                                type="text"
                                value={replyText}
                                required
                                onChange={(e) => setReplyText(e.target.value)}
                                placeholder="Type your elegant answer/reply straight to the post..."
                                className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-xs text-slate-800"
                              />
                              <button
                                type="submit"
                                disabled={submittingReply || !replyText.trim()}
                                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-black text-xs shrink-0 transition-all active:scale-95 disabled:opacity-50"
                              >
                                {submittingReply ? 'Sending...' : 'Publish'}
                              </button>
                            </form>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Live Expandable Comment Section */}
                      <AnimatePresence>
                        {expandedPostComments[post.id] && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <PostCommentsSection postId={post.id} postRef={doc(db, 'posts', post.id)} userProfile={userProfile} usersMap={usersMap} postOwnerId={post.userId} postContent={post.content} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Real-time floating non-intrusive notifications bubble/toast list */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
        <AnimatePresence>
          {liveNotifications.map((notif) => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, x: 50, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, x: 50, transition: { duration: 0.2 } }}
              className="pointer-events-auto bg-white border border-slate-200 p-4 rounded-2xl shadow-xl flex items-start gap-3 relative overflow-hidden"
            >
              <div className="absolute top-0 bottom-0 left-0 w-1.5 bg-blue-600 animate-pulse" />
              <img
                src={notif.senderAvatar || 'https://api.dicebear.com/7.x/initials/svg'}
                className="w-9 h-9 rounded-full object-cover shrink-0 border border-slate-100"
                alt=""
              />
              <div className="flex-1 text-left min-w-0 pr-1">
                <span className="text-[9px] font-mono font-black text-blue-500 uppercase tracking-widest block mb-0.5">
                  New Campus Activity
                </span>
                <p className="text-xs text-slate-800 font-bold leading-normal">
                  {notif.senderName}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 max-w-xs leading-relaxed truncate">
                  {notif.type === 'like' ? 'Liked your post: ' : 'Replied to your post: '}
                  <span className="italic">"{notif.commentText || notif.postContent || 'Campus post'}"</span>
                </p>
                <div className="flex gap-2.5 mt-2.5">
                  <button
                    onClick={() => dismissNotification(notif.id)}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
                  >
                    Got it
                  </button>
                </div>
              </div>
              <button
                onClick={() => dismissNotification(notif.id)}
                className="text-slate-450 hover:text-slate-600 p-0.5 transition-colors self-start shrink-0"
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* CREATE STATUS STORY MODAL */}
      <AnimatePresence>
        {showCreateStatusModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateStatusModal(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl max-w-sm w-full shadow-2xl relative z-10 text-slate-800 dark:text-white"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
                <h3 className="text-md font-black tracking-tight flex items-center gap-2">
                  <span>🚀</span> Share Your Snap Story
                </h3>
                <button 
                  onClick={() => setShowCreateStatusModal(false)}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleCreateStatus} className="space-y-4 text-left">
                <div>
                  <textarea
                    value={newStatusText}
                    onChange={(e) => setNewStatusText(e.target.value)}
                    placeholder="What's happening right now? Write a cool caption for your story!"
                    maxLength={160}
                    rows={3}
                    className="w-full bg-slate-50 dark:bg-slate-950/30 border border-slate-200 dark:border-slate-800 p-3 rounded-2xl text-xs outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-white resize-none"
                  />
                  <div className="text-right text-[9px] text-slate-400 mt-1 uppercase font-black">
                    {newStatusText.length}/160 characters
                  </div>
                </div>

                {/* Status Image Preview with file support */}
                {newStatusImage ? (
                  <div className="relative rounded-2xl overflow-hidden border border-slate-100 max-h-48 bg-slate-50">
                    <img src={newStatusImage} className="w-full h-full object-contain" alt="Story preview" />
                    <button
                      type="button"
                      onClick={() => setNewStatusImage(null)}
                      className="absolute top-2 right-2 p-1 bg-slate-900/80 hover:bg-slate-950 text-white rounded-full"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div 
                    onClick={() => statusFileRef.current?.click()}
                    className="border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl py-6 hover:bg-slate-50 dark:hover:bg-slate-950/40 text-center cursor-pointer transition-colors"
                  >
                    <span className="text-xs text-slate-400 font-bold block mb-1">📷 Add Story Media Snap</span>
                    <span className="text-[10px] text-slate-400 block font-semibold">Supports photos & graphics</span>
                  </div>
                )}

                <input 
                  type="file" 
                  ref={statusFileRef} 
                  onChange={handleStatusImageSelect} 
                  accept="image/*" 
                  className="hidden" 
                />

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateStatusModal(false)}
                    className="flex-1 py-2.5 bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-transform"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingStatus || (!newStatusText.trim() && !newStatusImage)}
                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-black transition-transform shadow-lg shadow-blue-100 dark:shadow-none"
                  >
                    {isSubmittingStatus ? 'Publishing...' : 'Share Story'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FULLSCREEN STORIES INTERACTIVE VIEWER */}
      <AnimatePresence>
        {activeStatusUserGroup && (() => {
          const stories = activeStatusUserGroup.items || [];
          const currentStory = stories[activeStoryIndex];
          if (!currentStory) return null;

          const isMyOwnStoryStatus = currentStory.userId === auth.currentUser?.uid;

          return (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-0 sm:p-4 bg-slate-950">
              {/* Tap overlays left/right to navigate */}
              <div className="absolute inset-0 flex">
                <div 
                  className="w-1/3 h-full cursor-w-resize" 
                  onClick={() => {
                    if (activeStoryIndex > 0) {
                      setActiveStoryIndex(prev => prev - 1);
                    }
                  }}
                />
                <div 
                  className="w-2/3 h-full cursor-e-resize" 
                  onClick={() => {
                    if (activeStoryIndex < stories.length - 1) {
                      setActiveStoryIndex(prev => prev + 1);
                    } else {
                      // close
                      setActiveStatusUserGroup(null);
                    }
                  }}
                />
              </div>

              {/* Story visual container */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-lg h-full sm:h-[85vh] bg-slate-900 border border-slate-800 text-white shadow-2xl relative flex flex-col justify-between overflow-hidden sm:rounded-3xl pointer-events-auto"
              >
                {/* Visual Progress Bar Indicators at top */}
                <div className="absolute top-4 left-4 right-4 z-10 flex gap-1">
                  {stories.map((s: any, idx: number) => (
                    <div key={s.id} className="h-1 flex-1 bg-white/20 rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full bg-white transition-all",
                          idx < activeStoryIndex ? "w-full" : idx === activeStoryIndex ? "w-1/3 animate-ping" : "w-0"
                        )}
                        style={{
                          transitionDuration: idx === activeStoryIndex ? '6000ms' : '0ms'
                        }}
                      />
                    </div>
                  ))}
                </div>

                {/* User details and Close Button */}
                <div className="absolute top-8 left-4 right-4 z-10 flex items-center justify-between pointer-events-auto">
                  <div className="flex items-center gap-2.5 text-left">
                    <img 
                      src={activeStatusUserGroup.userAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${activeStatusUserGroup.userId}`} 
                      className="w-9 h-9 rounded-full object-cover border border-white/25 bg-slate-800" 
                      alt="" 
                    />
                    <div>
                      <h4 className="text-xs font-black text-white leading-tight">{activeStatusUserGroup.userName}</h4>
                      <p className="text-[9px] text-white/60">
                        {currentStory.createdAt ? formatDistanceToNow(currentStory.createdAt.toDate()) + ' ago' : 'Recently'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 pointer-events-auto">
                    {/* Delete Option if mine */}
                    {isMyOwnStoryStatus && (
                      <button 
                        onClick={() => handleDeleteStatus(currentStory.id)}
                        className="px-2.5 py-1 text-[9px] bg-red-600 hover:bg-red-700 text-white rounded-lg font-black uppercase transition-all"
                        title="Delete this status"
                      >
                        Delete
                      </button>
                    )}
                    <button 
                      onClick={() => setActiveStatusUserGroup(null)}
                      className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>

                {/* Main Interactive Story Canvas Background */}
                <div className="flex-1 flex items-center justify-center relative p-6 bg-slate-950/60 min-h-0">
                  {currentStory.mediaUrl ? (
                    <img 
                      src={currentStory.mediaUrl} 
                      className="w-full h-full object-contain" 
                      alt="Story Snap" 
                    />
                  ) : (
                    <div className="px-6 text-center text-slate-100 max-w-sm">
                      <p className="text-xl sm:text-2xl font-bold font-sans tracking-wide leading-relaxed drop-shadow-md">
                        "{currentStory.content}"
                      </p>
                    </div>
                  )}
                </div>

                {/* Custom Caption Banner Overlay if image has caption */}
                {currentStory.mediaUrl && currentStory.content && (
                  <div className="absolute bottom-8 left-4 right-4 p-4 rounded-2xl bg-black/60 backdrop-blur-xs text-center border border-white/5 pointer-events-none">
                    <p className="text-xs text-slate-100 leading-relaxed font-semibold">
                      {currentStory.content}
                    </p>
                  </div>
                )}
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

// Sub-component for Real-Time nested post commenting
function PostCommentsSection({ postId, postRef, userProfile, usersMap, postOwnerId, postContent }: { postId: string, postRef: any, userProfile: any, usersMap: Record<string, { email: string; verified: boolean }>, postOwnerId?: string, postContent?: string }) {
  const [comments, setComments] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const commentsPath = `posts/${postId}/comments`;
    const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, commentsPath);
    });
    return unsubscribe;
  }, [postId]);

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !auth.currentUser) return;

    try {
      const display = userProfile?.displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0];
      const avatar = userProfile?.avatarUrl || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`;
      
      const newCommentText = inputText;
      setInputText('');

      await addDoc(collection(db, 'posts', postId, 'comments'), {
        userId: auth.currentUser.uid,
        userName: display,
        userAvatar: avatar,
        content: newCommentText,
        createdAt: serverTimestamp()
      });

      // Increment comments count on parent post
      await updateDoc(postRef, {
        commentsCount: increment(1)
      });

      // Trigger real-time comment notification
      if (postOwnerId && postOwnerId !== auth.currentUser.uid) {
        addDoc(collection(db, 'feed_notifications'), {
          receiverId: postOwnerId,
          senderId: auth.currentUser.uid,
          senderName: display,
          senderAvatar: avatar,
          type: 'comment',
          postId: postId,
          postContent: postContent || '',
          commentText: newCommentText,
          createdAt: serverTimestamp(),
          seen: false
        }).catch(err => console.error("Failed to make comment notification:", err));
      }
    } catch (error) {
      console.error("Failed to add comment:", error);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-[10px] text-slate-400 font-mono">Loading campus replies...</p>
        ) : comments.length === 0 ? (
          <p className="text-[10px] text-slate-400 italic font-mono pl-1 py-1">No replies yet. Start the corridor chat!</p>
        ) : (
          comments.map((cm) => (
            <div key={cm.id} className="flex gap-2.5 items-start p-2 bg-slate-50/50 rounded-2xl border border-slate-100/60 transition-all hover:bg-slate-50">
              <img 
                src={cm.userAvatar} 
                className="w-7 h-7 rounded-lg object-cover border border-slate-200" 
                alt="" 
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] font-bold text-slate-800 leading-tight flex items-center gap-1.5">
                    {cm.userName}
                    <VerificationBadge 
                      email={usersMap[cm.userId]?.email || (cm.userId === auth.currentUser?.uid ? auth.currentUser?.email || undefined : undefined)} 
                      verified={usersMap[cm.userId]?.verified} 
                    />
                  </span>
                  <span className="text-[8px] text-slate-400 uppercase font-mono tracking-tighter">
                    {cm.createdAt ? formatDistanceToNow(cm.createdAt.toDate()) + ' ago' : 'just now'}
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed break-words pr-2">{cm.content}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input reply form */}
      <form onSubmit={handleSendComment} className="flex gap-2 mt-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Add campus reply..."
          className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 text-slate-800"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center transition-all"
        >
          <Send size={12} />
        </button>
      </form>
    </div>
  );
}
