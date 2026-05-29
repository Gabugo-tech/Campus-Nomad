import { useState, useEffect, useRef } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { updateProfile } from 'firebase/auth';
import { doc, onSnapshot, collection, query, where, getDocs, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Grid, ShoppingBag, Bookmark, CheckCircle2, MapPin, GraduationCap, Calendar, Edit3, MessageCircle, UserPlus, UserMinus, X, MoreVertical, LogOut, Sun, Moon, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { logActivity } from '../lib/activity';
import { VerificationBadge } from './VerificationBadge';

const compressImage = (file: File, maxWidth = 400, maxHeight = 400, quality = 0.75): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(event.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

export default function Profile() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'posts' | 'marketplace' | 'saved'>('posts');
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [userMarketItems, setUserMarketItems] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    return document.documentElement.classList.contains('dark') || localStorage.getItem('theme') === 'dark';
  });

  const toggleTheme = () => {
    const nextDark = !isDarkMode;
    setIsDarkMode(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };
  
  // Real-time Follows State
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  
  // Real-time Followers/Following lists details
  const [showFollowersModal, setShowFollowersModal] = useState(false);
  const [showFollowingModal, setShowFollowingModal] = useState(false);
  const [followersList, setFollowersList] = useState<any[]>([]);
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [allStudentsMapped, setAllStudentsMapped] = useState<Record<string, any>>({});

  // Edit Profile States
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editCampus, setEditCampus] = useState('');
  const [editCourse, setEditCourse] = useState('');
  const [editYear, setEditYear] = useState('');
  const [showThreeDots, setShowThreeDots] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  // Nigeria Real-Time universities and courses mapping
  const [nigerianUnis, setNigerianUnis] = useState<string[]>([]);
  const [uniSearch, setUniSearch] = useState('');
  const [showUniDropdown, setShowUniDropdown] = useState(false);
  const [showCourseDropdown, setShowCourseDropdown] = useState(false);
  const [courseSearch, setCourseSearch] = useState('');

  const NIGERIAN_COURSES = {
    general: [
      "Computer Science",
      "Software Engineering",
      "Computer Engineering",
      "Medicine and Surgery",
      "Pharmacy",
      "Nursing Science",
      "Medical Laboratory Science",
      "Law",
      "Accounting",
      "Economics",
      "Business Administration",
      "Mass Communication",
      "Electrical/Electronic Engineering",
      "Mechanical Engineering",
      "Civil Engineering",
      "Chemical Engineering",
      "Petroleum Engineering",
      "Systems Engineering",
      "Mechatronics Engineering",
      "Biomedical Engineering",
      "Agricultural Engineering",
      "Biochemistry",
      "Microbiology",
      "MCB (Microbiology / Molecular Biology)",
      "Anatomy",
      "Physiology",
      "Industrial Chemistry",
      "ICH (Industrial Chemistry)",
      "Political Science",
      "Sociology",
      "English and Literary Studies"
    ],
    tech: [
      "Computer Science",
      "Cybersecurity",
      "Software Engineering",
      "Information Technology",
      "Data Science",
      "Computer Engineering",
      "Electrical/Electronic Engineering",
      "Mechanical Engineering",
      "Civil Engineering",
      "Chemical Engineering",
      "Petroleum Engineering",
      "Systems Engineering",
      "Mechatronics Engineering",
      "Biomedical Engineering",
      "Agricultural Engineering",
      "Metallurgical and Materials Engineering",
      "Aerospace Engineering",
      "Structural Engineering",
      "Food Engineering",
      "Industrial Chemistry",
      "ICH (Industrial Chemistry)",
      "Physics with Electronics"
    ],
    medical: [
      "Medicine and Surgery",
      "Pharmacy",
      "Nursing Science",
      "Medical Laboratory Science",
      "Physiology",
      "Anatomy",
      "Dentistry",
      "Optometry",
      "Public Health",
      "Microbiology",
      "MCB (Microbiology / Molecular Biology)"
    ],
    humanities: [
      "Law",
      "Accounting",
      "Economics",
      "Business Administration",
      "Mass Communication",
      "Political Science",
      "Sociology",
      "English and Literary Studies",
      "History and International Studies",
      "Theatre Arts"
    ]
  };

  // Fetch real-time Nigeria Universities on open
  useEffect(() => {
    if (!showEditModal) return;
    
    // warm up search helpers
    setUniSearch(editCampus || '');
    setCourseSearch(editCourse || '');

    const FEDERAL_UNIVERSITIES = [
      "Abubakar Tafawa Balewa University, Bauchi",
      "Ahmadu Bello University, Zaria",
      "Bayero University, Kano",
      "Federal University of Agriculture, Abeokuta",
      "Federal University of Technology, Akure",
      "Federal University of Technology, Minna",
      "Federal University of Technology, Owerri",
      "Federal University of Petroleum Resources, Effurun",
      "Federal University, Birnin Kebbi",
      "Federal University, Dutse",
      "Federal University, Dutsin-Ma",
      "Federal University, Gashua",
      "Federal University, Gusau",
      "Federal University, Kashere",
      "Federal University, Lafia",
      "Federal University, Lokoja",
      "Federal University, Ndufu-Alike",
      "Federal University, Otuoke",
      "Federal University, Oye-Ekiti",
      "Federal University, Wukari",
      "Michael Okpara University of Agriculture, Umudike",
      "National Open University of Nigeria",
      "Nnamdi Azikiwe University, Awka",
      "Obafemi Awolowo University, Ile-Ife",
      "University of Abuja",
      "University of Benin",
      "University of Calabar",
      "University of Ibadan",
      "University of Ilorin",
      "University of Jos",
      "University of Lagos",
      "University of Maiduguri",
      "University of Nigeria, Nsukka",
      "University of Port Harcourt",
      "University of Uyo",
      "Usmanu Danfodiyo University, Sokoto"
    ];

    const STATE_UNIVERSITIES = [
      "Chukwuemeka Odumegwu Ojukwu University, Anambra State (COOU)",
      "Chukwuemeka Odumegwu Ojukwu University",
      "Abia State University, Uturu",
      "Adamawa State University, Mubi",
      "Adekunle Ajasin University, Akungba",
      "Akwa Ibom State University, Omit",
      "Ambrose Alli University, Ekpoma",
      "Delta State University, Abraka",
      "Ebonyi State University, Abakaliki",
      "Enugu State University of Science and Technology, Enugu",
      "Gombe State University, Gombe",
      "Ibrahim Badamasi Babangida University, Lapai",
      "Ignatius Ajuru University of Education, Rumuolumeni",
      "Imo State University, Owerri",
      "Kaduna State University, Kaduna",
      "Kano State University of Science and Technology, Wudil",
      "Kogi State University Anyigba",
      "Kwara State University, Malete",
      "Ladoke Akintola University of Technology, Ogbomoso",
      "Lagos State University, Ojo",
      "Nasarawa State University Keffi",
      "Niger Delta University, Wilberforce Island",
      "Olabisi Onabanjo University, Ago-Iwoye",
      "Osun State University, Osogbo",
      "Rivers State University",
      "Tai Solarin University of Education, Ijagun",
      "Taraba State University, Jalingo",
      "Umaru Musa Yar'Adua University, Katsina"
    ];

    const PRIVATE_UNIVERSITIES = [
      "Babcock University, Ilishan-Remo",
      "Baze University, Abuja",
      "Covenant University, Ota",
      "Landmark University, Omu-Aran",
      "Pan-Atlantic University, Lekki",
      "Redeemer's University, Ede",
      "Igbinedion University, Okada",
      "American University of Nigeria, Yola",
      "Adeleke University, Ede",
      "Afe Babalola University, Ado-Ekiti",
      "Ajayi Crowther University, Oyo",
      "Al-Hikmah University, Ilorin",
      "Bells University of Technology, Ota",
      "Bowen University, Iwo",
      "Caleb University, Imota",
      "Lead City University, Ibadan",
      "Nile University of Nigeria, Abuja",
      "Veritas University, Abuja"
    ];

    const ALL_MASTER_UNIS = Array.from(new Set([
      ...FEDERAL_UNIVERSITIES,
      ...STATE_UNIVERSITIES,
      ...PRIVATE_UNIVERSITIES
    ])).sort();

    fetch("/api/universities")
      .then(res => res.json())
      .then(data => {
        let list = [...ALL_MASTER_UNIS];
        if (Array.isArray(data) && data.length > 0) {
          const fetchedNames = data.map((u: any) => u.name).filter(Boolean);
          list = Array.from(new Set([...list, ...fetchedNames]));
        }
        setNigerianUnis(list.sort());
      })
      .catch(err => {
        // Silent fallback to avoid warning clutter
        setNigerianUnis(ALL_MASTER_UNIS);
      });
  }, [showEditModal]);

  const getCourseOptions = (selectedUniName: string) => {
    const name = (selectedUniName || '').toLowerCase();
    if (name.includes('technology') || name.includes('futo') || name.includes('futa') || name.includes('futm')) {
      return NIGERIAN_COURSES.tech;
    } else if (name.includes('health') || name.includes('medical')) {
      return NIGERIAN_COURSES.medical;
    } else if (name.includes('arts') || name.includes('humanities')) {
      return NIGERIAN_COURSES.humanities;
    }
    return NIGERIAN_COURSES.general;
  };

  const targetId = userId || auth.currentUser?.uid;
  const isMe = !userId || userId === auth.currentUser?.uid;

  // Custom Avatar Upload Ref
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Synchronise editable fields when profile documents update real-time
  useEffect(() => {
    if (profile) {
      setEditName(profile.displayName || '');
      setEditBio(profile.bio || '');
      setEditCampus(profile.campus || '');
      setEditCourse(profile.course || '');
      setEditYear(profile.year || '');
    }
  }, [profile]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !editName.trim()) return;

    try {
      // Update Firestore document first
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        displayName: editName.trim(),
        bio: editBio.trim(),
        campus: editCampus.trim(),
        course: editCourse.trim(),
        year: editYear.trim()
      });

      // Update Firebase Auth credential in real time
      await updateProfile(auth.currentUser, {
        displayName: editName.trim()
      });

      await logActivity("Updated their custom student profile details");
      setShowEditModal(false);
    } catch (err) {
      console.error("Failed to commit profile updates:", err);
    }
  };

  useEffect(() => {
    if (!auth.currentUser || !targetId) return;

    // Listen to all users in real-time
    const qStudentsList = query(collection(db, 'users'));
    const unsubStudents = onSnapshot(qStudentsList, (snap) => {
      const mapping: Record<string, any> = {};
      snap.docs.forEach(doc => {
        mapping[doc.id] = { uid: doc.id, ...doc.data() };
      });
      setAllStudentsMapped(mapping);
    });

    // Listen to profile info in real-time
    const unsubProfile = onSnapshot(doc(db, 'users', targetId), (snapshot) => {
      setProfile(snapshot.data() || null);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${targetId}`);
    });

    // Listen to followers count & docs in real-time
    const qFollowers = query(collection(db, 'follows'), where('followingId', '==', targetId));
    const unsubFollowers = onSnapshot(qFollowers, (snap) => {
      setFollowersCount(snap.size);
      if (auth.currentUser) {
        const followingMe = snap.docs.some(d => d.data().followerId === auth.currentUser?.uid);
        setIsFollowing(followingMe);
      }
      setFollowersList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'follows');
    });

    // Listen to following count & docs in real-time
    const qFollowing = query(collection(db, 'follows'), where('followerId', '==', targetId));
    const unsubFollowing = onSnapshot(qFollowing, (snap) => {
      setFollowingCount(snap.size);
      setFollowingList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'follows');
    });

    // Real-time posts by user
    const qPosts = query(collection(db, 'posts'), where('userId', '==', targetId));
    const unsubPosts = onSnapshot(qPosts, (snap) => {
      setUserPosts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'posts');
    });

    // Real-time market items by user
    const qMarket = query(collection(db, 'marketplace'), where('userId', '==', targetId));
    const unsubMarket = onSnapshot(qMarket, (snap) => {
      setUserMarketItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'marketplace');
    });

    return () => {
      unsubStudents();
      unsubProfile();
      unsubFollowers();
      unsubFollowing();
      unsubPosts();
      unsubMarket();
    };
  }, [targetId, auth.currentUser]);

  const handleFollowToggle = async () => {
    if (!auth.currentUser || !targetId) return;
    const followDocId = `${auth.currentUser.uid}_${targetId}`;
    const followRef = doc(db, 'follows', followDocId);

    try {
      if (isFollowing) {
        await deleteDoc(followRef);
        setIsFollowing(false);
      } else {
        await setDoc(followRef, {
          followerId: auth.currentUser.uid,
          followingId: targetId,
          createdAt: new Date()
        });
        setIsFollowing(true);
      }
    } catch (error) {
      console.error("Follow toggling failed:", error);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploading(true);
      try {
        const compressedBase64 = await compressImage(file, 256, 256, 0.7);
        if (!auth.currentUser) return;
        
        // Update /users/{uid} document
        await updateDoc(doc(db, 'users', auth.currentUser.uid), {
          avatarUrl: compressedBase64
        });
        
        // Update Firebase Auth identity photoURL if safe, otherwise use compliant initials placeholder
        const authPhotoUrl = compressedBase64.length < 2048 
          ? compressedBase64 
          : `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email || auth.currentUser.uid}`;
        
        await updateProfile(auth.currentUser, {
          photoURL: authPhotoUrl
        });

        // Update the local profile state immediately for crisp real-time rendering feedback
        setProfile((prev: any) => prev ? { ...prev, avatarUrl: compressedBase64 } : prev);
      } catch (error) {
        console.error("Avatar upload failed:", error);
      } finally {
        setIsUploading(false);
      }
    }
  };

  if (!profile) return (
    <div className="h-48 bg-white rounded-3xl animate-pulse" />
  );

  return (
    <div className="max-w-3xl mx-auto space-y-8 italic-none">
      {/* Header Card */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] overflow-hidden shadow-sm italic-none">
        <div className="h-40 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 relative overflow-hidden">
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '16px 16px' }} />
        </div>
        <div className="px-8 pb-8 relative">
          <div className="flex flex-col md:flex-row items-end gap-6 -mt-16">
            <div className="relative group shrink-0">
              <div className="relative w-32 h-32 rounded-[2rem] overflow-hidden border-4 border-white shadow-xl bg-white">
                <img
                  src={profile.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${profile.email}`}
                  className={cn(
                    "w-full h-full object-cover cursor-pointer hover:brightness-95 transition-all",
                    isUploading && "brightness-75 transition-all duration-300 pointer-events-none"
                  )}
                  onClick={() => isMe && !isUploading && avatarInputRef.current?.click()}
                  referrerPolicy="no-referrer"
                  alt=""
                />
                {isUploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]">
                    <Loader2 size={24} className="text-white animate-spin" />
                  </div>
                )}
              </div>
              {isMe && (
                <>
                  <input
                    type="file"
                    accept="image/*"
                    ref={avatarInputRef}
                    onChange={handleAvatarChange}
                    className="hidden"
                    disabled={isUploading}
                  />
                  <button 
                    onClick={() => !isUploading && avatarInputRef.current?.click()}
                    disabled={isUploading}
                    className={cn(
                      "absolute bottom-2 right-2 p-2 bg-slate-900 text-white rounded-xl shadow-lg hover:bg-slate-800 transition-all",
                      isUploading && "opacity-50 pointer-events-none"
                    )}
                    title="Upload Custom Profile Picture"
                  >
                    <Edit3 size={16} />
                  </button>
                </>
              )}
            </div>
            <div className="flex-1 italic-none">
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-3xl font-black italic-none">{profile.displayName}</h2>
                <VerificationBadge email={profile.email} verified={profile.verified} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500 font-bold font-mono uppercase tracking-widest italic-none">
                <span className="flex items-center gap-1.5"><MapPin size={14} className="text-slate-400" /> {profile.campus}</span>
                <span className="flex items-center gap-1.5"><GraduationCap size={14} className="text-slate-400" /> {profile.course || 'Technology'}</span>
                <span className="flex items-center gap-1.5"><Calendar size={14} className="text-slate-400" /> {profile.year || 'Student'}</span>
              </div>
            </div>
            <div className="flex gap-2 mb-2 italic-none shrink-0">
              {isMe ? (
                <div className="flex gap-2 items-center relative">
                  <button
                    onClick={() => setShowEditModal(true)}
                    className="px-5 py-2.5 bg-slate-900 text-white rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all text-xs shadow-md shadow-slate-100"
                  >
                    <Edit3 size={16} />
                    Edit Profile
                  </button>
                  
                  {/* Elegant Three-Dots Settings Menu */}
                  <div className="relative">
                    <button
                      onClick={() => setShowThreeDots(!showThreeDots)}
                      className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 rounded-2xl transition-all"
                      title="More options"
                    >
                      <MoreVertical size={16} />
                    </button>
                    <AnimatePresence>
                      {showThreeDots && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowThreeDots(false)} />
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50 overflow-hidden text-slate-800 dark:text-slate-250"
                          >
                            {/* Theme option */}
                            <button
                              onClick={() => {
                                toggleTheme();
                                setShowThreeDots(false);
                              }}
                              className="w-full px-4 py-3 flex items-center gap-2.5 text-left text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-850 transition-colors"
                            >
                              {isDarkMode ? (
                                <>
                                  <Sun size={15} className="text-amber-500 shrink-0" />
                                  <span>Light Theme</span>
                                </>
                              ) : (
                                <>
                                  <Moon size={15} className="text-indigo-500 shrink-0" />
                                  <span>Dark Theme</span>
                                </>
                              )}
                            </button>
                            
                            {/* Sign out options */}
                            <button
                              onClick={() => {
                                setShowSignOutConfirm(true);
                                setShowThreeDots(false);
                              }}
                              className="w-full px-4 py-3 flex items-center gap-2.5 text-left text-xs font-bold text-red-650 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors border-t border-slate-100 dark:border-slate-800"
                            >
                              <LogOut size={15} className="text-red-500 shrink-0" />
                              <span>Sign Out</span>
                            </button>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => {
                      const dmRoomId = [auth.currentUser?.uid, targetId].sort().join('_');
                      navigate('/chat');
                    }}
                    className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-200 transition-all text-xs"
                  >
                    <MessageCircle size={16} />
                    Chat
                  </button>
                  <button
                    onClick={handleFollowToggle}
                    className={cn(
                      "px-5 py-2.5 rounded-2xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95",
                      isFollowing
                        ? "bg-slate-900 text-white hover:bg-black shadow-slate-100"
                        : "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-100"
                    )}
                  >
                    {isFollowing ? (
                      <>
                        <UserMinus size={16} />
                        Connected
                      </>
                    ) : (
                      <>
                        <UserPlus size={16} />
                        Connect
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
          
          {/* Conditionally render bio strictly only if they added one! */}
          {profile.bio && (
            <div className="mt-8 italic-none border-l-2 border-slate-200 pl-4 py-1">
              <p className="text-slate-600 leading-relaxed max-w-2xl text-sm font-medium">
                {profile.bio}
              </p>
            </div>
          )}

          {/* Real-time Follows counters together with Posts counts */}
          <div className="flex gap-10 mt-8 pt-8 border-t border-slate-100">
            <button 
              onClick={() => setShowFollowersModal(true)}
              className="text-left hover:opacity-85 active:scale-95 transition-all text-slate-800"
              title="View Followers"
            >
              <p className="text-2xl font-black text-slate-900">{followersCount}</p>
              <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest leading-none mt-1">Connectors (Followers)</p>
            </button>

            <button 
              onClick={() => setShowFollowingModal(true)}
              className="text-left hover:opacity-85 active:scale-95 transition-all text-slate-800"
              title="View Following"
            >
              <p className="text-2xl font-black text-slate-900">{followingCount}</p>
              <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest leading-none mt-1">Connecting (Following)</p>
            </button>

            <div className="text-left">
              <p className="text-2xl font-black text-slate-900">{userPosts.length}</p>
              <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest leading-none mt-1">Corridor Posts</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border border-slate-200 rounded-3xl p-2 flex gap-2 italic shadow-sm">
        {[
          { id: 'posts', icon: Grid, label: 'Feed Posts' },
          { id: 'marketplace', icon: ShoppingBag, label: 'Market listings' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex-1 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all italic-none",
              activeTab === tab.id 
                ? "bg-slate-900 text-white shadow-lg shadow-slate-200" 
                : "text-slate-400 hover:bg-slate-50"
            )}
          >
            <tab.icon size={18} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab grids */}
      <div>
        {activeTab === 'posts' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {userPosts.length > 0 ? (
              userPosts.map((post) => (
                <motion.div
                  key={post.id}
                  whileHover={{ scale: 1.02 }}
                  className="aspect-square bg-slate-50 rounded-2xl overflow-hidden border border-slate-200 group relative shadow-sm cursor-pointer"
                  onClick={() => navigate('/feed')}
                >
                  {post.mediaUrl ? (
                    <img src={post.mediaUrl} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full p-6 text-[11px] text-slate-600 font-medium leading-relaxed overflow-hidden">
                      {post.content}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white gap-4 font-bold">
                    <span className="flex items-center gap-1">Likes: {post.likesCount || 0}</span>
                    <span className="flex items-center gap-1">Replies: {post.commentsCount || 0}</span>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="col-span-full py-16 text-center text-slate-450 bg-white border border-slate-200 rounded-3xl p-8 shadow-xs">
                <Grid size={40} className="mx-auto mb-3 opacity-20 text-slate-400" />
                <p className="font-bold text-slate-700 text-sm">No board posts published yet.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {userMarketItems.length > 0 ? (
              userMarketItems.map((item) => (
                <motion.div
                  key={item.id}
                  whileHover={{ scale: 1.02 }}
                  onClick={() => navigate('/marketplace')}
                  className="bg-white border border-slate-200 p-4 rounded-3xl shadow-sm hover:shadow-md transition-all cursor-pointer"
                >
                  <div className="aspect-square bg-slate-50 rounded-2xl overflow-hidden border border-slate-100 mb-3">
                    <img src={item.image || item.images?.[0] || 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=500'} className="w-full h-full object-cover" alt="" />
                  </div>
                  <h4 className="font-bold text-slate-800 text-xs truncate">{item.title}</h4>
                  <p className="text-blue-600 font-black text-xs mt-1">₦{Number(item.price).toLocaleString()}</p>
                </motion.div>
              ))
            ) : (
              <div className="col-span-full py-16 text-center text-slate-450 bg-white border border-slate-200 rounded-3xl p-8 shadow-xs">
                <ShoppingBag size={40} className="mx-auto mb-3 opacity-20 text-slate-400" />
                <p className="font-bold text-slate-700 text-sm">No marketplace items listed yet.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Profile Modal */}
      <AnimatePresence>
        {showEditModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEditModal(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white max-w-md w-full rounded-[2rem] border border-slate-200 p-6 shadow-2xl relative z-10 text-slate-800"
            >
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
                <span className="text-sm font-black italic-none uppercase tracking-wider flex items-center gap-1.5 text-slate-900">
                  <Edit3 size={16} className="text-blue-600" /> Customize Student Badge
                </span>
                <button 
                  onClick={() => setShowEditModal(false)}
                  className="p-1 hover:bg-slate-100 rounded-full transition-all"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-4 text-left">
                <div>
                  <label className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest block mb-1">Display Name</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="e.g. Gabriel Nwanwuba"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest block mb-1">Bio Description</label>
                  <textarea
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    placeholder="Tell other students about you (leave empty to show nothing)"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-medium leading-relaxed resize-none h-20"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 relative z-[130]">
                  {/* Campus / University Selector */}
                  <div className="relative">
                    <label className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest block mb-1">Campus / School</label>
                    <input
                      type="text"
                      value={uniSearch}
                      onFocus={() => {
                        setShowUniDropdown(true);
                        setShowCourseDropdown(false);
                      }}
                      onChange={(e) => {
                        setUniSearch(e.target.value);
                        setEditCampus(e.target.value);
                        setShowUniDropdown(true);
                      }}
                      placeholder="University of Lagos, etc."
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-semibold"
                    />
                    <AnimatePresence>
                      {showUniDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowUniDropdown(false)} />
                          <motion.div
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 5 }}
                            className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-20 p-1 divide-y divide-slate-50"
                          >
                            {nigerianUnis
                              .filter(uni => uni.toLowerCase().includes(uniSearch.toLowerCase()))
                              .map((uni, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => {
                                    setUniSearch(uni);
                                    setEditCampus(uni);
                                    setShowUniDropdown(false);
                                  }}
                                  className="w-full px-3 py-2 hover:bg-slate-50 text-[11px] text-left font-bold text-slate-700 transition-colors"
                                >
                                  {uni}
                                </button>
                              ))}
                            {nigerianUnis.filter(uni => uni.toLowerCase().includes(uniSearch.toLowerCase())).length === 0 && (
                              <p className="p-3 text-[10px] text-slate-450 italic text-center">No universities found</p>
                            )}
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Course of Study Selector */}
                  <div className="relative">
                    <label className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest block mb-1">Course of Study</label>
                    <input
                      type="text"
                      disabled={!editCampus}
                      value={courseSearch}
                      onFocus={() => {
                        setShowCourseDropdown(true);
                        setShowUniDropdown(false);
                      }}
                      onChange={(e) => {
                        setCourseSearch(e.target.value);
                        setEditCourse(e.target.value);
                        setShowCourseDropdown(true);
                      }}
                      placeholder={editCampus ? "Pick course..." : "Select university first"}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-semibold disabled:opacity-50"
                    />
                    <AnimatePresence>
                      {showCourseDropdown && editCampus && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowCourseDropdown(false)} />
                          <motion.div
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 5 }}
                            className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-20 p-1 divide-y divide-slate-50"
                          >
                            {getCourseOptions(editCampus)
                              .filter(c => c.toLowerCase().includes(courseSearch.toLowerCase()))
                              .map((c, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => {
                                    setCourseSearch(c);
                                    setEditCourse(c);
                                    setShowCourseDropdown(false);
                                  }}
                                  className="w-full px-3 py-2 hover:bg-slate-50 text-[11px] text-left font-bold text-slate-700 transition-colors"
                                >
                                  {c}
                                </button>
                              ))}
                            {getCourseOptions(editCampus).filter(c => c.toLowerCase().includes(courseSearch.toLowerCase())).length === 0 && (
                              <p className="p-3 text-[10px] text-slate-450 italic text-center">No course found</p>
                            )}
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest block mb-1">Academic Year</label>
                  <select
                    value={editYear}
                    onChange={(e) => setEditYear(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-semibold appearance-none"
                  >
                    <option value="">Select Level...</option>
                    <option value="100 Level">100 Level</option>
                    <option value="200 Level">200 Level</option>
                    <option value="300 Level">300 Level</option>
                    <option value="400 Level">400 Level</option>
                    <option value="500 Level">500 Level</option>
                    <option value="Postgraduate">Postgraduate</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-bold text-xs uppercase hover:bg-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!editName.trim()}
                    className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-bold text-xs uppercase hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-100"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sign Out Confirmation Modal */}
      <AnimatePresence>
        {showSignOutConfirm && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSignOutConfirm(false)}
              className="absolute inset-0 bg-slate-950/65 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl max-w-sm w-full shadow-2xl relative z-10 text-center text-slate-800 dark:text-white"
            >
              <div className="w-12 h-12 bg-red-50 dark:bg-red-950/20 text-red-655 dark:text-red-400 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-red-105 dark:border-red-900/40">
                <LogOut size={22} className="text-red-600" />
              </div>
              <h3 className="text-lg font-black tracking-tight">Confirm Sign Out</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-2 max-w-xs mx-auto">
                Are you absolutely positive you want to log out of your student account? You will need to sign back in to access the campus network corridors.
              </p>
              
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowSignOutConfirm(false)}
                  className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-750 dark:text-slate-300 rounded-2xl font-bold text-xs uppercase tracking-wider transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (auth.currentUser) {
                      try {
                        await setDoc(doc(db, 'users', auth.currentUser.uid), { online: false }, { merge: true });
                      } catch (err) {
                        console.error("Failed to mark offline in Profile logout:", err);
                      }
                    }
                    auth.signOut();
                    setShowSignOutConfirm(false);
                    navigate('/');
                  }}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-red-100 dark:shadow-none"
                >
                  Yes, Sign Out
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detailed Followers Modal */}
      <AnimatePresence>
        {showFollowersModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFollowersModal(false)}
              className="absolute inset-0 bg-slate-950/65 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl relative z-10 text-slate-800 dark:text-white flex flex-col max-h-[80vh]"
            >
              <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="text-left">
                  <h3 className="text-lg font-black tracking-tight">Connectors</h3>
                  <p className="text-xs text-slate-400">Students following this account</p>
                </div>
                <button 
                  onClick={() => setShowFollowersModal(false)}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-1">
                {followersList.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-xs">
                    No followers yet. Share your study corridor to connect!
                  </div>
                ) : (
                  followersList.map(follow => {
                    const student = allStudentsMapped[follow.followerId] || {
                      displayName: 'Campus Student',
                      email: 'unresolved@student',
                      campus: 'CAMPUS',
                      avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${follow.followerId}`
                    };
                    const isUploaderMe = follow.followerId === auth.currentUser?.uid;

                    return (
                      <div key={follow.id} className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800/60 hover:bg-white dark:hover:bg-slate-900 transition-all">
                        <div className="flex items-center gap-3">
                          <img 
                            src={student.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${student.email}`} 
                            className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-800" 
                            alt="Student" 
                          />
                          <div className="text-left">
                            <div className="flex items-center gap-1">
                              <h4 className="text-xs font-bold leading-tight">{student.displayName || student.email?.split('@')[0]}</h4>
                              <VerificationBadge verified={student.verified || false} size={15} />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">{student.campus || 'CAMPUS'} • {student.course || 'Undergrad'}</p>
                          </div>
                        </div>

                        <div className="flex gap-1.5">
                          {!isUploaderMe && (
                            <button
                              onClick={() => {
                                setShowFollowersModal(false);
                                navigate(`/chat?userId=${follow.followerId}`);
                              }}
                              className="px-2.5 py-1 text-[10px] font-black uppercase text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg border border-blue-200 transition-all"
                            >
                              Chat
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detailed Following Modal */}
      <AnimatePresence>
        {showFollowingModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFollowingModal(false)}
              className="absolute inset-0 bg-slate-950/65 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl relative z-10 text-slate-800 dark:text-white flex flex-col max-h-[80vh]"
            >
              <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="text-left">
                  <h3 className="text-lg font-black tracking-tight">Connecting</h3>
                  <p className="text-xs text-slate-400">Students this account supports</p>
                </div>
                <button 
                  onClick={() => setShowFollowingModal(false)}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-1">
                {followingList.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-xs">
                    Not following anyone yet. Connect with classmates in corridors!
                  </div>
                ) : (
                  followingList.map(follow => {
                    const student = allStudentsMapped[follow.followingId] || {
                      displayName: 'Campus Student',
                      email: 'unresolved@student',
                      campus: 'CAMPUS',
                      avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${follow.followingId}`
                    };
                    const isOwnerMe = targetId === auth.currentUser?.uid;

                    return (
                      <div key={follow.id} className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800/60 hover:bg-white dark:hover:bg-slate-900 transition-all">
                        <div className="flex items-center gap-3">
                          <img 
                            src={student.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${student.email}`} 
                            className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-800" 
                            alt="Student" 
                          />
                          <div className="text-left">
                            <div className="flex items-center gap-1">
                              <h4 className="text-xs font-bold leading-tight">{student.displayName || student.email?.split('@')[0]}</h4>
                              <VerificationBadge verified={student.verified || false} size={15} />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">{student.campus || 'CAMPUS'} • {student.course || 'Undergrad'}</p>
                          </div>
                        </div>

                        <div className="flex gap-1.5">
                          {isOwnerMe && (
                            <button
                              onClick={async () => {
                                try {
                                  await deleteDoc(doc(db, 'follows', follow.id));
                                } catch (err) {
                                  console.error("Failed to unfollow support:", err);
                                }
                              }}
                              className="px-2.5 py-1 text-[10px] font-black uppercase text-red-650 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg border border-red-200 transition-all"
                              title="Stop supporting this user"
                            >
                              Unfollow
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setShowFollowingModal(false);
                              navigate(`/chat?userId=${follow.followingId}`);
                            }}
                            className="px-2.5 py-1 text-[10px] font-black uppercase text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg border border-blue-200 transition-all"
                          >
                            Chat
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
