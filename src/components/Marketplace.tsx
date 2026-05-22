import { useState, useEffect, useRef } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, Search, Plus, MapPin, MessageCircle, X, Image as ImageIcon } from 'lucide-react';
import { encryptText } from '../lib/crypto';

export default function Marketplace() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItem, setNewItem] = useState({ title: '', price: '', category: 'General', description: '' });
  const [loading, setLoading] = useState(true);
  
  // Custom listed photo
  const [listedImageBase64, setListedImageBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter and search keys
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchText, setSearchText] = useState('');

  // User details
  const [userProfile, setUserProfile] = useState<any>(null);

  useEffect(() => {
    if (!auth.currentUser) return;

    getDoc(doc(db, 'users', auth.currentUser.uid)).then((snap) => {
      setUserProfile(snap.data() || null);
    });

    const path = 'marketplace';
    const q = query(collection(db, path), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setItems(docs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return unsubscribe;
  }, [auth.currentUser]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setListedImageBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleListItem = async () => {
    if (!auth.currentUser || !newItem.title || !newItem.price) return;
    
    try {
      const campusCode = userProfile?.campus || 'CAMPUS';
      const defaultImg = "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=500";
      
      await addDoc(collection(db, 'marketplace'), {
        userId: auth.currentUser.uid,
        userName: userProfile?.displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0],
        userAvatar: userProfile?.avatarUrl || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
        title: newItem.title,
        price: parseFloat(newItem.price),
        category: newItem.category,
        description: newItem.description,
        campus: campusCode,
        status: 'active',
        images: [listedImageBase64 || defaultImg],
        createdAt: serverTimestamp()
      });
      setShowAddModal(false);
      setNewItem({ title: '', price: '', category: 'General', description: '' });
      setListedImageBase64(null);
    } catch (error) {
      console.error("List item failed:", error);
    }
  };

  const handleMessageSeller = async (item: any) => {
    if (!auth.currentUser) return;
    if (item.userId === auth.currentUser.uid) return; // Can't chat yourself

    // Navigate to DM chat room
    const dmRoomId = [auth.currentUser.uid, item.userId].sort().join('_');
    const greetingMsg = `Hey, I'm interested in your listed item: "${item.title}" (₦${Number(item.price).toLocaleString()}). Is it still available?`;
    const encryptedText = encryptText(greetingMsg, dmRoomId);
    
    try {
      // Setup a fast greeting text message inside the chat (encrypted!)
      await addDoc(collection(db, 'chats', dmRoomId, 'messages'), {
        chatId: dmRoomId,
        senderId: auth.currentUser.uid,
        senderName: userProfile?.displayName || auth.currentUser.displayName || 'Buyer',
        senderAvatar: userProfile?.avatarUrl || auth.currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${auth.currentUser.email}`,
        text: encryptedText,
        isEncrypted: true,
        seen: false,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to post automated greeting:", err);
    }

    // Direct navigate to message screen
    navigate('/chat');
  };

  // Filter list based on selected category & search keywords
  const filteredItems = items.filter(itm => {
    const matchesCat = activeCategory === 'All' || itm.category === activeCategory;
    const matchesSearch = (itm.title || '').toLowerCase().includes(searchText.toLowerCase()) || 
                          (itm.description || '').toLowerCase().includes(searchText.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-6 italic-none">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black italic-none leading-tight">Marketplace</h1>
          <p className="text-slate-500 text-sm">Buy & sell premium products safely with fellow verified students.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95 text-xs uppercase tracking-wider shrink-0"
        >
          <Plus size={16} />
          List Something
        </button>
      </div>

      {/* Global Search Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-3.5 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search products, books, rooms..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {['All', 'Electronics', 'Books', 'Tickets', 'Fashion', 'Accommodation', 'General'].map((cat) => (
          <button 
            key={cat} 
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 border rounded-full text-xs font-bold whitespace-nowrap transition-all ${
              activeCategory === cat 
                ? 'bg-slate-900 border-slate-900 text-white shadow-md shadow-slate-100' 
                : 'bg-white border-slate-250 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
        {loading ? (
          Array(6).fill(0).map((_, i) => (
            <div key={i} className="aspect-[4/5] bg-white border border-slate-200 rounded-3xl animate-pulse" />
          ))
        ) : filteredItems.length === 0 ? (
          <div className="col-span-full py-16 text-center bg-white border border-slate-200 rounded-[2rem] p-8">
            <ShoppingBag size={48} className="mx-auto text-slate-300 mb-4 stroke-1 animate-pulse" />
            <h3 className="text-lg font-bold text-slate-800 mb-1">No Listings Found</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              No live student products match your selection yet. list something to see it here!
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {filteredItems.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 30, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                whileHover={{ y: -6, scale: 1.015, boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.05), 0 8px 10px -6px rgb(0 0 0 / 0.05)" }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                tabIndex={0}
                className="bg-white border border-slate-200 rounded-3xl overflow-hidden group hover:border-slate-300 transition-colors flex flex-col justify-between"
              >
                <div className="relative aspect-square overflow-hidden bg-slate-50 border-b border-slate-100">
                  <img src={item.images?.[0] || 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=500'} className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-500" referrerPolicy="no-referrer" alt={item.title} />
                  <div className="absolute bottom-3 left-3 px-3 py-1 bg-slate-950 text-white rounded-xl text-xs font-black shadow-md border border-slate-800">
                    ₦{Number(item.price).toLocaleString()}
                  </div>
                </div>
                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">{item.category}</span>
                    <h3 className="font-bold text-slate-800 leading-tight truncate mt-0.5" title={item.title}>{item.title}</h3>
                    <p className="text-[11px] text-slate-400 line-clamp-2 mt-1 min-h-[32px]">{item.description || 'No description provided.'}</p>
                    <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mt-2 pb-3">
                      <MapPin size={10} />
                      <span className="truncate">{item.campus} ({item.userName || 'Student'})</span>
                    </div>
                  </div>
                  {item.userId !== auth.currentUser?.uid ? (
                    <button 
                      onClick={() => handleMessageSeller(item)}
                      className="w-full py-2.5 bg-slate-50 text-slate-600 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-blue-600 hover:text-white hover:scale-102 transition-all active:scale-95 shadow-xs border border-slate-100"
                    >
                      <MessageCircle size={14} />
                      Message Seller
                    </button>
                  ) : (
                    <div className="w-full text-center py-2 bg-green-50 text-green-700 text-[10px] font-extrabold uppercase border border-green-100 rounded-xl">
                      My Product
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Add Item Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white w-full max-w-lg rounded-[2rem] overflow-hidden shadow-2xl relative z-10 border border-slate-200"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-lg font-black italic-none">List an Item on Campus</h2>
                <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 font-extrabold text-xl">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {/* Image Selection Area */}
                <div>
                  <label className="text-xs font-extrabold text-slate-400 uppercase mb-2 block">Item Snap / Photo</label>
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-200 rounded-2xl h-36 flex flex-col items-center justify-center bg-slate-50 cursor-pointer overflow-hidden relative group hover:border-blue-400 transition-all"
                  >
                    {listedImageBase64 ? (
                      <img src={listedImageBase64} className="w-full h-full object-cover" alt="Chosen upload" />
                    ) : (
                      <>
                        <ImageIcon className="text-slate-400 mb-2 group-hover:text-blue-500 transition-colors" size={28} />
                        <span className="text-xs text-slate-400 font-bold group-hover:text-blue-505">Tap to choose product photo</span>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-extrabold text-slate-400 uppercase mb-2 block">Item Name</label>
                  <input
                    type="text"
                    value={newItem.title}
                    onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                    placeholder="e.g. MacBook Air M1"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-250 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-xs font-semibold"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-extrabold text-slate-400 uppercase mb-2 block">Price (₦)</label>
                    <input
                      type="number"
                      value={newItem.price}
                      onChange={(e) => setNewItem({ ...newItem, price: e.target.value })}
                      placeholder="500,000"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-250 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-extrabold text-slate-400 uppercase mb-2 block">Category</label>
                    <select
                      value={newItem.category}
                      onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-250 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 appearance-none text-xs font-semibold text-slate-800"
                    >
                      {['General', 'Electronics', 'Books', 'Tickets', 'Fashion', 'Accommodation'].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-extrabold text-slate-400 uppercase mb-2 block">Description</label>
                  <textarea
                    value={newItem.description}
                    onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                    placeholder="Tell us about the item's condition..."
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-250 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 min-h-[90px] text-xs font-semibold resize-none"
                  />
                </div>
                <button
                  onClick={handleListItem}
                  disabled={!newItem.title || !newItem.price}
                  className={`w-full py-4 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all mt-4 ${
                    newItem.title && newItem.price 
                      ? 'bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-100' 
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  List Item Securely
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
