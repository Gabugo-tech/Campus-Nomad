import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, PlaySquare, MessageCircle, ShoppingBag, User, ShieldCheck, LogOut, AlertCircle, Search, PhoneOff, PhoneCall, X } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, onSnapshot, where, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { User as FirebaseUser } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { VerificationBadge } from './VerificationBadge';
import { io } from 'socket.io-client';

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

  // Dynamic Real-Time Online Status Tracking
  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, 'users', user.uid);
    let lastWriteTime = 0;

    const setOnlineStatus = async (isOnline: boolean) => {
      try {
        await updateDoc(userRef, {
          online: isOnline,
          lastActive: serverTimestamp()
        });
        lastWriteTime = Date.now();
      } catch (err) {
        console.error("Failed to update user status to", isOnline, err);
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
      updateDoc(userRef, { online: false });
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
      updateDoc(userRef, { online: false }).catch(err => console.error(err));
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
      handleFirestoreError(error, OperationType.LIST, path);
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
      handleFirestoreError(error, OperationType.LIST, path);
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
      transports: ['websocket', 'polling']
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
        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
          Student-Nomad
        </h1>
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
              <item.icon size={22} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
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
                "p-2 rounded-xl transition-all",
                isActive ? "text-blue-600 bg-blue-50/50" : "text-slate-500"
              )
            }
          >
            <item.icon size={24} />
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
                        await updateDoc(doc(db, 'users', user.uid), { online: false });
                      } catch (err) {
                        console.error("Failed to mark offline on sign out:", err);
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
                    const socket = io(socketUrl, { transports: ['websocket', 'polling'] });
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
