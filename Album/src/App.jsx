import React, { useState, useRef, useEffect } from 'react';
import { Camera, Heart, Image as ImageIcon, X, Download, Trash2, Video, User, ShieldCheck, Package } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// 1. 你的專屬 Firebase 雲端服務金鑰
const firebaseConfig = {
  apiKey: "AIzaSyBbMk_TfGKaPwUmkylD1gYdl-BX1vEb6z0",
  authDomain: "stanmaggieday.firebaseapp.com",
  projectId: "stanmaggieday",
  storageBucket: "stanmaggieday.firebasestorage.app",
  messagingSenderId: "834273374884",
  appId: "1:834273374884:web:4b9da5557329c71f336c31"
};

// 2. 初始化所有 Firebase 服務
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app); 

export default function App() {
  const [user, setUser] = useState(null);
  const [mediaList, setMediaList] = useState([]);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [filter, setFilter] = useState('all'); 
  
  // 管理員最高權限狀態 (會記錄在瀏覽器，不用每次重登)
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('weddingAdmin') === 'true');
  
  // 賓客姓名相關狀態
  const [guestName, setGuestName] = useState(() => localStorage.getItem('weddingGuestName') || '');
  const [guestLineId, setGuestLineId] = useState(() => localStorage.getItem('weddingGuestLineId') || '');
  const [showNameModal, setShowNameModal] = useState(false);
  const [tempNameInput, setTempNameInput] = useState('');
  const [tempLineIdInput, setTempLineIdInput] = useState('');
  
  const fileInputRef = useRef(null);

  // 初始化 LINE LIFF
  useEffect(() => {
    const initLiff = async () => {
      try {
        const myLiffId = '2009589281-0n3fdsNk';
        if (myLiffId === 'YOUR_LIFF_ID' || !myLiffId) return;

        if (!window.liff) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
            script.onload = resolve;
            script.onerror = reject;
            document.body.appendChild(script);
          });
        }
        const liff = window.liff;
        await liff.init({ liffId: myLiffId }); 
        
        if (liff.isLoggedIn()) {
          const profile = await liff.getProfile();
          setGuestName(profile.displayName); 
          setGuestLineId(profile.userId);    
          localStorage.setItem('weddingGuestName', profile.displayName);
          localStorage.setItem('weddingGuestLineId', profile.userId);
        }
      } catch (err) {
        console.error('LIFF 初始化失敗或非 LINE 環境', err);
      }
    };
    initLiff();
  }, []);

  // 隱形登入
  useEffect(() => {
    const initAuth = async () => {
      try { await signInAnonymously(auth); } catch (error) { console.error("登入失敗:", error); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 監聽資料庫
  useEffect(() => {
    if (!user) return;
    const mediaRef = collection(db, 'wedding_media');
    const unsubscribe = onSnapshot(mediaRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setMediaList(data);
    });
    return () => unsubscribe();
  }, [user]);

  // ✨ 新增：隱藏的管理員登入通道
  const handleSecretLogin = () => {
    if (isAdmin) {
      if (window.confirm('要登出管理員權限嗎？')) {
        setIsAdmin(false);
        localStorage.removeItem('weddingAdmin');
      }
      return;
    }
    
    const pwd = window.prompt('請輸入新人專屬密碼解鎖最高權限：');
    if (pwd === '20260506') { // 密碼已更改為結婚登記日 20250506
      setIsAdmin(true);
      localStorage.setItem('weddingAdmin', 'true');
      alert('✨ 歡迎新娘/新郎！最高管理權限已開啟。您現在可以刪除任何照片與一鍵打包下載。');
    } else if (pwd !== null) {
      alert('密碼錯誤！');
    }
  };

  const handleUploadClick = () => {
    if (!guestName) {
      setShowNameModal(true);
    } else {
      fileInputRef.current.click();
    }
  };

  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (!tempNameInput.trim()) return;
    setGuestName(tempNameInput);
    setGuestLineId(tempLineIdInput);
    localStorage.setItem('weddingGuestName', tempNameInput);
    localStorage.setItem('weddingGuestLineId', tempLineIdInput);
    setShowNameModal(false);
    setTimeout(() => { if (fileInputRef.current) fileInputRef.current.click(); }, 100);
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0 || !user) return;
    setIsUploading(true);

    try {
      const mediaRef = collection(db, 'wedding_media');
      for (const file of files) {
        const fileRef = ref(storage, `wedding_media/${Date.now()}_${file.name}`);
        const snapshot = await uploadBytes(fileRef, file);
        const realCloudUrl = await getDownloadURL(snapshot.ref);
        
        await addDoc(mediaRef, {
          url: realCloudUrl,
          type: file.type,
          guestName: guestName,
          lineId: guestLineId,
          uploaderUid: user.uid,
          createdAt: Date.now()
        });
      }
    } catch (error) {
      alert("上傳失敗，請稍後再試。");
    } finally {
      setIsUploading(false);
      e.target.value = null; 
    }
  };

  // ✨ 修改：加入管理員無敵權限判斷
  const handleDelete = async (mediaId, uploaderUid) => {
    // 如果不是本人，而且也不是管理員，就擋掉
    if (user?.uid !== uploaderUid && !isAdmin) return;
    
    try {
      await deleteDoc(doc(db, 'wedding_media', mediaId));
      setSelectedMedia(null);
    } catch (error) {
      console.error("刪除失敗:", error);
    }
  };

  const handleDownload = async (url, filename) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = filename || 'wedding_moment';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
    } catch (error) {
      window.open(url, '_blank');
    }
  };

  // ✨ 新增：管理員專屬的一鍵下載全部功能
  const handleDownloadAll = async () => {
    if (!window.confirm(`確定要一次下載全部共 ${mediaList.length} 個檔案嗎？\n\n⚠️ 注意：瀏覽器可能會在上方跳出提示詢問「是否允許下載多個檔案」，請務必點選「允許」。`)) return;
    
    // 依序觸發下載，中間間隔 600 毫秒，避免被瀏覽器當成惡意軟體阻擋
    for (let i = 0; i < mediaList.length; i++) {
      const media = mediaList[i];
      await new Promise(resolve => setTimeout(resolve, 600));
      // 檔名加上序號
      handleDownload(media.url, `20250506_Wedding_${i+1}`);
    }
  };

  const filteredMediaList = mediaList.filter(media => {
    if (filter === 'all') return true;
    if (filter === 'video') return media.type?.startsWith('video/');
    if (filter === 'image') return !media.type?.startsWith('video/');
    return true;
  });

  return (
    <div className="min-h-screen bg-[#faf8f5] text-gray-800 font-sans pb-20">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-6 text-center">
          <div className="flex justify-center items-center gap-2 mb-2 text-rose-400">
            <Heart size={24} fill="currentColor" />
          </div>
          {/* ✨ 將標題加上 onClick 事件變成隱藏按鈕 */}
          <h1 
            onClick={handleSecretLogin}
            className="text-3xl md:text-4xl font-serif text-gray-800 mb-1 tracking-wider cursor-pointer select-none hover:text-rose-500 transition-colors"
            title="點擊解鎖管理員"
          >
            Stanley & Maggie
            {isAdmin && <ShieldCheck size={20} className="inline-block ml-2 text-rose-500 mb-2" />}
          </h1>
          <p className="text-sm text-gray-500 uppercase tracking-widest">
            Wedding Gallery
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        
        {/* ✨ 管理員專屬控制面板 (只有登入成功才會顯示) */}
        {isAdmin && mediaList.length > 0 && (
          <div className="bg-rose-50 rounded-2xl p-4 shadow-sm border border-rose-200 text-center mb-6 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-rose-700 font-medium flex items-center gap-2">
              <ShieldCheck size={20} /> 管理員模式已啟用
            </p>
            <button 
              onClick={handleDownloadAll}
              className="flex items-center gap-2 bg-white text-rose-600 px-6 py-2.5 rounded-full font-medium hover:bg-rose-600 hover:text-white transition-all border border-rose-200 shadow-sm"
            >
              <Package size={18} /> 打包下載全部照片與影片
            </button>
          </div>
        )}

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-rose-100 text-center mb-10">
          <h2 className="text-xl font-medium mb-2">分享你的視角！</h2>
          <p className="text-gray-500 text-sm mb-6">不需下載 APP，點擊按鈕即可上傳照片或影片至大螢幕與相簿中。</p>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*,video/*" multiple className="hidden" />
          <button 
            onClick={handleUploadClick}
            disabled={isUploading}
            className={`inline-flex items-center gap-2 px-8 py-4 rounded-full text-white font-medium transition-all transform hover:scale-105 shadow-md ${
              isUploading ? 'bg-rose-300 cursor-not-allowed' : 'bg-rose-500 hover:bg-rose-600 hover:shadow-lg'
            }`}
          >
            {isUploading ? <span className="animate-pulse">上傳處理中...</span> : <><Camera size={20} /><span>上傳照片/影片 (可多選)</span></>}
          </button>
          {guestName && (
            <p className="mt-4 text-sm text-gray-400 flex justify-center items-center gap-1">
              <User size={14} /> 目前署名：{guestName} {guestLineId && `(LINE: ${guestLineId})`}
              <button onClick={() => { setTempNameInput(guestName); setTempLineIdInput(guestLineId); setShowNameModal(true); }} className="underline ml-2 hover:text-gray-600">更改</button>
            </p>
          )}
        </div>

        {mediaList.length > 0 && (
          <div className="flex justify-center gap-3 mb-8">
            <button onClick={() => setFilter('all')} className={`px-5 py-2 rounded-full text-sm font-medium transition-colors shadow-sm ${filter === 'all' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}>全部 ({mediaList.length})</button>
            <button onClick={() => setFilter('image')} className={`px-5 py-2 rounded-full text-sm font-medium transition-colors shadow-sm ${filter === 'image' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}>照片 ({mediaList.filter(m => !m.type?.startsWith('video/')).length})</button>
            <button onClick={() => setFilter('video')} className={`px-5 py-2 rounded-full text-sm font-medium transition-colors shadow-sm ${filter === 'video' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}>影片 ({mediaList.filter(m => m.type?.startsWith('video/')).length})</button>
          </div>
        )}

        {filteredMediaList.length === 0 && !isUploading ? (
          <div className="text-center py-20 text-gray-400">
            <ImageIcon size={48} className="mx-auto mb-4 opacity-50" />
            <p>{filter === 'all' ? '還沒有照片喔，搶先成為第一個上傳的人吧！' : `目前還沒有${filter === 'video' ? '影片' : '照片'}喔！`}</p>
          </div>
        ) : (
          <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
            {filteredMediaList.map(media => (
              <div key={media.id} className="break-inside-avoid relative group cursor-pointer overflow-hidden rounded-xl bg-gray-100 shadow-sm" onClick={() => setSelectedMedia(media)}>
                {media.type?.startsWith('video/') ? (
                  <div className="relative">
                    <video src={media.url} className="w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    <div className="absolute top-2 right-2 bg-black/50 text-white p-1.5 rounded-full backdrop-blur-sm"><Video size={16} /></div>
                  </div>
                ) : (
                  <img src={media.url} alt="Wedding moment" className="w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end">
                  <div className="p-3 text-white w-full flex justify-between items-center"><p className="text-sm font-medium truncate drop-shadow-md">{media.guestName}</p></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {selectedMedia && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSelectedMedia(null)}>
          <button onClick={() => setSelectedMedia(null)} className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors bg-black/20 hover:bg-black/40 p-2 rounded-full"><X size={28} /></button>
          <div className="max-w-4xl w-full max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            {selectedMedia.type?.startsWith('video/') ? (
              <video src={selectedMedia.url} controls autoPlay className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl" />
            ) : (
              <img src={selectedMedia.url} alt="Enlarged view" className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl" />
            )}
            <div className="mt-6 flex justify-between items-center w-full px-4 text-white/90 bg-black/50 p-4 rounded-xl backdrop-blur-md">
              <div className="flex items-center gap-2">
                <User size={18} className="text-gray-400" />
                <span className="font-medium">{selectedMedia.guestName}</span> 
              </div>
              <div className="flex gap-4">
                <button onClick={() => handleDownload(selectedMedia.url, `wedding_moment_${selectedMedia.id}`)} className="flex items-center gap-2 hover:text-rose-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10">
                  <Download size={20} /> <span className="text-sm hidden sm:inline">下載原檔</span>
                </button>
                {/* ✨ 修改：如果你是上傳者，或是你是「管理員」，都可以看到刪除按鈕 */}
                {(user?.uid === selectedMedia.uploaderUid || isAdmin) && (
                  <button 
                    onClick={() => { if (window.confirm(isAdmin && user?.uid !== selectedMedia.uploaderUid ? '【管理員操作】確定要強制刪除這張照片嗎？' : '確定要刪除這個檔案嗎？')) { handleDelete(selectedMedia.id, selectedMedia.uploaderUid); } }}
                    className="flex items-center gap-2 text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10"
                  >
                    <Trash2 size={20} /> <span className="text-sm hidden sm:inline">{isAdmin && user?.uid !== selectedMedia.uploaderUid ? '強制刪除' : '刪除我的檔案'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 首次輸入姓名 Modal */}
      {showNameModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl transform transition-all">
            <div className="flex justify-center mb-4 text-rose-400"><Heart size={32} fill="currentColor" /></div>
            <h3 className="text-2xl font-medium text-center mb-2">歡迎來到我們的婚禮！</h3>
            <p className="text-gray-500 text-center text-sm mb-6">請告訴我們您是哪位親友，讓這份美好回憶更有意義。</p>
            <form onSubmit={handleNameSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">您的姓名/暱稱 (必填)</label>
                <input type="text" value={tempNameInput} onChange={(e) => setTempNameInput(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400 bg-gray-50" autoFocus required />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">LINE ID (選填)</label>
                <input type="text" value={tempLineIdInput} onChange={(e) => setTempLineIdInput(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400 bg-gray-50" />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowNameModal(false)} className="flex-1 px-4 py-3 rounded-xl text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors font-medium">取消</button>
                <button type="submit" className="flex-1 px-4 py-3 rounded-xl text-white bg-rose-500 hover:bg-rose-600 transition-colors shadow-md font-medium">確認</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
