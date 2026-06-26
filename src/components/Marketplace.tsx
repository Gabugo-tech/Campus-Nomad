import { useState, useEffect, useRef } from 'react';
import { db, auth, handleFirestoreError, OperationType, onSnapshot } from '../lib/firebase';
import { collection, query, orderBy, addDoc, serverTimestamp, doc, getDoc, deleteDoc, updateDoc, increment } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, Search, Plus, MapPin, MessageCircle, X, Image as ImageIcon, Trash2, Loader2, Eye, CheckCircle2, Tag, Zap } from 'lucide-react';
import { encryptText } from '../lib/crypto';

export default function Marketplace() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItem, setNewItem] = useState({ title: '', price: '', category: 'General', description: '' });
  const [loading, setLoading] = useState(true);
  
  // View mode switcher: 'all' to browse everything, 'mine' to view only user's own listings
  const [viewMode, setViewMode] = useState<'all' | 'mine'>('all');
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  
  // Custom listed photo
  const [listedImageBase64, setListedImageBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter and search keys
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchText, setSearchText] = useState('');

  const [isLiteMode, setIsLiteMode] = useState(localStorage.getItem('campus_connect_lite_mode') === 'true');

  useEffect(() => {
    const handleLiteModeChange = (e: any) => {
      setIsLiteMode(e.detail);
    };
    window.addEventListener('campus-connect-lite-mode-change', handleLiteModeChange);
    return () => window.removeEventListener('campus-connect-lite-mode-change', handleLiteModeChange);
  }, []);

  // User details
  const [userProfile, setUserProfile] = useState<any>(null);

  useEffect(() => {
    if (!auth.currentUser) return;

    getDoc(doc(db, 'users', auth.currentUser.uid)).then((snap) => {
      setUserProfile(snap.data() || null);
    });

    const path = 'marketplace';
    // Querying without orderBy on serverTimestamp prevents newly added items with a null/pending server timestamp from being filtered out.
    // We sort the results descending by createdAt on the client-side below.
    const q = query(collection(db, path));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => {
        const data = doc.data();
        let dateVal = new Date();
        if (data.createdAt) {
          if (typeof data.createdAt.toDate === 'function') {
            dateVal = data.createdAt.toDate();
          } else if (typeof data.createdAt === 'string') {
            dateVal = new Date(data.createdAt);
          } else if (data.createdAt instanceof Date) {
            dateVal = data.createdAt;
          }
        }
        return {
          id: doc.id,
          ...data,
          createdAt: dateVal
        };
      });

      // Sort in-memory descending by createdAt to support latency compensated real-time listing updates instantly
      docs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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

  const handleDeleteItem = async (itemId: string): Promise<boolean> => {
    if (!window.confirm("Are you sure you want to delete this listing? This action is irreversible.")) return false;
    setDeletingItemId(itemId);
    const path = `marketplace/${itemId}`;
    try {
      await deleteDoc(doc(db, 'marketplace', itemId));
      alert("Product listing deleted successfully!");
      return true;
    } catch (err: any) {
      console.error("Failed to delete marketplace item:", err);
      alert("Failed to delete listing: " + (err.message || err));
      try {
        handleFirestoreError(err, OperationType.DELETE, path);
      } catch (f) {
        // Suppress secondary throw to avoid breaking React lifecycle
      }
      return false;
    } finally {
      setDeletingItemId(null);
    }
  };

  const handleToggleSoldStatus = async (item: any) => {
    const newStatus = item.status === 'sold' ? 'active' : 'sold';
    setUpdatingItemId(item.id);
    const path = `marketplace/${item.id}`;
    try {
      await updateDoc(doc(db, 'marketplace', item.id), {
        status: newStatus
      });
      // Synchronize in-memory selectedItem state if it matches the item being toggled
      if (selectedItem && selectedItem.id === item.id) {
        setSelectedItem((prev: any) => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (err: any) {
      console.error("Failed to update marketplace status:", err);
      alert("Failed to update listing status: " + (err.message || err));
      try {
        handleFirestoreError(err, OperationType.UPDATE, path);
      } catch (f) {
        // Suppress secondary throw
      }
    } finally {
      setUpdatingItemId(null);
    }
  };

  const handleOpenDetail = async (item: any) => {
    setSelectedItem(item);
    
    // Increment view count in Firebase
    try {
      const itemRef = doc(db, 'marketplace', item.id);
      await updateDoc(itemRef, {
        views: increment(1)
      });
    } catch (err) {
      console.error("Failed to increment view count:", err);
    }
  };

  const handleListItem = async () => {
    if (!auth.currentUser || !newItem.title || !newItem.price) return;
    
    const path = 'marketplace';
    try {
      const campusCode = userProfile?.campus || 'CAMPUS';
      const defaultImg = "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=500";
      
      await addDoc(collection(db, path), {
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
        views: 0,
        createdAt: serverTimestamp()
      });

      setShowAddModal(false);
      setNewItem({ title: '', price: '', category: 'General', description: '' });
      setListedImageBase64(null);
    } catch (error: any) {
      console.error("List item failed:", error);
      handleFirestoreError(error, OperationType.CREATE, path);
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

  // Filter list based on selected view mode ('all' vs 'mine'), category & search keywords
  const filteredItems = items.filter(itm => {
    const matchesView = viewMode === 'all' || itm.userId === auth.currentUser?.uid;
    const matchesCat = activeCategory === 'All' || itm.category === activeCategory;
    const matchesSearch = (itm.title || '').toLowerCase().includes(searchText.toLowerCase()) || 
                          (itm.description || '').toLowerCase().includes(searchText.toLowerCase());
    return matchesView && matchesCat && matchesSearch;
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

      {/* Segmented View Control to toggle All vs My Uploaded Items */}
      <div className="flex border-b border-slate-150 pb-0.5 gap-6">
        <button
          onClick={() => setViewMode('all')}
          className={`pb-2.5 font-medium text-xs uppercase tracking-wider border-b-2 transition-all relative ${
            viewMode === 'all'
              ? 'text-blue-600 border-blue-600 font-bold'
              : 'text-slate-400 border-transparent hover:text-slate-600'
          }`}
        >
          Browse Market
        </button>
        <button
          onClick={() => setViewMode('mine')}
          className={`pb-2.5 font-medium text-xs uppercase tracking-wider border-b-2 transition-all relative flex items-center gap-1.5 ${
            viewMode === 'mine'
              ? 'text-blue-600 border-blue-600 font-bold'
              : 'text-slate-400 border-transparent hover:text-slate-600'
          }`}
        >
          My Listed items
          {items.filter(itm => itm.userId === auth.currentUser?.uid).length > 0 && (
            <span className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full text-[10px] font-black leading-none animate-pulse">
              {items.filter(itm => itm.userId === auth.currentUser?.uid).length}
            </span>
          )}
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
            <div key={i} className="bg-white border border-slate-250 rounded-3xl overflow-hidden flex flex-col justify-between animate-pulse">
              {/* Product preview image bone */}
              <div className="relative aspect-square bg-slate-100">
                {/* Views count badge bones */}
                <div className="absolute top-3 right-3 w-10 h-5 bg-white/60 rounded-xl" />
                {/* Price tag bone */}
                <div className="absolute bottom-3 left-3 w-16 h-6 bg-slate-200 rounded-xl" />
              </div>
              
              {/* Text info and CTA bones */}
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div className="space-y-2">
                  {/* Category tag */}
                  <div className="w-1/3 h-2.5 bg-slate-200 rounded-md" />
                  {/* Listing Title */}
                  <div className="w-3/4 h-3.5 bg-slate-200 rounded-md" />
                  {/* Snippet Description */}
                  <div className="space-y-1.5">
                    <div className="w-full h-2.5 bg-slate-150 rounded-md" />
                    <div className="w-[85%] h-2.5 bg-slate-100 rounded-md" />
                  </div>
                  {/* Location badge skeleton */}
                  <div className="w-1/2 h-3 bg-slate-100 rounded-md mt-2" />
                </div>
                
                {/* Action CTA bone */}
                <div className="w-full h-9 bg-slate-100 rounded-xl" />
              </div>
            </div>
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
                onClick={() => handleOpenDetail(item)}
                className="bg-white border border-slate-200 rounded-3xl overflow-hidden group hover:border-slate-300 transition-colors flex flex-col justify-between cursor-pointer"
              >
                <div className="relative aspect-square overflow-hidden bg-slate-50 border-b border-slate-100">
                  <MarketplaceImageLoader 
                    url={item.images?.[0] || 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=500'} 
                    title={item.title} 
                    isLiteMode={isLiteMode} 
                  />
                  
                  {item.status === 'sold' && (
                    <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] flex items-center justify-center z-10">
                      <span className="px-3 py-1.5 bg-red-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl border border-red-500 transform rotate-[-3deg]">
                        Sold Out
                      </span>
                    </div>
                  )}

                  {/* Views count badge */}
                  <div className="absolute top-3 right-3 px-2 py-0.5 bg-white/95 backdrop-blur-xs text-slate-700 rounded-xl text-[10px] font-black flex items-center gap-1 shadow-sm border border-slate-100 z-10">
                    <Eye size={12} className="text-slate-500" />
                    <span>{item.views || 0}</span>
                  </div>

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
                    item.status === 'sold' ? (
                      <button 
                        disabled
                        className="w-full py-2.5 bg-slate-100 text-slate-400 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-200 cursor-not-allowed opacity-75"
                      >
                        Unavailable (Sold)
                      </button>
                    ) : (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleMessageSeller(item); }}
                        className="w-full py-2.5 bg-slate-50 text-slate-600 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-blue-600 hover:text-white hover:scale-102 transition-all active:scale-95 shadow-xs border border-slate-100"
                      >
                        <MessageCircle size={14} />
                        Message Seller
                      </button>
                    )
                  ) : (
                    <div className="flex flex-col gap-1.5 w-full">
                      <div className="flex items-center gap-1.5 w-full">
                        <div className={`flex-1 text-center py-1.5 text-[9px] font-extrabold uppercase border rounded-xl ${
                          item.status === 'sold'
                            ? 'bg-red-50 text-red-700 border-red-100'
                            : 'bg-green-50 text-green-700 border-green-100'
                        }`}>
                          {item.status === 'sold' ? 'Sold Out' : 'Active'}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleSoldStatus(item); }}
                          disabled={updatingItemId === item.id}
                          className="px-3 py-1.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50 shrink-0"
                          title={item.status === 'sold' ? "Mark as Active" : "Mark as Sold"}
                        >
                          {updatingItemId === item.id ? (
                            <Loader2 size={10} className="animate-spin text-slate-500" />
                          ) : item.status === 'sold' ? (
                            <>
                              <Tag size={10} className="text-amber-500 fill-amber-500" />
                              Active
                            </>
                          ) : (
                            <>
                              <CheckCircle2 size={10} className="text-emerald-500" />
                              Sold
                            </>
                          )}
                        </button>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id); }}
                        disabled={deletingItemId === item.id}
                        className="w-full py-2 mt-1.5 bg-red-50 hover:bg-red-600 hover:text-white text-red-600 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border border-red-100 cursor-pointer text-center flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {deletingItemId === item.id ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            Deleting...
                          </>
                        ) : (
                          <>
                            <Trash2 size={11} />
                            Delete Listing
                          </>
                        )}
                      </button>
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

      {/* Product Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItem(null)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white w-full max-w-lg rounded-[2.2rem] overflow-hidden shadow-2xl relative z-10 border border-slate-200"
            >
              <div className="relative h-64 bg-slate-50 border-b border-slate-100">
                <MarketplaceImageLoader 
                  url={selectedItem.images?.[0] || 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=500'} 
                  title={selectedItem.title} 
                  isLiteMode={isLiteMode} 
                />
                {selectedItem.status === 'sold' && (
                  <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] flex items-center justify-center z-10">
                    <span className="px-5 py-2.5 bg-red-600 text-white font-black text-sm uppercase tracking-widest rounded-2xl shadow-xl border border-red-500 transform rotate-[-3deg]">
                      Sold Out
                    </span>
                  </div>
                )}
                <button 
                  onClick={() => setSelectedItem(null)} 
                  className="absolute top-4 right-4 bg-slate-950/80 hover:bg-slate-950 text-white rounded-full p-2.5 shadow-md transition-all active:scale-90"
                >
                  <X size={16} />
                </button>
                
                <div className="absolute bottom-4 left-4 px-4 py-1.5 bg-blue-600 text-white rounded-2xl text-sm font-black shadow-lg border border-blue-500">
                  ₦{Number(selectedItem.price).toLocaleString()}
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{selectedItem.category}</span>
                    <h2 className="text-xl font-black text-slate-800 leading-tight mt-0.5">{selectedItem.title}</h2>
                  </div>
                  
                  {/* Dedicated Views Badge inside details */}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-xl text-xs font-bold shrink-0">
                    <Eye size={14} />
                    <span>{selectedItem.views || 0} views</span>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl space-y-3 border border-slate-100">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Student Seller Info</span>
                  <div className="flex items-center gap-3">
                    <img 
                      src={selectedItem.userAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${selectedItem.userName}`} 
                      className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-xs" 
                      alt={selectedItem.userName} 
                    />
                    <div>
                      <h4 className="text-xs font-black text-slate-800">{selectedItem.userName || 'Student'}</h4>
                      <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                        <MapPin size={10} />
                        {selectedItem.campus} Campus
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1">Product Description</span>
                  <p className="text-slate-600 text-xs leading-relaxed max-h-32 overflow-y-auto pr-1">
                    {selectedItem.description || 'No description provided.'}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-100 flex flex-col gap-2.5">
                  <div className="flex gap-3">
                    <button
                      onClick={() => setSelectedItem(null)}
                      className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-wider transition-all"
                    >
                      Go Back
                    </button>
                    
                    {selectedItem.userId !== auth.currentUser?.uid ? (
                      selectedItem.status === 'sold' ? (
                        <button
                          disabled
                          className="flex-[2] py-3 bg-slate-100 text-slate-400 rounded-2xl text-xs font-black uppercase tracking-wider transition-all border border-slate-200 cursor-not-allowed opacity-75"
                        >
                          Sold Out
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setSelectedItem(null);
                            handleMessageSeller(selectedItem);
                          }}
                          className="flex-[2] py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-blue-200 flex items-center justify-center gap-2"
                        >
                          <MessageCircle size={15} />
                          Message Seller
                        </button>
                      )
                    ) : (
                      <button
                        onClick={async () => {
                          await handleToggleSoldStatus(selectedItem);
                        }}
                        disabled={updatingItemId === selectedItem.id}
                        className={`flex-[2] py-3 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                          selectedItem.status === 'sold'
                            ? 'bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-100'
                            : 'bg-amber-500 hover:bg-amber-600 shadow-xl shadow-amber-100'
                        }`}
                      >
                        {updatingItemId === selectedItem.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : selectedItem.status === 'sold' ? (
                          <>
                            <Tag size={14} />
                            Mark Active
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={14} />
                            Mark Sold Out
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {selectedItem.userId === auth.currentUser?.uid && (
                    <button
                      onClick={async () => {
                        const targetId = selectedItem.id;
                        const deleted = await handleDeleteItem(targetId);
                        if (deleted) {
                          setSelectedItem(null);
                        }
                      }}
                      disabled={deletingItemId === selectedItem.id}
                      className="w-full py-2.5 bg-red-50 hover:bg-red-600 hover:text-white text-red-600 hover:border-red-600 rounded-2xl text-xs font-black uppercase tracking-wider transition-all border border-red-100 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {deletingItemId === selectedItem.id ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 size={14} />
                          Delete Listing Permanently
                        </>
                      )}
                    </button>
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

// Low bandwidth optimized image loader for Marketplace items
function MarketplaceImageLoader({ url, title, isLiteMode }: { url: string; title: string; isLiteMode: boolean }) {
  const [reveal, setReveal] = useState(!isLiteMode);

  useEffect(() => {
    if (!isLiteMode) {
      setReveal(true);
    }
  }, [isLiteMode]);

  if (!reveal) {
    return (
      <div className="w-full h-full bg-slate-50 border-b border-slate-100 flex flex-col items-center justify-center p-4 text-center select-none gap-2">
        <Zap size={22} className="text-amber-500 fill-amber-500" />
        <span className="text-[10px] font-black uppercase text-amber-800 tracking-wider">Image Saved</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setReveal(true);
          }}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-xs cursor-pointer"
        >
          View Photo
        </button>
      </div>
    );
  }

  return (
    <img 
      src={url} 
      className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-500" 
      referrerPolicy="no-referrer" 
      alt={title} 
      loading="lazy"
    />
  );
}
