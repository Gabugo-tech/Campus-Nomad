import { 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  updatePassword
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
  const [useEmailAuth, setUseEmailAuth] = useState(false); // Enable Google Sign-In by default for direct social OAuth options
  const [showGoogleGuide, setShowGoogleGuide] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState<string | null>(null);

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const devHost = currentHost.startsWith('ais-pre-') ? currentHost.replace('ais-pre-', 'ais-dev-') : currentHost;
  const preHost = currentHost.startsWith('ais-dev-') ? currentHost.replace('ais-dev-', 'ais-pre-') : currentHost;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedDomain(label);
    setTimeout(() => setCopiedDomain(null), 2000);
  };

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

  useEffect(() => {
    const checkRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result) {
          const user = result.user;
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (!userDoc.exists()) {
            const isAdminEmail = user.email === 'nnanwubagabriel@gmail.com';
            await setDoc(doc(db, 'users', user.uid), {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName || user.email?.split('@')[0],
              avatarUrl: user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${user.email}`,
              verified: isAdminEmail ? true : false,
              verificationStatus: isAdminEmail ? 'verified' : 'none',
              isAdmin: isAdminEmail ? true : undefined,
              createdAt: new Date().toISOString()
            });
          }
        }
      } catch (error: any) {
        console.log("Redirect result handled:", error);
      }
    };
    
    checkRedirectResult();
  }, []);

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    setLoading(true);
    setErrorMsg('');
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists()) {
        const isAdminEmail = user.email === 'nnanwubagabriel@gmail.com';
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || user.email?.split('@')[0],
          avatarUrl: user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${user.email}`,
          verified: isAdminEmail ? true : false,
          verificationStatus: isAdminEmail ? 'verified' : 'none',
          isAdmin: isAdminEmail ? true : undefined,
          createdAt: new Date().toISOString()
        });
      }
    } catch (popupError: any) {
      console.log("Popup login failed:", popupError);
      if (popupError?.code === 'auth/account-exists-with-different-credential') {
        setErrorMsg("An account with this email already exists using a different sign-in method (email/password). Please sign in using your Student Email and Password '909090' instead.");
        setUseEmailAuth(true); // Auto fallback
        setLoading(false);
        return;
      }

      // Display OAuth Guide and provide actionable support
      setShowGoogleGuide(true);
      if (popupError?.code === 'auth/popup-blocked') {
        setErrorMsg("The Google sign-in popup was blocked by your browser. Please allow popups for this site or click 'Open App in New Tab' below to bypass sandbox restrictions!");
      } else if (popupError?.code === 'auth/operation-not-allowed') {
        setErrorMsg("Google Sign-In is not enabled on this Firebase project yet. Please follow the 3 quick steps below to enable it!");
      } else if (popupError?.code === 'auth/unauthorized-domain') {
        setErrorMsg("This preview domain is not authorized in your Firebase Auth yet. Please follow step 2 below to add it!");
      } else {
        setErrorMsg("Browser safety or iframe sandbox restrictions halted the login popup. Simply follow the troubleshooting guide below to configure or bypass these limits!");
      }
      setLoading(false);
    }
  };

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

        // Set user in Firestore
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email,
          displayName: name,
          avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${name}`,
          verified: false,
          verificationStatus: 'none',
          createdAt: new Date().toISOString()
        });
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
      console.error("Email auth failed:", error);
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential' || error.message?.includes('invalid-credential')) {
        setErrorMsg("Incorrect email or password, or no account found. Please check your credentials or create a new student account below.");
      } else if (error.code === 'auth/wrong-password' || error.message === 'auth/wrong-password') {
        setErrorMsg("Incorrect password. Please try again.");
      } else if (error.code === 'auth/email-already-in-use') {
        setErrorMsg("This student email is already in use. Please sign in instead.");
      } else if (error.code === 'auth/invalid-email') {
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

          {useEmailAuth ? (
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
                  className="text-xs text-blue-600 font-bold hover:underline"
                >
                  {isRegister ? "Already have a student account? Sign In" : "New student here? Create Student Account"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setUseEmailAuth(false);
                    setErrorMsg('');
                  }}
                  className="text-xs font-bold font-mono text-slate-400 hover:text-slate-600"
                >
                  Or use social login options
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full py-4 border border-slate-200 text-slate-800 bg-white rounded-2xl font-bold text-sm hover:bg-slate-50 transition-all flex items-center justify-center gap-3 active:scale-95 shadow-sm"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin text-blue-600" />
                ) : (
                  <>
                    <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
                    Continue with Google OAuth
                  </>
                )}
              </button>

              <button
                onClick={() => setUseEmailAuth(true)}
                className="w-full py-4 bg-slate-100 text-slate-700 rounded-2xl font-bold text-sm hover:bg-slate-200 transition-all flex items-center justify-center gap-2 active:scale-95"
              >
                <Mail size={18} />
                Continue with Student Email & Password
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setShowGoogleGuide(!showGoogleGuide)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition cursor-pointer"
                >
                  <HelpCircle size={14} className="text-slate-450" />
                  Google login not working? Setup & Troubleshoot
                </button>
              </div>

              {showGoogleGuide && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  className="mt-4 border-t border-dashed border-slate-200 pt-4 text-left space-y-4 text-xs overflow-hidden"
                >
                  <div className="bg-blue-50/50 rounded-2xl p-4 border border-blue-100/60">
                    <p className="font-bold text-blue-700 mb-1 leading-normal flex items-center gap-1.5">
                      💡 Active Sandbox Environment Guide:
                    </p>
                    <p className="text-slate-650 leading-relaxed font-semibold">
                      To make Google OAuth fully functional, register your preview instance domains in the Firebase Console:
                    </p>
                  </div>

                  <div className="space-y-4 font-semibold text-slate-750">
                    {/* Step 1 */}
                    <div className="space-y-1">
                      <p className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-mono font-black text-slate-500 shrink-0">1</span>
                        Enable Google Provider
                      </p>
                      <p className="text-slate-550 leading-relaxed pl-6">
                        Open the{" "}
                        <a
                          href="https://console.firebase.google.com/project/gen-lang-client-0036951224/authentication/providers"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-0.5 font-bold"
                        >
                          Firebase Auth Console <ExternalLink size={12} />
                        </a>
                        , select <strong>Google</strong> as a provider, enable it, and choose your project support email.
                      </p>
                    </div>

                    {/* Step 2 */}
                    <div className="space-y-1.5">
                      <p className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-mono font-black text-slate-500 shrink-0">2</span>
                        Add Authorized Domains
                      </p>
                      <p className="text-slate-550 leading-relaxed pl-6 mb-2">
                        Under Authentication &gt; <strong>Settings</strong> &gt; <strong>Authorized domains</strong>, add these two preview URLs:
                      </p>
                      <div className="pl-6 space-y-2">
                        {/* Domain 1 */}
                        <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                          <code className="text-[11px] font-mono font-bold text-slate-705 break-all select-all">{devHost}</code>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(devHost, 'dev')}
                            className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg bg-white border border-slate-200 hover:shadow-sm shrink-0"
                          >
                            {copiedDomain === 'dev' ? <Check size={14} className="text-emerald-600 font-bold" /> : <Copy size={14} />}
                          </button>
                        </div>
                        {/* Domain 2 */}
                        <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                          <code className="text-[11px] font-mono font-bold text-slate-705 break-all select-all">{preHost}</code>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(preHost, 'pre')}
                            className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg bg-white border border-slate-200 hover:shadow-sm shrink-0"
                          >
                            {copiedDomain === 'pre' ? <Check size={14} className="text-emerald-600 font-bold" /> : <Copy size={14} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="space-y-2">
                      <p className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-mono font-black text-slate-500 shrink-0">3</span>
                        Bypass Iframe Restrictions
                      </p>
                      <p className="text-slate-550 leading-relaxed pl-6 mb-3">
                        If standard browsers block popups inside iframe frames, open this developer container in its own top-level tab to log in successfully:
                      </p>
                      <div className="pl-6">
                        <a
                          href={window.location.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:shadow-lg transition active:scale-95 text-center cursor-pointer"
                        >
                          <ExternalLink size={14} />
                          Open App in New Tab
                        </a>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
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

