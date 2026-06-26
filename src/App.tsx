import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, onSnapshot } from './lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import Layout from './components/Layout';
import Feed from './components/Feed';
import Reels from './components/Reels';
import Chat from './components/Chat';
import Marketplace from './components/Marketplace';
import Profile from './components/Profile';
import Admin from './components/Admin';
import Verification from './components/Verification';
import Landing from './components/Landing';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [csrfLoaded, setCsrfLoaded] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  // Dynamic CSRF Token initialization with exponential backoff retry logic to handle server cold-starts robustly
  useEffect(() => {
    let retries = 0;
    const maxRetries = 6;

    const getCsrf = () => {
      fetch('/api/csrf-token')
        .then(res => {
          if (!res.ok) throw new Error(`HTTP status ${res.status}`);
          return res.json();
        })
        .then(data => {
          if (data.csrfToken) {
            (window as any).csrfToken = data.csrfToken;
          }
          setCsrfLoaded(true);
        })
        .catch((err) => {
          console.warn(`CSRF token fetch attempt ${retries + 1} failed:`, err);
          if (retries < maxRetries) {
            retries++;
            setTimeout(getCsrf, Math.min(1000 * Math.pow(2, retries), 10000));
          } else {
            console.error("CSRF token initialization failed after maximum retries:", err);
            setCsrfLoaded(true); // Gracefully proceed instead of hanging the screen
          }
        });
    };

    getCsrf();
  }, []);

  // Global listeners to dynamically detect Firestore / Firebase database free-tier quota depletion
  useEffect(() => {
    const handleQuotaExceeded = () => {
      setQuotaExceeded(true);
    };

    const handleGlobalError = (event: ErrorEvent) => {
      const msg = event.message || '';
      if (
        msg.toLowerCase().includes('quota') || 
        msg.toLowerCase().includes('exhausted') || 
        msg.toLowerCase().includes('resource-exhausted')
      ) {
        setQuotaExceeded(true);
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      if (
        msg.toLowerCase().includes('quota') || 
        msg.toLowerCase().includes('exhausted') || 
        msg.toLowerCase().includes('resource-exhausted')
      ) {
        setQuotaExceeded(true);
      }
    };

    window.addEventListener('firestore-quota-exceeded', handleQuotaExceeded);
    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('firestore-quota-exceeded', handleQuotaExceeded);
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    let unsubUserDoc: (() => void) | null = null;

    // Load theme setting on startup
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    let verificationCheckInterval: any = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      
      if (verificationCheckInterval) {
        clearInterval(verificationCheckInterval);
        verificationCheckInterval = null;
      }

      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }

      if (u) {
        // Auto-verify the admin to avoid getting locked out
        if (u.email === 'nnanwubagabriel@gmail.com') {
          setIsVerified(true);
          setIsBlocked(false);
          const adminDocRef = doc(db, 'users', u.uid);
          const adminName = u.displayName || 'Gabriel Nnanwuba (Admin)';
          
          getDoc(adminDocRef).then((snap) => {
            if (!snap.exists()) {
              setDoc(adminDocRef, {
                uid: u.uid,
                email: u.email,
                displayName: adminName,
                avatarUrl: u.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${adminName}`,
                verified: true,
                verificationStatus: 'verified',
                isAdmin: true,
                createdAt: new Date().toISOString()
              }, { merge: true });
            } else {
              setDoc(adminDocRef, {
                uid: u.uid,
                email: u.email,
                verified: true,
                verificationStatus: 'verified',
                isAdmin: true
              }, { merge: true });
            }
          }).catch((err) => {
            console.warn("Could not auto-verify admin database record:", err);
          });

          setLoading(false);
          return;
        }

        // Core dynamic background email verification check for new students
        if (!u.emailVerified) {
          verificationCheckInterval = setInterval(async () => {
            try {
              // Ensure we reload context to capture user verification state change
              await u.reload();
              if (u.emailVerified) {
                if (verificationCheckInterval) {
                  clearInterval(verificationCheckInterval);
                  verificationCheckInterval = null;
                }
                await setDoc(doc(db, 'users', u.uid), {
                  verified: true,
                  verificationStatus: 'verified'
                }, { merge: true });
              }
            } catch (err) {
              console.warn("Real-time email verification poller warning:", err);
            }
          }, 2000);
        }

        // Subscribe to user doc in Firestore in real time
        unsubUserDoc = onSnapshot(doc(db, 'users', u.uid), (userDoc) => {
          if (userDoc.exists()) {
            const data = userDoc.data();
            setIsVerified(data.verified || false);
            setIsBlocked(data.blocked === true);
          } else {
            setIsVerified(false);
            setIsBlocked(false);
          }
          setLoading(false);
        }, (error) => {
          console.error("User doc snapshot error:", error);
          setLoading(false);
        });
      } else {
        setIsVerified(false);
        setIsBlocked(false);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubUserDoc) unsubUserDoc();
      if (verificationCheckInterval) clearInterval(verificationCheckInterval);
    };
  }, []);

  if (loading || !csrfLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (isBlocked && user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white p-6 text-center">
        <div className="w-20 h-20 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center mb-6 animate-pulse">
          <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-3xl font-black mb-4">Student Profile Blocked</h1>
        <p className="text-slate-400 max-w-sm text-xs leading-relaxed mb-6 font-semibold">
          Your profile has been temporarily or permanently blocked by a student network administrator for violating Campus policies.
        </p>
        <button
          onClick={() => auth.signOut()}
          className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider rounded-2xl transition-all active:scale-95"
        >
          Close & Sign Out
        </button>
      </div>
    );
  }

  // Helper check to see if user has authorized access
  const hasAccess = user && (isVerified || user.email === 'nnanwubagabriel@gmail.com');

  return (
    <>
      {quotaExceeded && (
        <div className="fixed top-0 inset-x-0 z-[200] bg-amber-600 dark:bg-amber-800 text-white text-xs py-2.5 px-4 shadow-xl border-b border-amber-500 flex items-center justify-between gap-4 font-sans animate-fade-in">
          <div className="flex items-center gap-2 max-w-5xl mx-auto flex-1">
            <span className="shrink-0 p-1 bg-white/20 rounded-lg">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </span>
            <p className="leading-normal font-medium text-left">
              <strong className="font-extrabold mr-1">Cloud Database Daily Quota Exceeded:</strong> 
              The Firestore database free tier has run out of daily read/write operations. The application is running in transient local cache fallback mode and will resume fully once the quota resets tomorrow.
              <a 
                href="https://console.firebase.google.com/project/gen-lang-client-0036951224/firestore/databases/ai-studio-a816fe72-4c23-410e-a34a-ce4eb1f0f56d/data?openUpgradeDialog=true"
                target="_blank" 
                rel="noopener noreferrer" 
                className="ml-2 inline-flex items-center font-bold underline hover:text-amber-100 transition-colors gap-0.5 whitespace-nowrap"
              >
                Upgrade Database in Console
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </p>
          </div>
          <button 
            onClick={() => setQuotaExceeded(false)}
            className="shrink-0 p-1 hover:bg-white/10 rounded-full transition-colors font-bold text-[10px] uppercase tracking-wider bg-black/10 px-2 cursor-pointer transition-all hover:scale-105"
          >
            Acknowledge
          </button>
        </div>
      )}
      <BrowserRouter>
        <Routes>
          <Route path="/" element={user ? <Navigate to={hasAccess ? "/feed" : "/verify"} /> : <Landing />} />
          <Route element={<Layout user={user} isVerified={isVerified} />}>
            <Route path="/feed" element={user ? (hasAccess ? <Feed /> : <Navigate to="/verify" />) : <Navigate to="/" />} />
            <Route path="/reels" element={user ? (hasAccess ? <Reels /> : <Navigate to="/verify" />) : <Navigate to="/" />} />
            <Route path="/chat" element={user ? (hasAccess ? <Chat /> : <Navigate to="/verify" />) : <Navigate to="/" />} />
            <Route path="/marketplace" element={user ? (hasAccess ? <Marketplace /> : <Navigate to="/verify" />) : <Navigate to="/" />} />
            <Route path="/profile" element={user ? (hasAccess ? <Profile /> : <Navigate to="/verify" />) : <Navigate to="/" />} />
            <Route path="/profile/:userId" element={user ? (hasAccess ? <Profile /> : <Navigate to="/verify" />) : <Navigate to="/" />} />
            <Route path="/admin" element={user && user.email === 'nnanwubagabriel@gmail.com' ? <Admin /> : <Navigate to="/" />} />
            <Route path="/verify" element={user ? (hasAccess ? <Navigate to="/feed" /> : <Verification />) : <Navigate to="/" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </>
  );
}
