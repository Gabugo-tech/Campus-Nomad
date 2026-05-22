import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from './lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
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

  useEffect(() => {
    let unsubUserDoc: (() => void) | null = null;

    // Load theme setting on startup
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }

      if (u) {
        // Auto-verify the admin to avoid getting locked out
        if (u.email === 'nnanwubagabriel@gmail.com') {
          setIsVerified(true);
          setIsBlocked(false);
          setLoading(false);
          return;
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
    };
  }, []);

  if (loading) {
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
  );
}
