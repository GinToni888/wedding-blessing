import React, { useState, useRef, useEffect } from 'react';
import { Camera, Heart, Image as ImageIcon, X, Download, Trash2, Video, User } from 'lucide-react';
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
  const [filter, setFilter] = useState('all'); // 新增：媒體分類過濾器
  
  // 賓客姓名相關狀態
  const [guestName, setGuestName] = useState(() => localStorage.getItem('weddingGuestName') || '');
  const [guestLineId, setGuestLineId] = useState(() => localStorage.getItem('weddingGuestLineId') || '');
  const [showNameModal, setShowNameModal] = useState(false);
  const [tempNameInput, setTempNameInput] = useState('');
  const [tempLineIdInput, setTempLineIdInput] = useState('');
  
  const fileInputRef = useRef(null);

  // 新增：初始化 LINE LIFF，嘗試自動抓取 LINE 使用者資料
  useEffect(() => {
    const initLiff = async () => {
      try {
        // ⚠️ 已經替換成你在 LINE Developer 後台申請的真實 LIFF ID
        const myLiffId = '2009589281-0n3fdsNk';

        // 防呆機制：如果還沒填寫真實的 LIFF ID，先跳過初始化，避免產生 channel not found 錯誤
        if (myLiffId === 'YOUR_LIFF_ID' || !myLiffId) {
          console.log('⚠️ 尚未設定真實的 LIFF ID，已跳過 LINE 資料自動抓取功能。');
          return;
        }

        // 動態載入 LIFF SDK 以確保相容性
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
        
        // 如果使用者是在 LINE 內建瀏覽器打開，就會自動取得資料
        if (liff.isLoggedIn()) {
          const profile = await liff.getProfile();
          
          // 自動帶入 LINE 暱稱與系統隱藏 ID
          setGuestName(profile.displayName); 
          setGuestLineId(profile.userId);    
          
          // 記錄到瀏覽器暫存中
          localStorage.setItem('weddingGuestName', profile.displayName);
          localStorage.setItem('weddingGuestLineId', profile.userId);
        }
      } catch (err) {
        console.error('LIFF 初始化失敗或非 LINE 環境', err);
        // 即使失敗也沒關係，系統會自動退回讓賓客「手動輸入」的模式
      }
    };
    initLiff();
  }, []);

  // 處理免註冊的「隱形登入」(賦予每台裝置一個專屬 UID，用來辨識刪除權限)
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("登入失敗:", error);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 即時監聽雲端資料庫的檔案列表
  useEffect(() => {
    if (!user) return;
    
    // 監聽名為 'wedding_media' 的資料表
    const mediaRef = collection(db, 'wedding_media');
    const unsubscribe = onSnapshot(mediaRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // 依照上傳時間新到舊排序
      data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setMediaList(data);
    }, (error) => {
      console.error("讀取資料失敗:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // 點擊上傳按鈕的流程控制
  const handleUploadClick = () => {
    if (!guestName) {
      setShowNameModal(true); // 如果還沒留過名字，先跳出輸入框
    } else {
      fileInputRef.current.click(); // 直接開啟檔案選擇器
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
    
    // 延遲一下讓 Modal 關閉後再開啟檔案選擇
    setTimeout(() => {
      if (fileInputRef.current) fileInputRef.current.click();
    }, 100);
  };

  // 核心！真實上傳到 Firebase Storage 的邏輯
  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0 || !user) return;

    setIsUploading(true);

    try {
      const mediaRef = collection(db, 'wedding_media');
      
      for (const file of files) {
        // 1. 設定檔案在 Storage 中的儲存路徑與名稱 (加上時間戳記避免檔名重複)
        const fileRef = ref(storage, `wedding_media/${Date.now()}_${file.name}`);
        
        // 2. 將檔案真實上傳到 Firebase Storage
        const snapshot = await uploadBytes(fileRef, file);
        
        // 3. 取得上傳成功後的真實下載網址
        const realCloudUrl = await getDownloadURL(snapshot.ref);
        
        // 4. 將網址與上傳者資訊存入 Firestore 資料庫
        await addDoc(mediaRef, {
          url: realCloudUrl,
          type: file.type, // 記錄是影片還是圖片
          guestName: guestName,
          lineId: guestLineId, // 記錄 LINE ID 
          uploaderUid: user.uid, // 核心！記錄是誰傳的
          createdAt: Date.now()
        });
      }
    } catch (error) {
      console.error("上傳失敗:", error);
      alert("上傳失敗，請稍後再試。");
    } finally {
      setIsUploading(false);
      // 清空 input，允許重複上傳相同檔案
      e.target.value = null; 
    }
  };

  const handleDelete = async (mediaId, uploaderUid) => {
    // 雙重檢查：只有目前使用者 ID 符合上傳者 ID 才能刪除
    if (user?.uid !== uploaderUid) return;
    
    try {
      await deleteDoc(doc(db, 'wedding_media', mediaId));
      setSelectedMedia(null); // 關閉燈箱
    } catch (error) {
      console.error("刪除失敗:", error);
    }
  };

  const handleDownload = async (url, filename) => {
    try {
      // 確保跨域圖片/影片能夠正確觸發強制下載，而不是開新分頁
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
      // 退回一般開新分頁模式
      window.open(url, '_blank');
    }
  };

  // 新增：根據過濾器篩選要顯示的媒體
  const filteredMediaList = mediaList.filter(media => {
    if (filter === 'all') return true;
    if (filter === 'video') return media.type?.startsWith('video/');
    if (filter === 'image') return !media.type?.startsWith('video/');
    return true;
  });

  return (
    <div className="min-h-screen bg-[#faf8f5] text-gray-800 font-sans pb-20">
      {/* 頂部導覽與標題 */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-6 text-center">
          <div className="flex justify-center items-center gap-2 mb-2 text-rose-400">
            <Heart size={24} fill="currentColor" />
          </div>
          <h1 className="text-3xl md:text-4xl font-serif text-gray-800 mb-1 tracking-wider">
            Stanley & Maggie
          </h1>
          <p className="text-sm text-gray-500 uppercase tracking-widest">
            Wedding Gallery • 2026.10.24
          </p>
        </div>
      </header>

      {/* 主要內容區 */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        
        {/* 上傳按鈕區塊 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-rose-100 text-center mb-10">
          <h2 className="text-xl font-medium mb-2">分享你的視角！</h2>
          <p className="text-gray-500 text-sm mb-6">
            不需下載 APP，點擊按鈕即可上傳照片或影片至大螢幕與相簿中。
          </p>
          
          {/* 加入 accept 屬性同時支援圖片與影片 */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/*,video/*" 
            multiple 
            className="hidden" 
          />
          
          <button 
            onClick={handleUploadClick}
            disabled={isUploading}
            className={`inline-flex items-center gap-2 px-8 py-4 rounded-full text-white font-medium transition-all transform hover:scale-105 shadow-md ${
              isUploading ? 'bg-rose-300 cursor-not-allowed' : 'bg-rose-500 hover:bg-rose-600 hover:shadow-lg'
            }`}
          >
            {isUploading ? (
              <span className="animate-pulse">上傳處理中...</span>
            ) : (
              <>
                <Camera size={20} />
                <span>上傳照片/影片 (可多選)</span>
              </>
            )}
          </button>
          
          {guestName && (
            <p className="mt-4 text-sm text-gray-400 flex justify-center items-center gap-1">
              <User size={14} /> 目前署名：{guestName} {guestLineId && `(LINE: ${guestLineId})`}
              <button onClick={() => {
                setTempNameInput(guestName);
                setTempLineIdInput(guestLineId);
                setShowNameModal(true);
              }} className="underline ml-2 hover:text-gray-600">更改</button>
            </p>
          )}
        </div>

        {/* 新增：照片與影片的分類標籤 (只有在有檔案時才顯示) */}
        {mediaList.length > 0 && (
          <div className="flex justify-center gap-3 mb-8">
            <button 
              onClick={() => setFilter('all')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-colors shadow-sm ${filter === 'all' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
            >
              全部 ({mediaList.length})
            </button>
            <button 
              onClick={() => setFilter('image')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-colors shadow-sm ${filter === 'image' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
            >
              照片 ({mediaList.filter(m => !m.type?.startsWith('video/')).length})
            </button>
            <button 
              onClick={() => setFilter('video')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-colors shadow-sm ${filter === 'video' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
            >
              影片 ({mediaList.filter(m => m.type?.startsWith('video/')).length})
            </button>
          </div>
        )}

        {/* 瀑布流網格 */}
        {filteredMediaList.length === 0 && !isUploading ? (
          <div className="text-center py-20 text-gray-400">
            <ImageIcon size={48} className="mx-auto mb-4 opacity-50" />
            <p>{filter === 'all' ? '還沒有照片喔，搶先成為第一個上傳的人吧！' : `目前還沒有${filter === 'video' ? '影片' : '照片'}喔！`}</p>
          </div>
        ) : (
          <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
            {filteredMediaList.map(media => (
              <div 
                key={media.id} 
                className="break-inside-avoid relative group cursor-pointer overflow-hidden rounded-xl bg-gray-100 shadow-sm"
                onClick={() => setSelectedMedia(media)}
              >
                {/* 根據檔案類型渲染 img 或 video */}
                {media.type?.startsWith('video/') ? (
                  <div className="relative">
                    <video 
                      src={media.url} 
                      className="w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute top-2 right-2 bg-black/50 text-white p-1.5 rounded-full backdrop-blur-sm">
                      <Video size={16} />
                    </div>
                  </div>
                ) : (
                  <img 
                    src={media.url} 
                    alt="Wedding moment" 
                    className="w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                  />
                )}
                
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end">
                  <div className="p-3 text-white w-full flex justify-between items-center">
                    <p className="text-sm font-medium truncate drop-shadow-md">
                      {media.guestName}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 照片/影片放大燈箱 (Lightbox) */}
      {selectedMedia && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSelectedMedia(null)}>
          <button 
            onClick={() => setSelectedMedia(null)}
            className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors bg-black/20 hover:bg-black/40 p-2 rounded-full"
          >
            <X size={28} />
          </button>
          
          <div className="max-w-4xl w-full max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            {/* 放大預覽區 */}
            {selectedMedia.type?.startsWith('video/') ? (
              <video 
                src={selectedMedia.url} 
                controls 
                autoPlay
                className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl"
              />
            ) : (
              <img 
                src={selectedMedia.url} 
                alt="Enlarged view" 
                className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl"
              />
            )}
            
            {/* 燈箱底部操作列 */}
            <div className="mt-6 flex justify-between items-center w-full px-4 text-white/90 bg-black/50 p-4 rounded-xl backdrop-blur-md">
              <div className="flex items-center gap-2">
                <User size={18} className="text-gray-400" />
                <span className="font-medium">{selectedMedia.guestName}</span> 
                <span className="text-gray-400 text-sm ml-1">分享</span>
              </div>
              
              <div className="flex gap-4">
                {/* 下載按鈕 (所有人可見) */}
                <button 
                  onClick={() => handleDownload(selectedMedia.url, `wedding_moment_${selectedMedia.id}`)}
                  className="flex items-center gap-2 hover:text-rose-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10"
                >
                  <Download size={20} />
                  <span className="text-sm hidden sm:inline">下載原檔</span>
                </button>

                {/* 刪除按鈕 (只有上傳者本人看得到！) */}
                {user?.uid === selectedMedia.uploaderUid && (
                  <button 
                    onClick={() => {
                      if (window.confirm('確定要刪除這個檔案嗎？')) {
                        handleDelete(selectedMedia.id, selectedMedia.uploaderUid);
                      }
                    }}
                    className="flex items-center gap-2 text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10"
                  >
                    <Trash2 size={20} />
                    <span className="text-sm hidden sm:inline">刪除我的檔案</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 首次輸入姓名的彈跳視窗 */}
      {showNameModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl transform transition-all">
            <div className="flex justify-center mb-4 text-rose-400">
              <Heart size={32} fill="currentColor" />
            </div>
            <h3 className="text-2xl font-medium text-center mb-2">歡迎來到我們的婚禮！</h3>
            <p className="text-gray-500 text-center text-sm mb-6">
              請告訴我們您是哪位親友，讓這份美好回憶更有意義。
            </p>
            <form onSubmit={handleNameSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">您的姓名/暱稱 (必填)</label>
                <input
                  type="text"
                  value={tempNameInput}
                  onChange={(e) => setTempNameInput(e.target.value)}
                  placeholder="例如：伴娘小美、大學同學志明"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent bg-gray-50"
                  autoFocus
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">LINE ID (選填)</label>
                <input
                  type="text"
                  value={tempLineIdInput}
                  onChange={(e) => setTempLineIdInput(e.target.value)}
                  placeholder="方便新人後續聯絡您或分享照片"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent bg-gray-50"
                />
              </div>
              <div className="flex gap-3">
                <button 
                  type="button" 
                  onClick={() => setShowNameModal(false)}
                  className="flex-1 px-4 py-3 rounded-xl text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors font-medium"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="flex-1 px-4 py-3 rounded-xl text-white bg-rose-500 hover:bg-rose-600 transition-colors shadow-md font-medium"
                >
                  確認並選擇照片
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}