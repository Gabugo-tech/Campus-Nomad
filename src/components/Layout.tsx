import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, PlaySquare, MessageCircle, ShoppingBag, User, ShieldCheck, LogOut, AlertCircle, Search, PhoneOff, PhoneCall, X, Wifi, WifiOff, Zap } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType, onSnapshot } from '../lib/firebase';
import { collection, query, where, doc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { User as FirebaseUser } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { VerificationBadge } from './VerificationBadge';
import { io } from 'socket.io-client';
import { playNotificationSound } from '../lib/notificationSound';

interface LayoutProps {
  user: FirebaseUser | null;
  isVerified: boolean;
}

export default function Layout({ user, isVerified }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [missedCalls, setMissedCalls] = useState<any[]>([]);
  const [globalNotifications, setGlobalNotifications] = useState<any[]>([]);
  const [feedBadgeCount, setFeedBadgeCount] = useState(0);
  const [chatBadgeCount, setChatBadgeCount] = useState(0);

  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isLiteMode, setIsLiteMode] = useState(localStorage.getItem('campus_connect_lite_mode') === 'true');
  const [showQuotaExceeded, setShowQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleQuotaExceeded = () => {
      setShowQuotaExceeded(true);
    };
    window.addEventListener('firestore-quota-exceeded', handleQuotaExceeded);
    return () => {
      window.removeEventListener('firestore-quota-exceeded', handleQuotaExceeded);
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const toggleLiteMode = () => {
    const newVal = !isLiteMode;
    setIsLiteMode(newVal);
    localStorage.setItem('campus_connect_lite_mode', newVal ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('campus-connect-lite-mode-change', { detail: newVal }));
  };

  // Dynamic Real-Time Online Status Tracking
  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, 'users', user.uid);
    let lastWriteTime = 0;

    const setOnlineStatus = async (isOnline: boolean) => {
      try {
        if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
        await setDoc(userRef, {
          online: isOnline,
          lastActive: serverTimestamp()
        }, { merge: true });
        lastWriteTime = Date.now();
      } catch (err) {
        console.error("Failed to update user status to", isOnline, err);
        try {
          handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
        } catch (_) {}
      }
    };

    // Mark online immediately on mount
    setOnlineStatus(true);

    // Keep active on interaction, throttled so we don't spam Firestore
    const handleInteraction = () => {
      const now = Date.now();
      if (now - lastWriteTime > 45000) { // 45 seconds throttling
        setOnlineStatus(true);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setOnlineStatus(true);
      } else {
        setOnlineStatus(false);
      }
    };

    window.addEventListener('mousedown', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);
    window.addEventListener('focus', handleInteraction);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Before unload hook to gracefully set offline
    const handleBeforeUnload = () => {
      if (auth.currentUser && auth.currentUser.uid === user.uid) {
        setDoc(userRef, { online: false }, { merge: true }).catch(err => {
          try {
            handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
          } catch (_) {}
        });
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('mousedown', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
      window.removeEventListener('focus', handleInteraction);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      // Mark offline on unmount
      if (auth.currentUser && auth.currentUser.uid === user.uid) {
        setDoc(userRef, { online: false }, { merge: true }).catch(err => {
          console.error(err);
          try {
            handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
          } catch (_) {}
        });
      }
    };
  }, [user]);

  // Listen for unacknowledged missed calls targeting current user
  useEffect(() => {
    if (!user) return;
    const path = 'missed_calls';
    const q = query(
      collection(db, path),
      where('receiverId', '==', user.uid),
      where('status', '==', 'missed'),
      where('acknowledged', '==', false)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMissedCalls(list);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (_) {}
    });
    return unsubscribe;
  }, [user]);

  // Sync unread notifications (likes, replies, comments, chat messages) in real-time
  useEffect(() => {
    if (!user) return;
    const mountTime = Date.now();

    const qNotifications = query(
      collection(db, 'feed_notifications'),
      where('receiverId', '==', user.uid),
      where('seen', '==', false)
    );

    const unsubscribe = onSnapshot(qNotifications, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Calculate active badges
      const feedCount = list.filter((n: any) => n.type === 'like' || n.type === 'comment' || n.type === 'reply').length;
      const chatCount = list.filter((n: any) => n.type === 'message').length;
      
      setFeedBadgeCount(feedCount);
      setChatBadgeCount(chatCount);

      // Distribute new toasts in real-time
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const docData = change.doc.data();
          const docId = change.doc.id;

          // Prevent old notifications from showing up on hard refresh
          const docTime = docData.createdAt?.toDate ? docData.createdAt.toDate().getTime() : Date.now();
          if (docTime >= mountTime - 15000 && docData.senderId !== user.uid) {
            let titleText = 'Campus Activity';
            let detailText = '';
            
            if (docData.type === 'like') {
              titleText = '❤️ New Story Like';
              detailText = `${docData.senderName} liked your post/reel`;
            } else if (docData.type === 'comment') {
              titleText = '💬 New Comment';
              const text = docData.commentText || docData.postContent || '';
              detailText = `${docData.senderName}: "${text.length > 35 ? text.substring(0, 35) + '...' : text}"`;
            } else if (docData.type === 'message') {
              if (window.location.pathname === '/chat') {
                return; // suppress toast when actively talking inside Chat
              }
              titleText = '💬 New Chat Message';
              const text = docData.postContent || '';
              detailText = `${docData.senderName}: "${text.length > 35 ? text.substring(0, 35) + '...' : text}"`;
            }

            // Play the high-fidelity synthesized notification chime!
            playNotificationSound();

            const newToast = {
              id: docId,
              title: titleText,
              description: detailText,
              senderName: docData.senderName,
              senderAvatar: docData.senderAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${docData.senderName}`,
              type: docData.type,
              postId: docData.postId || null,
              createdAt: docTime
            };

            setGlobalNotifications(prev => {
              if (prev.some(t => t.id === docId)) return prev;
              return [newToast, ...prev];
            });

            // Auto-dismiss the toast after 6 seconds
            setTimeout(() => {
              setGlobalNotifications(prev => prev.filter(t => t.id !== docId));
            }, 6000);
          }
        }
      });
    }, (error) => {
      console.error("Failed to subscribe to global notifications in Layout:", error);
      try {
        handleFirestoreError(error, OperationType.LIST, 'feed_notifications');
      } catch (_) {}
    });

    return unsubscribe;
  }, [user]);

  const acknowledgeCall = async (callId: string) => {
    try {
      await updateDoc(doc(db, 'missed_calls', callId), { acknowledged: true });
    } catch (err) {
      console.error("Failed to acknowledge missed call:", err);
    }
  };

  // Load all users in real-time for global search
  useEffect(() => {
    if (!user) return;
    const path = 'users';
    const q = query(collection(db, path));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
      setAllUsers(list);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (_) {}
    });
    return unsubscribe;
  }, [user]);

  const [backgroundIncomingCall, setBackgroundIncomingCall] = useState<any | null>(null);

  // WebRTC Background incoming call tracker with Native Browser notification backup
  useEffect(() => {
    if (!user) return;

    // Check fallback browser status permissions
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const socketUrl = window.location.origin;
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      auth: {
        token: (window as any).csrfToken || ''
      }
    });

    socket.on('connect_error', (error) => {
      console.warn("Socket.io background connection error (silenced):", error.message);
    });

    socket.emit('join-user-room', user.uid);

    socket.on('incoming-call', (data) => {
      // Ensure we only show background alert modal if user is strictly away from the active `/chat` view!
      if (window.location.pathname !== '/chat') {
        setBackgroundIncomingCall(data);

        // Native notification fallback
        if ('Notification' in window && Notification.permission === 'granted') {
          const fallbackNotification = new Notification(`📞 Incoming Campus Call`, {
            body: `${data.callerName} is calling you via ${data.callType === 'video' ? 'Video' : 'Voice'} call!`,
            icon: data.callerAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${data.callerId}`,
            requireInteraction: true
          });

          fallbackNotification.onclick = () => {
            window.focus();
            navigate(`/chat?autoAccept=true&callType=${data.callType}&callerId=${data.callerId}&callerName=${encodeURIComponent(data.callerName)}&callerAvatar=${encodeURIComponent(data.callerAvatar)}`);
            setBackgroundIncomingCall(null);
            fallbackNotification.close();
          };
        }
      }
    });

    socket.on('call-ended', () => {
      setBackgroundIncomingCall(null);
    });

    socket.on('call-rejected', () => {
      setBackgroundIncomingCall(null);
    });

    return () => {
      socket.disconnect();
    };
  }, [user, location.pathname, navigate]);

  const filteredUsers = searchQuery.trim() === '' 
    ? [] 
    : allUsers.filter(u => {
        const name = (u.displayName || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const term = searchQuery.toLowerCase();
        return u.uid !== user?.uid && (name.includes(term) || email.includes(term));
      });

  const navItems = [
    { path: '/feed', icon: Home, label: 'Feed' },
    { path: '/reels', icon: PlaySquare, label: 'Reels' },
    { path: '/chat', icon: MessageCircle, label: 'Chat' },
    { path: '/marketplace', icon: ShoppingBag, label: 'Market' },
    { path: '/profile', icon: User, label: 'Profile' },
  ];

  if (user?.email === 'nnanwubagabriel@gmail.com') {
    navItems.push({ path: '/admin', icon: ShieldCheck, label: 'Admin' });
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Mobile Top Bar */}
      <div className="md:hidden sticky top-0 z-50 bg-white border-b border-slate-200 px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Student-Nomad
          </h1>
          <button 
            onClick={toggleLiteMode} 
            className={`p-1.5 rounded-xl transition-all ${isLiteMode ? "bg-amber-50 text-amber-700 border border-amber-200/40" : "text-slate-400 hover:text-slate-600"}`}
            title="Toggle Low Bandwidth Mode"
          >
            <Zap size={14} className={isLiteMode ? "fill-amber-600 text-amber-600" : ""} />
          </button>
          {!isOnline && (
            <span className="p-1 px-1.5 bg-rose-50 border border-rose-100 rounded-lg text-[9px] font-black text-rose-600 flex items-center gap-1 animate-pulse">
              <WifiOff size={10} />
              Offline
            </span>
          )}
        </div>
        {user && !isVerified && location.pathname !== '/verify' && (
          <NavLink to="/verify" className="flex items-center gap-1 text-xs font-medium text-orange-600 bg-orange-50 px-2 py-1 rounded-full animate-pulse border border-orange-200">
            Verify Now
          </NavLink>
        )}
      </div>

      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200 h-screen sticky top-0 shadow-sm shrink-0">
        <div className="p-6">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Student-Nomad
          </h1>
        </div>

        {/* Real-time Global Student Search */}
        {user && (
          <div className="px-4 mb-4 relative z-50">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search students..."
                value={searchQuery}
                onFocus={() => setShowSearchResults(true)}
                onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-14 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all font-medium"
              />
              {searchQuery.trim() !== '' && (
                <span className="absolute right-2 top-1.5 text-[9px] font-black text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-lg">
                  {filteredUsers.length} found
                </span>
              )}
            </div>

            {/* Live Dropdown Results */}
            <AnimatePresence>
              {showSearchResults && filteredUsers.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="absolute left-4 right-4 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-60 overflow-y-auto z-50 p-1 divide-y divide-slate-50"
                >
                  {filteredUsers.map((u) => (
                    <div
                      key={u.uid}
                      onMouseDown={() => {
                        navigate(`/profile/${u.uid}`);
                        setSearchQuery('');
                      }}
                      className="p-2 hover:bg-slate-50 rounded-xl transition-all cursor-pointer flex items-center gap-2"
                    >
                      <img
                        src={u.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${u.email}`}
                        className="w-8 h-8 rounded-full object-cover border border-slate-100"
                        alt=""
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-900 truncate flex items-center gap-1">
                          {u.displayName}
                          <VerificationBadge email={u.email} verified={u.verified} />
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">@{u.email?.split('@')[0]}</p>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <nav className="flex-1 px-4 space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
                  isActive
                    ? "bg-blue-50 text-blue-600 font-semibold"
                    : "text-slate-600 hover:bg-slate-50"
                )
              }
            >
              <div className="relative">
                <item.icon size={22} />
                {item.path === '/feed' && feedBadgeCount > 0 && (
                  <span className="absolute -top-2.5 -right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white ring-2 ring-white animate-pulse">
                    {feedBadgeCount}
                  </span>
                )}
                {item.path === '/chat' && chatBadgeCount > 0 && (
                  <span className="absolute -top-2.5 -right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[9px] font-black text-white ring-2 ring-white animate-pulse">
                    {chatBadgeCount}
                  </span>
                )}
              </div>
              <span className="flex-1 text-left">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        
        <div className="px-4 py-2 border-t border-slate-100 flex flex-col gap-2">
          {/* Network Connection Status */}
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 px-2 py-1 bg-slate-50 rounded-lg">
            <span className="flex items-center gap-1.5">
              {isOnline ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Online
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Offline Mode
                </>
              )}
            </span>
            <span className="font-mono text-[9px] uppercase font-bold text-slate-400">
              {isOnline ? "Sync Ready" : "Cached DB"}
            </span>
          </div>

          {/* Lite Mode Toggle */}
          <button
            onClick={toggleLiteMode}
            className={`flex items-center justify-between w-full p-2 rounded-xl transition-all font-sans text-xs ${
              isLiteMode 
                ? "bg-amber-50 text-amber-700 border border-amber-200/50" 
                : "text-slate-600 hover:bg-slate-50 border border-transparent"
            }`}
          >
            <span className="flex items-center gap-2 font-bold select-none text-[10px] uppercase tracking-wider">
              <Zap size={14} className={isLiteMode ? "text-amber-500 fill-amber-500" : ""} />
              {isLiteMode ? "Saver Mode Active" : "Low Bandwidth"}
            </span>
            <div className={`relative w-7 h-4 rounded-full transition-colors ${isLiteMode ? 'bg-amber-500' : 'bg-slate-200 border border-slate-300'}`}>
              <div className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all shadow-sm ${isLiteMode ? 'translate-x-3' : 'translate-x-0'}`} />
            </div>
          </button>
        </div>

        <div className="p-4 border-t border-slate-100">
          <button
            onClick={() => setShowSignOutModal(true)}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-slate-600 hover:bg-red-50 hover:text-red-600 transition-all"
          >
            <LogOut size={22} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 pb-20 md:pb-0 relative">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="max-w-4xl mx-auto p-4 md:p-8"
        >
          <Outlet />
        </motion.div>
      </main>

      {/* Bottom Nav (Mobile) */}
      <nav className="md:hidden fixed bottom-6 left-4 right-4 z-50 bg-white/80 backdrop-blur-md border border-slate-200/50 rounded-2xl shadow-xl flex items-center justify-around h-16 safe-area-bottom">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                "p-2 rounded-xl transition-all relative",
                isActive ? "text-blue-600 bg-blue-50/50" : "text-slate-500"
              )
            }
          >
            <div className="relative">
              <item.icon size={24} />
              {item.path === '/feed' && feedBadgeCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white ring-2 ring-white animate-pulse">
                  {feedBadgeCount}
                </span>
              )}
              {item.path === '/chat' && chatBadgeCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-blue-600 text-[9px] font-black text-white ring-2 ring-white animate-pulse">
                  {chatBadgeCount}
                </span>
              )}
            </div>
          </NavLink>
        ))}
      </nav>

      {/* Sign Out Confirmation Dialog */}
      <AnimatePresence>
        {showSignOutModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSignOutModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
            />
            
            {/* Modal Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="bg-white max-w-sm w-full rounded-[2rem] border border-slate-200 p-6 shadow-2xl relative z-10 text-center"
            >
              <div className="mx-auto w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
                <AlertCircle size={24} />
              </div>
              
              <h3 className="text-xl font-bold text-slate-900 mb-2">Sign Out</h3>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                Are you sure you want to sign out of Campus-Nomad? You will need to sign back in with your credentials to access the campus.
              </p>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSignOutModal(false)}
                  className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setShowSignOutModal(false);
                    if (user) {
                      try {
                        await setDoc(doc(db, 'users', user.uid), { online: false }, { merge: true });
                      } catch (err) {
                        console.error("Failed to mark offline on sign out:", err);
                        try {
                          handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
                        } catch (rethrown) {
                          // Prevent crashing the sign-out UI
                        }
                      }
                    }
                    auth.signOut();
                  }}
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-all active:scale-95 shadow-lg shadow-red-100"
                >
                  Yes, Sign Out
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Firestore Quota Exceeded Informational Dialog */}
      <AnimatePresence>
        {showQuotaExceeded && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowQuotaExceeded(false)}
              className="absolute inset-0 bg-slate-900/75 backdrop-blur-sm"
            />
            
            {/* Modal Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="bg-white max-w-md w-full rounded-[2.2rem] border border-amber-200 p-6 md:p-8 shadow-2xl relative z-10 text-center"
            >
              <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-5 border border-amber-200/50">
                <Zap size={28} className="fill-amber-500 text-amber-500 animate-pulse" />
              </div>
              
              <h3 className="text-2xl font-black text-slate-900 mb-2 tracking-tight">Firestore Quota Reached</h3>
              <p className="text-xs font-mono font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full inline-block mb-4">
                Spark Free Plan Limit
              </p>
              
              <div className="text-slate-600 text-sm mb-6 space-y-3 text-left bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <p className="leading-relaxed">
                  The daily read/write quota for the application's Firebase database has been exceeded. Programmatic database synchronization is temporarily paused.
                </p>
                <p className="leading-relaxed text-xs">
                  • <strong>Daily Reset:</strong> Quotas reset daily at midnight Pacific Time.
                </p>
                <p className="leading-relaxed text-xs">
                  • <strong>Details:</strong> Detailed quota information can be found under the <strong>Spark Plan</strong> column in the <strong>Enterprise Edition</strong> section of the <a href="https://firebase.google.com/pricing#cloud-firestore" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-semibold">Firestore Pricing Page</a>.
                </p>
              </div>
              
              <div className="flex flex-col gap-3">
                <a
                  href="https://console.firebase.google.com/project/gen-lang-client-0036951224/firestore/databases/ai-studio-a816fe72-4c23-410e-a34a-ce4eb1f0f56d/data?openUpgradeDialog=true"
                  target="_blank"
                  rel="noreferrer"
                  className="w-full py-3 px-4 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-700 transition-all active:scale-95 shadow-lg shadow-amber-100 text-center inline-block cursor-pointer font-sans"
                >
                  🚀 Upgrade Database / Manage Project
                </a>
                
                <button
                  onClick={() => setShowQuotaExceeded(false)}
                  className="w-full py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all active:scale-95"
                >
                  Continue in Cached Offline Mode
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Real-Time Global Toast Notifications */}
      <div className="fixed top-4 right-4 z-[9999] p-4 flex flex-col gap-3 min-w-[320px] max-w-sm w-full pointer-events-none">
        <AnimatePresence>
          {globalNotifications.map((notif) => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, scale: 0.9, x: 50 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: 50, transition: { duration: 0.2 } }}
              onClick={async () => {
                // Mark as read in Firestore
                try {
                  await updateDoc(doc(db, 'feed_notifications', notif.id), { seen: true });
                } catch (err) {
                  console.error("Failed to mark notification as seen:", err);
                }
                
                // Route navigation
                if (notif.type === 'message') {
                  navigate('/chat');
                } else if (notif.type === 'like' || notif.type === 'comment') {
                  navigate('/feed');
                }
                
                // Clear state toast
                setGlobalNotifications(prev => prev.filter(t => t.id !== notif.id));
              }}
              className="pointer-events-auto cursor-pointer bg-white border border-slate-200/90 rounded-[1.5rem] p-4 shadow-2xl flex items-start gap-3 relative overflow-hidden group hover:shadow-3xl hover:border-slate-300 transition-all active:scale-98"
            >
              {/* Sliding brand bar indicator */}
              <div className={cn(
                "absolute top-0 bottom-0 left-0 w-2",
                notif.type === 'message' ? "bg-blue-600" : "bg-red-500"
              )} />
              
              <img
                src={notif.senderAvatar}
                className="w-9 h-9 rounded-full object-cover shrink-0 border border-slate-100"
                alt=""
                referrerPolicy="no-referrer"
              />
              
              <div className="flex-1 min-w-0 text-left">
                <span className={cn(
                  "text-[9px] font-mono font-black uppercase tracking-widest block mb-0.5",
                  notif.type === 'message' ? "text-blue-500" : "text-red-500"
                )}>
                  {notif.type === 'message' ? '⚡ New Inbox Msg' : '✨ New Interaction'}
                </span>
                <h4 className="font-bold text-xs text-slate-800 truncate">
                  {notif.title}
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-normal font-medium">
                  {notif.description}
                </p>
              </div>

              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await updateDoc(doc(db, 'feed_notifications', notif.id), { seen: true });
                  } catch (err) {
                    console.error("Failed to dismiss notifications:", err);
                  }
                  setGlobalNotifications(prev => prev.filter(t => t.id !== notif.id));
                }}
                className="p-1 hover:bg-slate-50 rounded-lg text-slate-300 hover:text-slate-500 shrink-0 self-center"
              >
                <X size={15} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Toast Notification Container for Missed Calls */}
      <div className="fixed bottom-4 right-4 z-[9999] p-4 flex flex-col gap-3 min-w-[325px] max-w-sm pointer-events-none">
        <AnimatePresence>
          {missedCalls.map((call) => (
            <motion.div
              key={call.id}
              initial={{ opacity: 0, scale: 0.8, y: 50 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -20 }}
              className="pointer-events-auto bg-slate-900 border border-slate-800 text-white rounded-[1.5rem] p-4 shadow-2xl flex items-start gap-3 relative overflow-hidden"
            >
              {/* Crimson indicator strip */}
              <div className="absolute top-0 bottom-0 left-0 w-2.5 bg-rose-600 animate-pulse" />
              
              <div className="flex-1 pl-1.5 min-w-0 text-left">
                <span className="text-[9px] font-mono font-black text-rose-500 uppercase tracking-widest block mb-1">
                  Missed {call.callType} Call
                </span>
                <h4 className="font-bold text-sm text-slate-100 truncate">
                  {call.callerName}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                  Left a missed connection while you had stepped away.
                </p>
                <div className="flex items-center gap-2 mt-3 pt-0.5">
                  <button
                    onClick={async () => {
                      await acknowledgeCall(call.id);
                      navigate('/chat');
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-black tracking-wider uppercase transition-all"
                  >
                    Callback
                  </button>
                  <button
                    onClick={() => acknowledgeCall(call.id)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg text-[10px] font-black tracking-wider uppercase transition-all"
                  >
                    Dismiss
                  </button>
                </div>
              </div>

              <div className="w-8 h-8 rounded-full bg-rose-950/35 border border-rose-900/40 flex items-center justify-center text-rose-400 shrink-0">
                <PhoneOff size={15} className="animate-bounce" />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 📞 Persistent Background Incoming Call Visual Overlay */}
      <AnimatePresence>
        {backgroundIncomingCall && (
          <div className="fixed top-20 right-4 z-[9999] p-4 max-w-sm w-full pointer-events-auto">
            <motion.div
              initial={{ opacity: 0, y: -50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -50, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 text-white rounded-[2rem] p-5 shadow-2xl relative overflow-hidden font-sans border-l-4 border-l-emerald-500"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl animate-pulse" />

              <div className="flex items-start gap-4 relative z-10">
                <div className="relative shrink-0">
                  <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping" />
                  <img
                    src={backgroundIncomingCall.callerAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${backgroundIncomingCall.callerId}`}
                    className="w-12 h-12 rounded-full object-cover border-2 border-slate-755 relative z-10"
                    alt=""
                  />
                </div>
                
                <div className="flex-1 min-w-0 text-left">
                  <span className="text-[9px] font-mono font-black text-emerald-400 uppercase tracking-widest block mb-1">
                    Incoming {backgroundIncomingCall.callType} Call...
                  </span>
                  <h4 className="font-extrabold text-sm text-white truncate">
                    {backgroundIncomingCall.callerName}
                  </h4>
                  <p className="text-[11px] font-medium text-slate-400 mt-0.5 leading-normal">
                    Pinging you live on Campus Corridor
                  </p>
                </div>
              </div>

              <div className="flex gap-2.5 mt-4 relative z-10 pt-1">
                <button
                  onClick={() => {
                    const socketUrl = window.location.origin;
                    const socket = io(socketUrl, {
                      transports: ['websocket', 'polling'],
                      auth: {
                        token: (window as any).csrfToken || ''
                      }
                    });
                    socket.emit('reject-call', {
                      callerId: backgroundIncomingCall.callerId,
                      receiverId: user?.uid
                    });
                    setTimeout(() => socket.disconnect(), 100);
                    setBackgroundIncomingCall(null);
                  }}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-705 text-slate-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                >
                  Decline
                </button>
                <button
                  onClick={() => {
                    navigate(`/chat?autoAccept=true&callType=${backgroundIncomingCall.callType}&callerId=${backgroundIncomingCall.callerId}&callerName=${encodeURIComponent(backgroundIncomingCall.callerName)}&callerAvatar=${encodeURIComponent(backgroundIncomingCall.callerAvatar)}`);
                    setBackgroundIncomingCall(null);
                  }}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <PhoneCall size={12} className="animate-pulse" /> Answer
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
