import { useState, useEffect, useRef } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { ShieldCheck, Upload, Camera, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Verification() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'none' | 'pending' | 'approved' | 'rejected'>('none');
  const [email, setEmail] = useState('');
  const [approvedDomains, setApprovedDomains] = useState<string[]>([]);
  const navigate = useNavigate();

  // Custom ID/Selfie upload attachment strings
  const [idImgBase64, setIdImgBase64] = useState<string | null>(null);
  const [selfieImgBase64, setSelfieImgBase64] = useState<string | null>(null);

  const idInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!auth.currentUser) return;

    // Fetch approved domains - including COOU explicitly and supporting general university domains
    setApprovedDomains(["unilag.edu.ng", "ui.edu.ng", "lasu.edu.ng", "oauife.edu.ng", "coou.edu.ng", "gmail.com"]);

    const unsubscribe = onSnapshot(doc(db, 'users', auth.currentUser.uid), (docSnap) => {
      const data = docSnap.data();
      if (data) {
        setStatus(data.verificationStatus || 'none');
        if (data.verified) navigate('/feed');
      }
    });

    return unsubscribe;
  }, [navigate]);

  const handleIdSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setIdImgBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSelfieSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelfieImgBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!auth.currentUser || !email) return;

    const domain = email.toLowerCase().split('@')[1];
    const isValidUni = domain.endsWith('.edu.ng') || approvedDomains.includes(domain);
    if (!isValidUni) {
      alert("Please use a valid university email address (e.g., studentname@coou.edu.ng or any other university .edu.ng domain)");
      return;
    }

    setLoading(true);
    try {
      try {
        await addDoc(collection(db, 'verificationRequests'), {
          userId: auth.currentUser.uid,
          email: email,
          userName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Student',
          idImageUrl: idImgBase64 || "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400",
          selfieImageUrl: selfieImgBase64 || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
          status: 'pending',
          createdAt: serverTimestamp()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'verificationRequests');
      }
      
      const userRef = doc(db, 'users', auth.currentUser.uid);
      try {
        await updateDoc(userRef, {
          verificationStatus: 'pending'
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}`);
      }

      setStep(3);
    } catch (error) {
      console.error("Verification failed:", error);
    } finally {
      setLoading(false);
    }
  };

  if (status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 mb-6 animate-pulse">
          <Loader2 size={40} className="animate-spin" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Verification in Progress</h2>
        <p className="text-slate-500 max-w-sm mb-6">
          We've received your request! Our campus admins are reviewing your documents. This usually takes less than 24 hours. Once verified, you will be automatically granted entry.
        </p>
        <button
          onClick={() => auth.signOut()}
          className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold uppercase tracking-wider rounded-2xl transition-all active:scale-95 border border-slate-200"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-8">
      <div className="text-center mb-10">
        <div className="inline-flex p-3 bg-blue-50 text-blue-600 rounded-2xl mb-4">
          <ShieldCheck size={32} />
        </div>
        <h1 className="text-3xl font-black italic-none leading-tight">Verification Desk</h1>
        <p className="text-slate-500 text-sm">Verify your student status to unlock the social hallway.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
        <div className="flex gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`flex-1 h-1.5 rounded-full transition-all ${
                step >= s ? "bg-blue-600" : "bg-slate-100"
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
            <h3 className="text-xl font-bold mb-2">School Email</h3>
            <p className="text-slate-500 mb-6 text-xs">Enter your official university email domain ending in .edu.ng</p>
            <div className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. name@unilag.edu.ng"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-250 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-semibold"
              />
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex gap-3">
                <AlertCircle size={20} className="text-blue-600 shrink-0" />
                <p className="text-xs text-blue-700 leading-relaxed">
                  We verify your domain to confirm you are actively enrolled in an approved partner institution.
                </p>
              </div>
              <button
                disabled={!email.includes('.edu.ng') && !email.endsWith('@gmail.com')}
                onClick={() => setStep(2)}
                className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase tracking-wider mt-4 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 transition-all"
              >
                Continue
              </button>
              <div className="text-center mt-4">
                <button
                  type="button"
                  onClick={() => auth.signOut()}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-all underline decoration-dashed decoration-slate-350 underline-offset-4"
                >
                  Cancel & Sign Out
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
            <h3 className="text-xl font-bold mb-2">Identity Verification</h3>
            <p className="text-slate-500 mb-6 text-xs">Upload your Student ID card and a quick selfie to enable clearance.</p>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* ID upload input and button */}
              <input
                type="file"
                accept="image/*"
                ref={idInputRef}
                onChange={handleIdSelect}
                className="hidden"
              />
              <div 
                onClick={() => idInputRef.current?.click()}
                className="aspect-square bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 hover:border-blue-400 hover:text-blue-500 cursor-pointer transition-all overflow-hidden relative"
              >
                {idImgBase64 ? (
                  <img src={idImgBase64} className="w-full h-full object-cover" alt="ID upload" />
                ) : (
                  <>
                    <Upload size={24} className="mb-2" />
                    <span className="text-xs font-bold font-mono">STUDENT ID</span>
                  </>
                )}
              </div>

              {/* Selfie upload input and button */}
              <input
                type="file"
                accept="image/*"
                ref={selfieInputRef}
                onChange={handleSelfieSelect}
                className="hidden"
              />
              <div 
                onClick={() => selfieInputRef.current?.click()}
                className="aspect-square bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 hover:border-blue-400 hover:text-blue-500 cursor-pointer transition-all overflow-hidden relative"
              >
                {selfieImgBase64 ? (
                  <img src={selfieImgBase64} className="w-full h-full object-cover" alt="Selfie upload" />
                ) : (
                  <>
                    <Camera size={24} className="mb-2" />
                    <span className="text-xs font-bold font-mono">SELFIE</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-slate-200 transition-all"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !idImgBase64 || !selfieImgBase64}
                className="flex-2 py-4 bg-blue-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                Submit for Review
              </button>
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} />
            </div>
            <h3 className="text-xl font-bold mb-2">Request Submitted!</h3>
            <p className="text-slate-500 mb-6 text-xs">
              We'll notify you once our admin team has verified your details. Hang tight!
            </p>
            <button
              onClick={() => navigate('/')}
              className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all mb-3"
            >
              Back to Entrance
            </button>
            <button
              onClick={() => auth.signOut()}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
            >
              Sign Out
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
