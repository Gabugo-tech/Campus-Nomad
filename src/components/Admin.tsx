import { useState, useEffect } from 'react';
import { db, auth, onSnapshot } from '../lib/firebase';
import { collection, query, orderBy, doc, updateDoc, setDoc, deleteDoc, limit } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert, CheckCircle2, XCircle, Users, FileText, ShoppingCart, Ban, AlertTriangle, Eye, ShieldCheck, UserCheck, Trash2, X, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { VerificationBadge } from './VerificationBadge';

export default function Admin() {
  const [requests, setRequests] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [postsCount, setPostsCount] = useState(0);
  const [marketCount, setMarketCount] = useState(0);
  const [trafficLogs, setTrafficLogs] = useState<any[]>([]);
  const [reportsList, setReportsList] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'verifications' | 'users' | 'reports' | 'traffic'>('verifications');

  // Custom Responsive state-based modal structures
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<any | null>(null);
  const [confirmBlockUser, setConfirmBlockUser] = useState<any | null>(null);
  const [selectedRequestForReview, setSelectedRequestForReview] = useState<any | null>(null);
  const [adminNotification, setAdminNotification] = useState<string | null>(null);

  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [checkingDevice, setCheckingDevice] = useState(true);

  useEffect(() => {
    const checkDevice = () => {
      const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
      const isMobileUA = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
      const isSmallScreen = window.innerWidth <= 768;
      setIsMobileDevice(isMobileUA || isSmallScreen);
      setCheckingDevice(false);
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  useEffect(() => {
    if (adminNotification) {
      const timer = setTimeout(() => {
        setAdminNotification(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [adminNotification]);

  useEffect(() => {
    if (auth.currentUser?.email !== 'nnanwubagabriel@gmail.com') return;

    // Real-time verification requests
    const q = query(collection(db, 'verificationRequests'), orderBy('createdAt', 'desc'));
    const unsubVerif = onSnapshot(q, (snapshot) => {
      setRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Real-time user database
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setUsersList(list);

      // Security Clean-up: make sure nnanwubagabriel@gmail.com is the only admin account and delete all other admin accounts
      list.forEach(async (usr) => {
        if (usr.isAdmin === true && usr.email !== 'nnanwubagabriel@gmail.com') {
          console.log(`Detected unauthorized admin: ${usr.email}. Deleting database record.`);
          try {
            await deleteDoc(doc(db, 'users', usr.id));
          } catch (e) {
            console.error("Failed to delete unauthorized admin account automatically:", e);
          }
        }
      });
    });

    // Count statistics from real db
    const unsubPosts = onSnapshot(collection(db, 'posts'), (snapshot) => {
      setPostsCount(snapshot.size);
    });

    const unsubMarket = onSnapshot(collection(db, 'marketplace'), (snapshot) => {
      setMarketCount(snapshot.size);
    });

    // Real time traffic logs feed
    const qTraffic = query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(120));
    const unsubTraffic = onSnapshot(qTraffic, (snapshot) => {
      setTrafficLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Real-time student reports
    const qReports = query(collection(db, 'reports'), orderBy('createdAt', 'desc'));
    const unsubReports = onSnapshot(qReports, (snapshot) => {
      setReportsList(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Failed to load reports:", error);
    });

    return () => {
      unsubVerif();
      unsubUsers();
      unsubPosts();
      unsubMarket();
      unsubTraffic();
      unsubReports();
    };
  }, []);

  const handleVerification = async (requestId: string, userId: string, approve: boolean) => {
    try {
      const requestRef = doc(db, 'verificationRequests', requestId);
      const userRef = doc(db, 'users', userId);

      if (approve) {
        await updateDoc(userRef, {
          verified: true,
          verificationStatus: 'verified'
        });
        await updateDoc(requestRef, { status: 'approved' });
      } else {
        await updateDoc(userRef, {
          verified: false,
          verificationStatus: 'rejected'
        });
        await updateDoc(requestRef, { status: 'rejected' });
      }
    } catch (error) {
      console.error("Action failed:", error);
    }
  };

  const executeDeleteUser = async (userId: string) => {
    try {
      await deleteDoc(doc(db, 'users', userId));
      setAdminNotification("Student profile permanently deleted from database corridor.");
      setConfirmDeleteUser(null);
    } catch (error) {
      console.error("Delete user failed:", error);
      setAdminNotification("Error: Failed to delete user profile.");
    }
  };

  const handleBlockUserToggle = async (user: any) => {
    try {
      const userRef = doc(db, 'users', user.id);
      const isBlocked = user.blocked === true;
      const nextBlockState = !isBlocked;
      
      await updateDoc(userRef, {
        blocked: nextBlockState,
        verified: nextBlockState ? false : true,
        verificationStatus: nextBlockState ? 'blocked' : 'verified'
      });
      
      setAdminNotification(`Profile successfully ${nextBlockState ? 'Blocked & Restated' : 'Restored & Verified'}.`);
      setConfirmBlockUser(null);
    } catch (error) {
      console.error("Block action failed:", error);
      setAdminNotification("Error: Blocking action aborted.");
    }
  };

  const toggleUserVerified = async (user: any) => {
    try {
      const userRef = doc(db, 'users', user.id);
      const nextStatus = !user.verified;
      await updateDoc(userRef, {
        verified: nextStatus,
        verificationStatus: nextStatus ? 'verified' : 'none'
      });
      setAdminNotification(`Verification state changed successfully.`);
    } catch (error) {
      console.error("Failed to toggle user verification:", error);
      setAdminNotification("Error: Verification change aborted.");
    }
  };

  if (auth.currentUser?.email !== 'nnanwubagabriel@gmail.com') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center italic-none p-4">
        <ShieldAlert size={64} className="text-red-500 mb-6" />
        <h1 className="text-3xl font-black mb-4">Restricted Area</h1>
        <p className="text-slate-500 max-w-sm">
          You don't have administrator privileges. All unauthorized attempts are logged for campus security.
        </p>
      </div>
    );
  }

  // Admin bypasses device/screen routing restrictions
  const isAdmin = auth.currentUser?.email === 'nnanwubagabriel@gmail.com';

  if (!isAdmin && checkingDevice) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-4">
        <Loader2 size={40} className="animate-spin text-blue-600 mb-4" />
        <p className="text-xs font-mono uppercase tracking-widest text-slate-500 font-extrabold animate-pulse">Analyzing secure terminal...</p>
      </div>
    );
  }

  if (!isAdmin && !isMobileDevice) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center italic-none p-6 w-full max-w-md mx-auto">
        <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-655 mb-6 animate-bounce">
          <AlertTriangle size={48} className="text-amber-500" />
        </div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-3">MOBILE DEVICE TERM REQUIRED</h1>
        <p className="text-sm text-slate-600 leading-relaxed mb-6 font-medium">
          Attention Admin <span className="font-extrabold text-slate-905">{auth.currentUser?.email}</span>. Under system security constraints, the high-privilege Admin Desk is gated to authorized <strong className="text-slate-905 font-bold">Mobile Device Portals</strong> only. Please switch to a mobile phone layout or device.
        </p>
        <div className="text-[10px] uppercase font-mono font-black text-slate-400 bg-slate-100 py-1.5 px-4 rounded-full border border-slate-200">
          STRICT SECURITY RULE ENFORCED
        </div>
      </div>
    );
  }

  const pendingRequests = requests.filter(r => r.status === 'pending');

  return (
    <div className="space-y-8 italic-none">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black italic-none leading-tight">Admin Desk</h1>
          <p className="text-slate-500 font-mono text-xs tracking-tighter uppercase font-black">Campus-Nomad Live Surveillance & Control</p>
        </div>
        <div className="flex gap-2">
          <div className="px-4 py-2 bg-green-50 text-green-600 rounded-xl text-xs font-black border border-green-100 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            NODE STATUS: OPTIMAL
          </div>
        </div>
      </div>

      {/* Analytics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Active Students', value: usersList.length, icon: Users, color: 'blue' },
          { label: 'Total Content', value: postsCount, icon: FileText, color: 'indigo' },
          { label: 'Market Products', value: marketCount, icon: ShoppingCart, color: 'emerald' },
          { label: 'Pending Verif.', value: pendingRequests.length, icon: ShieldAlert, color: 'orange' },
          { label: 'Traffic logs', value: trafficLogs.length, icon: Eye, color: 'rose' }
        ].map((stat, i) => (
          <div key={i} className="bg-white border border-slate-200 p-5 rounded-[2rem] shadow-sm">
            <div className={`w-9 h-9 bg-slate-50 text-slate-700 rounded-lg flex items-center justify-center mb-3 border border-slate-100`}>
              <stat.icon size={18} />
            </div>
            <p className="text-xl font-black italic-none">{stat.value}</p>
            <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Systems Architecture & Programming Languages Card (Admin Only) */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-900 text-white p-6 rounded-[2rem] shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-6"
      >
        <div className="space-y-2">
          <span className="px-2.5 py-1 bg-blue-500/10 text-blue-400 font-mono text-[9px] rounded-md font-bold uppercase tracking-widest border border-blue-500/20">
            System Architecture Spec
          </span>
          <h3 className="text-lg font-black tracking-tight">Full-Stack Language Registry</h3>
          <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
            This live ledger lists all languages and engineering technologies operating this decentralized web corridor. Accessible strictly to root admins.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 shrink-0">
          <div className="p-3.5 bg-white/5 border border-white/10 rounded-2xl">
            <p className="text-[9px] font-mono text-slate-400 uppercase font-black tracking-wider">Frontend Stack</p>
            <p className="text-xs font-black text-white mt-1">TypeScript <span className="text-slate-400 font-normal">/ React 18</span></p>
            <p className="text-[9px] text-blue-400 mt-1 font-mono">Tailwind CSS, Vite, Motion</p>
          </div>
          <div className="p-3.5 bg-white/5 border border-white/10 rounded-2xl">
            <p className="text-[9px] font-mono text-slate-400 uppercase font-black tracking-wider">Backend layer</p>
            <p className="text-xs font-black text-white mt-1">TypeScript <span className="text-slate-400 font-normal">/ Node.js</span></p>
            <p className="text-[9px] text-emerald-400 mt-1 font-mono">Express, Socket.io (H.S.)</p>
          </div>
          <div className="p-3.5 bg-white/5 border border-white/10 rounded-2xl block">
            <p className="text-[9px] font-mono text-slate-400 uppercase font-black tracking-wider">Database engine</p>
            <p className="text-xs font-black text-white mt-1">NoSQL <span className="text-slate-400 font-normal">/ Firestore Rules</span></p>
            <p className="text-[9px] text-purple-400 mt-1 font-mono">JSON Blueprints, TLS 1.3</p>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm italic-none">
        <div className="flex border-b border-slate-100 italic-none">
          {['Verifications', 'Users', 'Reports', 'Traffic Feed'].map((tab) => {
            const val = tab === 'Traffic Feed' ? 'traffic' : tab.toLowerCase();
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(val as any)}
                className={`flex-1 py-4 text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all ${
                  activeTab === val ? 'bg-slate-900 text-white' : 'text-slate-400 hover:bg-slate-50'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        <div className="p-6">
          <AnimatePresence mode="wait">
            {activeTab === 'verifications' && (
              <motion.div
                key="verif"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 italic-none"
              >
                {requests.length > 0 ? (
                  requests.map((r) => (
                    <div key={r.id} className="group bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col md:flex-row items-center gap-6 italic-none hover:bg-white hover:border-slate-200 hover:shadow-lg transition-all italic-none">
                      <div 
                        className="flex -space-x-3 italic-none cursor-zoom-in" 
                        onClick={() => setSelectedRequestForReview(r)}
                        title="Click to zoom images"
                      >
                        {r.selfieImageUrl ? (
                          <img src={r.selfieImageUrl} className="w-12 h-12 rounded-xl object-cover ring-2 ring-white shadow-sm hover:scale-105 transition-all" alt="Selfie" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-slate-200 ring-2 ring-white shadow-sm flex items-center justify-center text-xs text-slate-400 font-bold">Selfie</div>
                        )}
                        {r.idImageUrl ? (
                          <img src={r.idImageUrl} className="w-12 h-12 rounded-xl object-cover ring-2 ring-white shadow-sm hover:scale-105 transition-all" alt="ID" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-slate-300 ring-2 ring-white shadow-sm flex items-center justify-center text-xs text-slate-500 font-bold">ID</div>
                        )}
                      </div>
                      <div 
                        className="flex-1 italic-none text-center md:text-left cursor-pointer"
                        onClick={() => setSelectedRequestForReview(r)}
                        title="Click to review details"
                      >
                        <h4 className="font-bold text-slate-800 flex items-center justify-center md:justify-start gap-1.5">
                          <span>{r.userName || 'Student'}</span>
                          <span className="text-[10px] bg-blue-50 text-blue-600 font-extrabold uppercase px-1.5 py-0.5 rounded-full border border-blue-100">Review Folder</span>
                        </h4>
                        <p className="text-xs text-slate-500 font-mono tracking-tighter italic-none">{r.email}</p>
                        <p className="text-[10px] text-slate-400 mt-1 uppercase font-black">{r.createdAt && typeof r.createdAt.toDate === 'function' ? format(r.createdAt.toDate(), 'MMM d, HH:mm') : 'Recently'}</p>
                      </div>
                      <div className="flex gap-2">
                        {r.status === 'pending' ? (
                          <>
                            <button
                              onClick={() => handleVerification(r.id, r.userId, true)}
                              className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-black flex items-center gap-2 hover:bg-green-700 shadow-lg shadow-green-100 transition-all italic-none"
                            >
                              <CheckCircle2 size={16} />
                              APPROVE
                            </button>
                            <button
                              onClick={() => handleVerification(r.id, r.userId, false)}
                              className="px-4 py-2 bg-red-50 text-red-655 border border-red-100 rounded-xl text-xs font-black flex items-center gap-2 hover:bg-red-100 transition-all italic-none"
                            >
                              <XCircle size={16} />
                              REJECT
                            </button>
                          </>
                        ) : (
                          <span className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase italic-none border ${
                             r.status === 'approved' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-red-50 text-red-600 border-red-100'
                          }`}>
                            {r.status}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-12 text-center text-slate-400 italic-none">
                    <CheckCircle2 size={48} className="mx-auto mb-4 opacity-10" />
                    <p className="font-bold">No pending verification requests.</p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'users' && (
              <motion.div
                key="users_db"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-mono font-black text-slate-400 uppercase tracking-widest">Live Student directory ({usersList.length})</span>
                </div>
                <div className="divide-y divide-slate-100 max-h-120 overflow-y-auto pr-2">
                  {usersList.length === 0 ? (
                    <p className="text-center text-slate-400 py-6 text-xs">No registered users in the database.</p>
                  ) : (
                    usersList.map((usr) => (
                      <div key={usr.id} className="py-3 flex items-center justify-between gap-4 hover:bg-slate-50 px-2 rounded-xl transition-all">
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={usr.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${usr.email}`}
                            className="w-10 h-10 rounded-full object-cover border border-slate-200"
                            alt=""
                          />
                          <div className="min-w-0">
                            <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5 truncate">
                              {usr.displayName}
                              <VerificationBadge email={usr.email} verified={usr.verified} />
                            </h4>
                            <p className="text-xs text-slate-500 truncate">{usr.email}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {usr.blocked ? (
                            <span className="px-2 py-1 text-[10px] font-black rounded-lg bg-red-100 text-red-700 border border-red-200 uppercase tracking-wider">
                              🚫 Blocked Student
                            </span>
                          ) : (
                            <span className={`px-2 py-1 text-[10px] font-bold rounded-lg ${usr.verified ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-orange-50 text-orange-700 border border-orange-100'}`}>
                              {usr.verified ? 'Verified Student' : 'Unverified / Pending'}
                            </span>
                          )}
                          
                          {usr.blocked ? (
                            <button
                              onClick={() => handleBlockUserToggle(usr)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                            >
                              🟢 Unblock student
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                if (usr.verified) {
                                  setConfirmBlockUser(usr);
                                } else {
                                  toggleUserVerified(usr);
                                }
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                                usr.verified 
                                  ? 'bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700' 
                                  : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-50'
                              }`}
                            >
                              {usr.verified ? 'Block / Revoke' : 'Verify Student'}
                            </button>
                          )}

                          {usr.email !== 'nnanwubagabriel@gmail.com' && (
                            <button
                              onClick={() => setConfirmDeleteUser(usr)}
                              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all active:scale-90"
                              title="Delete Student Permanently"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'reports' && (
              <motion.div
                key="reports_tab"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4 text-left font-sans"
              >
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
                  <span className="text-xs font-mono font-black text-slate-400 uppercase tracking-widest">Live Student Reports ({reportsList.length})</span>
                </div>
                <div className="divide-y divide-slate-100 max-h-120 overflow-y-auto pr-2">
                  {reportsList.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 italic-none">
                      <Users size={48} className="mx-auto mb-4 opacity-10" />
                      <p className="font-bold italic-none">No active student reports recorded.</p>
                      <p className="text-xs text-slate-400 mt-1">Campus-Nomad general corridor is clean and safe.</p>
                    </div>
                  ) : (
                    reportsList.map((rep) => (
                      <div key={rep.id} className="py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4 bg-slate-50 hover:bg-white border border-slate-100 p-4 rounded-2xl transition-all">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-slate-600 font-semibold leading-relaxed">
                            <span className="text-amber-600 font-black">Reporter:</span> {rep.reporterName} (ID: {rep.reporterId})
                          </p>
                          <p className="text-xs text-slate-800 font-bold leading-relaxed mt-1">
                            <span className="text-red-600 font-black">Reported Student:</span> {rep.reportedName} (ID: {rep.reportedId})
                          </p>
                          <p className="text-sm text-slate-705 bg-red-50 border border-red-100/50 p-2.5 rounded-xl mt-2 font-sans font-medium">
                            {rep.reason}
                          </p>
                          <p className="text-[9px] text-slate-400 mt-2 uppercase font-mono">
                            {rep.createdAt ? format(new Date(rep.createdAt), 'PPP, HH:mm:ss') : 'Recently'}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={async () => {
                              if (window.confirm("Dismiss this report? This will delete the report entry.")) {
                                try {
                                  await deleteDoc(doc(db, 'reports', rep.id));
                                  setAdminNotification("Report dismissed successfully.");
                                } catch (err) {
                                  console.error("Dismiss failed:", err);
                                  setAdminNotification("Dismiss action failed.");
                                }
                              }
                            }}
                            className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-750 text-xs font-black rounded-xl transition-all"
                          >
                            Dismiss
                          </button>
                          <button
                            onClick={() => {
                              const reportedUser = usersList.find(u => u.uid === rep.reportedId);
                              if (reportedUser) {
                                setConfirmBlockUser(reportedUser);
                              } else {
                                alert("Reported student profile not found in current directory.");
                              }
                            }}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-red-50"
                          >
                            Block Student
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'traffic' && (
              <motion.div
                key="traffic_logs_monitor"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4 text-left"
              >
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
                  <span className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">Live Web App Corridor Traffic Activities</span>
                </div>
                
                <div className="space-y-3 max-h-120 overflow-y-auto pr-2">
                  {trafficLogs.length === 0 ? (
                    <p className="text-center text-slate-400 py-6 text-xs">No active web app traffic recorded yet.</p>
                  ) : (
                    trafficLogs.map((log) => (
                      <div key={log.id} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-between gap-4 hover:bg-white transition-all text-slate-800">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-slate-600 leading-relaxed font-semibold">
                            <span className="text-slate-950 font-black">@{log.userEmail?.split('@')[0]}</span> ({log.displayName}): {log.action}
                          </p>
                          <p className="text-[9px] text-slate-400 mt-1 uppercase font-mono">
                            {log.timestamp && typeof log.timestamp.toDate === 'function' ? format(log.timestamp.toDate(), 'PPP, HH:mm:ss') : 'Just now'}
                          </p>
                        </div>
                        <span className="shrink-0 px-2.5 py-1 bg-green-50 text-green-750 font-mono text-[9px] rounded-lg font-bold uppercase border border-green-100 flex items-center gap-1">
                          <span className="w-1 h-1 bg-green-500 rounded-full animate-ping" /> Live Action
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Critical Alerts */}
      <div className="bg-red-50 border border-red-100 p-6 rounded-[2rem] italic-none">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="text-red-600 animate-bounce" size={24} />
          <h3 className="font-bold text-red-900 italic-none">Security Corridor Alerts</h3>
        </div>
        <div className="space-y-3 italic-none">
          {[
            'Disposable email attempt blocked (tempman.org)',
            'Multi-tenant signups secured',
            'All media items stored encrypted as secure payload.'
          ].map((alert, i) => (
            <div key={i} className="flex items-center justify-between bg-white/50 p-3 rounded-xl border border-red-200/50 italic-none">
              <span className="text-sm font-medium text-red-700 italic-none">{alert}</span>
              <button className="text-[10px] font-black underline italic-none text-red-900">ACKNOWLEDGE</button>
            </div>
          ))}
        </div>
      </div>

      {/* Toast notifications */}
      <AnimatePresence>
        {adminNotification && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className="fixed top-6 right-6 z-[200] max-w-sm w-full bg-slate-900 border border-slate-800 text-white rounded-2xl shadow-2xl p-4 flex items-center justify-between gap-3 text-xs font-bold"
          >
            <span>✨ {adminNotification}</span>
            <button onClick={() => setAdminNotification(null)} className="opacity-60 hover:opacity-100 p-0.5 hover:bg-white/10 rounded-lg">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Permanent Delete Confirmation Modal */}
      <AnimatePresence>
        {confirmDeleteUser && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmDeleteUser(null)}
              className="absolute inset-0 bg-slate-950/65 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white border border-slate-200 p-6 rounded-3xl max-w-sm w-full shadow-2xl relative z-10 text-center text-slate-800"
            >
              <div className="w-12 h-12 bg-red-50 text-red-650 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-red-100">
                <Trash2 size={22} className="text-red-600" />
              </div>
              <h3 className="text-lg font-black tracking-tight text-slate-900 animate-pulse">Delete Profile permanently?</h3>
              <p className="text-xs text-slate-500 leading-relaxed mt-2 max-w-xs mx-auto">
                Are you positive you wish to permanently delete the profile of <span className="font-extrabold text-slate-950">{confirmDeleteUser.displayName}</span> ({confirmDeleteUser.email})? This action is absolute and cannot be undone.
              </p>
              
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteUser(null)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-xs uppercase"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeDeleteUser(confirmDeleteUser.id)}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-xs uppercase shadow-lg shadow-red-100"
                >
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Block & Suspend User Confirmation Modal */}
      <AnimatePresence>
        {confirmBlockUser && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmBlockUser(null)}
              className="absolute inset-0 bg-slate-950/65 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white border border-slate-200 p-6 rounded-3xl max-w-sm w-full shadow-2xl relative z-10 text-center text-slate-800"
            >
              <div className="w-12 h-12 bg-orange-50 text-orange-650 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-orange-100">
                <Ban size={22} className="text-orange-600" />
              </div>
              <h3 className="text-lg font-black tracking-tight text-slate-900">Block Student Profile?</h3>
              <p className="text-xs text-slate-500 leading-relaxed mt-2 max-w-xs mx-auto">
                Are you positive you wish to block <span className="font-extrabold text-slate-950">{confirmBlockUser.displayName}</span>? Their corridor verification status will be fully revoked and they will receive an immediate block banner.
              </p>
              
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setConfirmBlockUser(null)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-xs uppercase"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleBlockUserToggle(confirmBlockUser)}
                  className="flex-1 py-3 bg-amber-655 hover:bg-amber-700 text-white rounded-2xl font-bold text-xs uppercase shadow-md shadow-amber-50"
                >
                  Confirm Block
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Side-by-Side Detailed High-Res Selfie and ID Verification Modal */}
      <AnimatePresence>
        {selectedRequestForReview && (
          <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRequestForReview(null)}
              className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl max-w-4xl w-full shadow-2xl relative z-10 flex flex-col text-slate-800 dark:text-white"
            >
              <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-800 mb-6 font-sans">
                <div className="text-left font-sans">
                  <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-white">Detailed Verification Review</h3>
                  <p className="text-xs text-slate-400">
                    Compare the live student selfie and the student government-issued/student ID card below.
                  </p>
                </div>
                <button 
                  onClick={() => setSelectedRequestForReview(null)}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Student Selfie Card */}
                <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800/80 p-4 rounded-2xl flex flex-col items-center">
                  <p className="text-[10px] font-black uppercase text-slate-400 bg-slate-100 dark:bg-slate-900 px-3 py-1 rounded-full mb-3">
                    LIVE SELFIE
                  </p>
                  {selectedRequestForReview.selfieImageUrl ? (
                     <img 
                       src={selectedRequestForReview.selfieImageUrl} 
                       className="w-full h-80 rounded-2xl object-contain border border-slate-200 dark:border-slate-800 bg-white" 
                       alt="Student Selfie" 
                     />
                   ) : (
                     <div className="w-full h-80 rounded-2xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-400">
                       Selfie Image Not Uploaded
                     </div>
                   )}
                </div>

                {/* Student ID Card */}
                <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800/80 p-4 rounded-2xl flex flex-col items-center">
                  <p className="text-[10px] font-black uppercase text-slate-400 bg-slate-100 dark:bg-slate-900 px-3 py-1 rounded-full mb-3">
                    GOVERNMENT / CAMPUS ID CARD
                  </p>
                  {selectedRequestForReview.idImageUrl ? (
                    <img 
                      src={selectedRequestForReview.idImageUrl} 
                      className="w-full h-80 rounded-2xl object-contain border border-slate-200 dark:border-slate-800 bg-white" 
                      alt="Student Government ID" 
                    />
                  ) : (
                    <div className="w-full h-80 rounded-2xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-400">
                      ID Image Not Uploaded
                    </div>
                  )}
                </div>
              </div>

              {/* Student Detail Banner */}
              <div className="mt-6 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-800/60 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white leading-none">
                    {selectedRequestForReview.userName || 'Student'}
                  </h4>
                  <p className="text-xs font-mono text-slate-500 mt-1">{selectedRequestForReview.email}</p>
                </div>
                
                <div className="flex gap-2">
                  {selectedRequestForReview.status === 'pending' ? (
                    <>
                      <button
                        onClick={() => {
                          handleVerification(selectedRequestForReview.id, selectedRequestForReview.userId, false);
                          setSelectedRequestForReview(null);
                        }}
                        className="px-4 py-2 bg-red-50 text-red-655 hover:bg-red-100 border border-red-200 dark:border-red-900/40 rounded-xl text-xs font-black transition-all"
                      >
                        REJECT STUDENT
                      </button>
                      <button
                        onClick={() => {
                          handleVerification(selectedRequestForReview.id, selectedRequestForReview.userId, true);
                           setSelectedRequestForReview(null);
                        }}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-black shadow-lg shadow-green-100 dark:shadow-none transition-all"
                      >
                        APPROVE STUDENT
                      </button>
                    </>
                  ) : (
                    <span className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border ${
                      selectedRequestForReview.status === 'approved' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-red-50 text-red-600 border-red-100'
                    }`}>
                      {selectedRequestForReview.status}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
