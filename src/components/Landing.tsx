import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  updatePassword,
  sendEmailVerification
} from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { GraduationCap, Zap, Users, ShieldCheck, Mail, Lock, User as UserIcon, Loader2, ArrowRight, HelpCircle, Copy, Check, ExternalLink } from 'lucide-react';

export default function Landing() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [emailSentCheck, setEmailSentCheck] = useState(false);

  useEffect(() => {
    const preRegisterAdmin = async () => {
      const adminEmail = 'nnanwubagabriel@gmail.com';
      const adminPass = '909090';
      const adminName = 'Gabriel Nnanwuba (Admin)';
      
      try {
        const result = await createUserWithEmailAndPassword(auth, adminEmail, adminPass);
        const user = result.user;
        await updateProfile(user, {
          displayName: adminName,
          photoURL: `https://api.dicebear.com/7.x/initials/svg?seed=${adminName}`
        });

        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email,
          displayName: adminName,
          avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${adminName}`,
          verified: true,
          verificationStatus: 'verified',
          isAdmin: true,
          createdAt: new Date().toISOString()
        });
        console.log("Admin registered on startup successfully.");
      } catch (err: any) {
        if (err?.code === 'auth/email-already-in-use') {
          console.log("Admin registration already active.");
        } else {
          console.warn("Startup admin pre-registration handled:", err?.message || err);
        }
      }
    };
    
    preRegisterAdmin();
  }, []);

  // Listen value checks for automatic redirect when verified
  useEffect(() => {
    let interval: any = null;
    if (emailSentCheck && auth.currentUser) {
      interval = setInterval(async () => {
        try {
          await auth.currentUser?.reload();
          if (auth.currentUser?.emailVerified) {
            clearInterval(interval);
            await setDoc(doc(db, 'users', auth.currentUser.uid), {
              verified: true,
              verificationStatus: 'verified'
            }, { merge: true });
          }
        } catch (err) {
          console.warn("Dynamic login verification poller warning:", err);
        }
      }, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [emailSentCheck]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || (isRegister && !name)) {
      setErrorMsg("Please fill in all standard fields.");
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      if (isRegister) {
        // Create User
        const result = await createUserWithEmailAndPassword(auth, email, password);
        const user = result.user;
        await updateProfile(user, {
          displayName: name,
          photoURL: `https://api.dicebear.com/7.x/initials/svg?seed=${name}`
        });

        // Handle Admin Bypass vs Student Email Verification
        if (email === 'nnanwubagabriel@gmail.com') {
          await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            email: user.email,
            displayName: name,
            avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${name}`,
            verified: true,
            verificationStatus: 'verified',
            isAdmin: true,
            createdAt: new Date().toISOString()
          });
        } else {
          try {
            await sendEmailVerification(user);
            setEmailSentCheck(true);
          } catch (verifErr) {
            console.warn("Could not dispatch email verification on registration:", verifErr);
            setErrorMsg("Authentication created successfully, but verification dispatch failed. Please verify your student email domain.");
          }

          // Set user in Firestore as unverified initially
          await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            email: user.email,
            displayName: name,
            avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${name}`,
            verified: false,
            verificationStatus: 'none',
            createdAt: new Date().toISOString()
          });
        }
      } else {
        // Sign In
        try {
          await signInWithEmailAndPassword(auth, email, password);
        } catch (error: any) {
          const isAdminCreds = email === 'nnanwubagabriel@gmail.com' && password === '909090';
          const isUserNotFound = error.code === 'auth/user-not-found' || 
                                 error.code === 'auth/invalid-credential' ||
                                 error.message?.includes('user-not-found') ||
                                 error.message?.includes('invalid-credential');
          const isWrongPassword = error.code === 'auth/wrong-password' ||
                                  error.message?.includes('wrong-password');

          if (isAdminCreds && isUserNotFound) {
            try {
              const result = await createUserWithEmailAndPassword(auth, email, password);
              const user = result.user;
              const adminName = 'Gabriel Nnanwuba (Admin)';
              await updateProfile(user, {
                displayName: adminName,
                photoURL: `https://api.dicebear.com/7.x/initials/svg?seed=${adminName}`
              });
              await setDoc(doc(db, 'users', user.uid), {
                uid: user.uid,
                email: user.email,
                displayName: adminName,
                avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${adminName}`,
                verified: true,
                verificationStatus: 'verified',
                isAdmin: true,
                createdAt: new Date().toISOString()
              });
              return;
            } catch (createErr: any) {
              if (createErr.code === 'auth/email-already-in-use') {
                throw new Error("auth/wrong-password");
              }
              throw createErr;
            }
          } else if (isAdminCreds && (isWrongPassword || error.code === 'auth/invalid-credential' || error.message?.includes('invalid-credential'))) {
            // If logging in as admin with password '909090' but authentication fails, check for password migrate challenge
            try {
              const result = await signInWithEmailAndPassword(auth, email, '901010');
              const user = result.user;
              // Migrate password to 909090
              await updatePassword(user, '909090');
              // Ensure database status is correct too
              const adminName = 'Gabriel Nnanwuba (Admin)';
              await setDoc(doc(db, 'users', user.uid), {
                uid: user.uid,
                email: user.email,
                displayName: adminName,
                avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${adminName}`,
                verified: true,
                verificationStatus: 'verified',
                isAdmin: true,
                createdAt: new Date().toISOString()
              }, { merge: true });
              return;
            } catch (migrationErr: any) {
              // If migration failed or wasn't due to the old '901010' password, just throw the original error
              throw error;
            }
          }
          throw error;
        }
      }
    } catch (error: any) {
      console.warn("Email auth alert:", error?.code || error?.message || error);
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential' || error.message?.includes('invalid-credential') || error.code?.includes('invalid-credential')) {
        setErrorMsg("Incorrect email or password, or no account found. Please check your credentials or create a new student account below.");
      } else if (error.code === 'auth/wrong-password' || error.message === 'auth/wrong-password' || error.message?.includes('wrong-password') || error.code?.includes('wrong-password')) {
        setErrorMsg("Incorrect password. Please try again.");
      } else if (error.code === 'auth/email-already-in-use' || error.message?.includes('email-already-in-use') || error.code?.includes('email-already-in-use')) {
        setErrorMsg("This student student email is already in use. Please sign in instead.");
      } else if (error.code === 'auth/invalid-email' || error.message?.includes('invalid-email') || error.code?.includes('invalid-email')) {
        setErrorMsg("Please enter a valid email address.");
      } else {
        setErrorMsg(error.message || "Authentication error. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-blue-100 italic-none">
      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 pt-16 pb-24 flex flex-col items-center justify-center text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-sm font-medium mb-8 border border-blue-100"
        >
          <GraduationCap size={16} />
          Exclusive for University Students
        </motion.div>
        
        <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-6 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 bg-clip-text text-transparent leading-tight">
          Campus life, <br /><span className="text-blue-600 italic font-medium">unlocked.</span>
        </h1>
        
        <p className="text-lg text-slate-600 max-w-2xl mb-8 leading-relaxed">
          The all-in-one social platform for university students. Secure verification, campus-wide feeds, marketplace, and real-time connections.
        </p>

        {/* Authentication Card */}
        <div className="w-full max-w-md bg-white border border-slate-200 p-8 rounded-[2rem] shadow-xl shadow-slate-100/50 mb-12">
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl text-xs font-bold text-red-600/90 leading-relaxed text-left flex items-start gap-2 animate-shake">
              <span className="shrink-0 mt-0.5 font-mono">⚠️</span>
              <p>{errorMsg}</p>
            </div>
          )}

          {emailSentCheck ? (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-6">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto border border-blue-100">
                <Mail size={28} className="animate-pulse animate-duration-1000" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900 leading-tight">Verify Your Student Email</h3>
                <p className="text-slate-500 text-xs leading-relaxed">
                  We've sent a secure validation link to <strong className="text-slate-800">{email}</strong>. Please click the link inside your inbox to verify your student status.
                </p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center gap-2 justify-center text-[11px] font-bold text-slate-500">
                <Loader2 size={14} className="animate-spin text-blue-600" />
                <span>Checking confirmation status in real-time...</span>
              </div>
              <button
                onClick={() => {
                  setEmailSentCheck(false);
                  setIsRegister(false);
                  setEmail('');
                  setPassword('');
                }}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all active:scale-95"
              >
                Back to Entrance
              </button>
            </motion.div>
          ) : (
            <form onSubmit={handleEmailAuth} className="space-y-4 text-left">
              <h3 className="text-lg font-black text-slate-900 mb-4">
                {isRegister ? "Create Campus Account" : "Sign In to Campus"}
              </h3>

              {isRegister && (
                <div className="space-y-1.5">
                  <label className="text-xs font-mono font-black text-slate-400 uppercase">Full Name</label>
                  <div className="relative">
                    <UserIcon size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Gabriel Nwanwuba"
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-250/60 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all font-medium"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-mono font-black text-slate-400 uppercase">Campus Email</label>
                <div className="relative">
                  <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. name@unilag.edu.ng"
                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-250/60 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all font-medium"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-mono font-black text-slate-400 uppercase">Password</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-250/60 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all font-medium"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 mt-6 text-sm"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    {isRegister ? "Join Campus-Nomad" : "Sign In"} <ArrowRight size={16} />
                  </>
                )}
              </button>

              <div className="flex flex-col gap-3 pt-4 border-t border-slate-100 text-center mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsRegister(!isRegister);
                    setErrorMsg('');
                  }}
                  className="text-xs text-blue-600 font-bold hover:underline cursor-pointer"
                >
                  {isRegister ? "Already have a student account? Sign In" : "New student here? Create Student Account"}
                </button>


              </div>
            </form>
          )}
        </div>
      </div>

      {/* Features Grid */}
      <div className="bg-slate-50 py-24">
        <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: Zap,
              title: "Live Feed",
              desc: "Stay updated with what's happening on your campus and globally. Posts, polls, and reels."
            },
            {
              icon: ShieldCheck,
              title: "Verified Only",
              desc: "Strict verification via school domain and ID. A platform for real students, by real students."
            },
            {
              icon: Users,
              title: "Student Market",
              desc: "Buy and sell items within your campus securely. From textbooks to gadgets."
            }
          ].map((feature, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 mb-6 font-bold">
                <feature.icon size={24} />
              </div>
              <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
              <p className="text-slate-600 leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="py-12 border-t border-slate-100 text-center text-slate-400 text-sm">
        <p>&copy; 2026 Campus-Nomad. Made for the future.</p>
      </footer>
    </div>
  );
}

