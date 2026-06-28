// URLパラメータ取得
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('id');
const roomPassword = urlParams.get('password');

if (!roomId) {
  alert('ルームIDが指定されていません');
  window.location.href = '/rooms.html';
}

// グローバル変数
let socket;
let localStream;
let peerConnection;
let currentUser = null;
let isMuted = true;

// ICE サーバー設定
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// DOM要素
const themeToggleBtn = document.getElementById('theme-toggle');
const roomNameH1 = document.getElementById('room-name');
const roomInfoP = document.getElementById('room-info');
const userNameSpan = document.getElementById('user-name');
const backBtn = document.getElementById('back-btn');
const muteBtn = document.getElementById('mute-btn');
const leaveBtn = document.getElementById('leave-btn');
const statusDiv = document.getElementById('status');
const statusText = document.getElementById('status-text');
const participantsList = document.getElementById('participants-list');

// チャット要素
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const imageBtn = document.getElementById('image-btn');
const imageInput = document.getElementById('image-input');
const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');

// テーマ管理
let isDarkMode = localStorage.getItem('darkMode') === 'true';

function applyTheme() {
  if (isDarkMode) {
    document.body.classList.add('dark-mode');
    themeToggleBtn.innerHTML = '<span class="material-icons">brightness_7</span>';
  } else {
    document.body.classList.remove('dark-mode');
    themeToggleBtn.innerHTML = '<span class="material-icons">brightness_4</span>';
  }
  localStorage.setItem('darkMode', isDarkMode);
}

themeToggleBtn.addEventListener('click', () => {
  isDarkMode = !isDarkMode;
  applyTheme();
});

applyTheme();

// ステータス更新
function updateStatus(text, isConnected) {
  statusText.textContent = text;
  statusDiv.className = isConnected ? 'status-connected' : 'status-disconnected';
}

function applyMuteState() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !isMuted;
    }
  }

  muteBtn.classList.toggle('muted', isMuted);
  muteBtn.querySelector('.icon').textContent = isMuted ? 'mic_off' : 'mic';
  muteBtn.querySelector('.label').textContent = isMuted ? 'ミュート中' : 'ミュート';
}

applyMuteState();

// ユーザー情報取得
async function loadUserInfo() {
  try {
    const response = await fetch('/api/user');
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login.html';
        return;
      }
      throw new Error('ユーザー情報の取得に失敗しました');
    }
    
    currentUser = await response.json();
    
    // Misskeyのユーザー情報を表示
    if (currentUser.misskey?.connected && currentUser.misskey.user) {
      const misskeyUser = currentUser.misskey.user;
      const avatarUrl = misskeyUser.avatarUrl || '';
      const displayName = misskeyUser.name || misskeyUser.username;
      
      if (avatarUrl) {
        userNameSpan.innerHTML = `
          <img src="${avatarUrl}" alt="avatar" style="width: 20px; height: 20px; border-radius: 50%; vertical-align: middle; margin-right: 6px;">
          ${displayName}
        `;
      } else {
        userNameSpan.textContent = displayName;
      }
    } else {
      userNameSpan.textContent = currentUser.name;
    }
    
    // ルーム情報取得
    await loadRoomInfo();
    
    // Socket.IO接続
    await connectSocket();
    
  } catch (error) {
    console.error('初期化エラー:', error);
    alert('初期化に失敗しました');
    window.location.href = '/rooms.html';
  }
}

// ルーム情報取得
async function loadRoomInfo() {
  try {
    const response = await fetch(`/api/rooms/${roomId}`);
    if (!response.ok) {
      throw new Error('ルーム情報の取得に失敗しました');
    }
    
    const room = await response.json();
    roomNameH1.textContent = room.name;
    
  } catch (error) {
    console.error('ルーム情報取得エラー:', error);
    alert('ルームが見つかりません');
    window.location.href = '/rooms.html';
  }
}

// チャット履歴読み込み
async function loadChatHistory() {
  try {
    const response = await fetch(`/api/rooms/${roomId}/messages?limit=50`);
    if (!response.ok) return;
    
    const messages = await response.json();
    messages.forEach(msg => {
      displayChatMessage(msg, msg.user_id === currentUser.id);
    });
  } catch (error) {
    console.error('チャット履歴取得エラー:', error);
  }
}

// Socket.IO接続
async function connectSocket() {
  try {
    // マイクとカメラへのアクセス許可を取得
    updateStatus('マイクとカメラへのアクセスを要求中...', false);
    localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: true, 
      video: { 
        width: { ideal: 640 },
        height: { ideal: 480 }
      }
    });
    applyMuteState();
    
    updateStatus('接続中...', false);
    
    // Socket.io接続
    socket = io({
      auth: {
        userId: currentUser.id,
        userName: currentUser.name,
        avatarUrl: currentUser.misskey?.user?.avatarUrl || ''
      }
    });
    
    socket.on('connect', () => {
      console.log('サーバーに接続しました');
      
      // Canvas初期化
      initializeCanvas();
      
      // ローカルビデオ表示
      displayLocalVideo();
      
      // ルームに参加
      socket.emit('join-room', roomId, roomPassword || '', (response) => {
        if (response.error) {
          alert(response.error);
          window.location.href = '/rooms.html';
          return;
        }
        
        updateStatus('ルームに参加しました', true);
        updateParticipants(response.participants);
        loadChatHistory();
      });
    });

    // 新しいユーザーが接続した時
    socket.on('user-connected', async (newUserId, newUserName, avatarUrl) => {
      console.log(`${newUserName} が参加しました`);
      addSystemMessage(`${newUserName} が参加しました`);
      
      // PeerConnectionを作成してofferを送信
      await createPeerConnection(newUserId);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('offer', roomId, offer);
    });

    // ユーザーが切断した時
    socket.on('user-disconnected', (disconnectedUserId) => {
      console.log(`ユーザーが退出しました: ${disconnectedUserId}`);
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      updateStatus('待機中...', true);
    });

    // offerを受信した時
    socket.on('offer', async (offer, remoteUserId) => {
      console.log(`Offerを受信: ${remoteUserId}`);
      
      await createPeerConnection(remoteUserId);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('answer', roomId, answer);
    });

    // answerを受信した時
    socket.on('answer', async (answer, remoteUserId) => {
      console.log(`Answerを受信: ${remoteUserId}`);
      
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        updateStatus('通話中', true);
      }
    });

    // ICE candidateを受信した時
    socket.on('ice-candidate', async (candidate, remoteUserId) => {
      if (peerConnection && candidate) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('ICE candidate追加エラー:', error);
        }
      }
    });

    // チャットメッセージ受信
    socket.on('chat-message', (message) => {
      const isOwn = message.userId === currentUser.id;
      displayChatMessage(message, isOwn);
    });

    // Canvas描画データ受信
    socket.on('draw', (drawData) => {
      drawLine(drawData.x0, drawData.y0, drawData.x1, drawData.y1, drawData.color, drawData.width);
    });

    // キャンバスクリア受信
    socket.on('clear-canvas', () => {
      const rect = drawingCanvas.getBoundingClientRect();
      canvasContext.fillStyle = 'white';
      canvasContext.fillRect(0, 0, rect.width, rect.height);
    });

    // ルームが閉鎖された
    socket.on('room-closed', () => {
      alert('ルームが削除されました');
      window.location.href = '/rooms.html';
    });

  } catch (error) {
    console.error('エラー:', error);
    alert('マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
    window.location.href = '/rooms.html';
  }
}

// PeerConnection作成
async function createPeerConnection(remoteUserId) {
  peerConnection = new RTCPeerConnection(iceServers);

  // ローカルストリームの各トラックを追加
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // リモートストリーム受信時の処理
  peerConnection.ontrack = (event) => {
    console.log('リモートストリームを受信:', event.streams[0].getTracks());
    
    // ビデオトラックの場合
    if (event.track.kind === 'video') {
      console.log('リモートビデオストリームを受信');
      displayRemoteVideo(event.streams[0]);
    }
    
    // 音声トラックの場合
    if (event.track.kind === 'audio') {
      console.log('リモート音声ストリームを受信');
      const remoteAudio = new Audio();
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(e => {
        console.error('音声再生エラー:', e);
      });
    }
    
    updateStatus('通話中', true);
  };

  // ICE candidate生成時の処理
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', roomId, event.candidate);
    }
  };

  // 接続状態の監視
  peerConnection.onconnectionstatechange = () => {
    console.log(`接続状態: ${peerConnection.connectionState}`);
    
    if (peerConnection.connectionState === 'connected') {
      updateStatus('通話中', true);
    } else if (peerConnection.connectionState === 'disconnected' || 
               peerConnection.connectionState === 'failed') {
      updateStatus('接続が切断されました', false);
    }
  };
}

// 参加者リスト更新
function updateParticipants(participants) {
  participantsList.innerHTML = '';
  participants.forEach(p => {
    const item = document.createElement('div');
    item.className = 'participant-item';
    
    if (p.avatarUrl) {
      item.innerHTML = `
        <img src="${p.avatarUrl}" alt="avatar" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">
        <span class="participant-name">${escapeHtml(p.userName)}${p.userId === currentUser.id ? ' (あなた)' : ''}</span>
      `;
    } else {
      item.innerHTML = `
        <span class="participant-icon">👤</span>
        <span class="participant-name">${escapeHtml(p.userName)}${p.userId === currentUser.id ? ' (あなた)' : ''}</span>
      `;
    }
    
    participantsList.appendChild(item);
  });
}

// チャットメッセージ表示
function displayChatMessage(message, isOwn) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message${isOwn ? ' own' : ''}`;
  
  const time = new Date(message.createdAt || message.created_at).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit'
  });
  
  if (message.messageType === 'text' || message.message_type === 'text') {
    messageDiv.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-message-author">${escapeHtml(message.userName || message.user_name)}</span>
        <span class="chat-message-time">${time}</span>
      </div>
      <div class="chat-message-content">${escapeHtml(message.content)}</div>
    `;
  } else {
    messageDiv.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-message-author">${escapeHtml(message.userName || message.user_name)}</span>
        <span class="chat-message-time">${time}</span>
      </div>
      <img src="${message.content}" class="chat-message-image" onclick="showImageModal('${message.content}')" alt="画像">
    `;
  }
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// システムメッセージ表示
function addSystemMessage(text) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  messageDiv.style.borderLeftColor = 'var(--warning-color)';
  messageDiv.style.background = 'rgba(255, 193, 7, 0.1)';
  messageDiv.innerHTML = `
    <div class="chat-message-content" style="text-align: center; color: var(--warning-color); font-weight: 600;">
      ${escapeHtml(text)}
    </div>
  `;
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// チャットメッセージ送信
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function sendMessage() {
  const message = chatInput.value.trim();
  if (!message || !socket) return;
  
  socket.emit('chat-message', roomId, message);
  chatInput.value = '';
}

// 画像送信
imageBtn.addEventListener('click', () => {
  imageInput.click();
});

imageInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  if (file.size > 10 * 1024 * 1024) {
    alert('ファイルサイズは10MB以下にしてください');
    return;
  }
  
  try {
    const formData = new FormData();
    formData.append('image', file);
    
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('画像のアップロードに失敗しました');
    }
    
    const result = await response.json();
    socket.emit('chat-image', roomId, result.url);
    
  } catch (error) {
    console.error('画像アップロードエラー:', error);
    alert('画像のアップロードに失敗しました');
  } finally {
    imageInput.value = '';
  }
});

// 画像モーダル
function showImageModal(url) {
  modalImage.src = url;
  imageModal.classList.remove('hidden');
}

function closeImageModal() {
  imageModal.classList.add('hidden');
  modalImage.src = '';
}

// モーダル閉じるボタンのイベントリスナー
const imageModalCloseBtn = document.getElementById('image-modal-close');
if (imageModalCloseBtn) {
  imageModalCloseBtn.addEventListener('click', closeImageModal);
}

// モーダル背景クリックで閉じる
if (imageModal) {
  imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal || e.target.classList.contains('modal-backdrop')) {
      closeImageModal();
    }
  });
}

// ミュートボタン
muteBtn.addEventListener('click', () => {
  if (localStream) {
    isMuted = !isMuted;
    applyMuteState();
  }
});

// 退出ボタン
leaveBtn.addEventListener('click', () => {
  if (confirm('ルームから退出しますか？')) {
    leaveRoom();
  }
});

// 戻るボタン
backBtn.addEventListener('click', () => {
  if (confirm('ルームから退出しますか？')) {
    leaveRoom();
  }
});

// ルーム退出処理
function leaveRoom() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  window.location.href = '/rooms.html';
}

// ページを離れる前の警告
window.addEventListener('beforeunload', (e) => {
  if (socket && socket.connected) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ユーティリティ関数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// Canvas描画機能
// ============================================

let isDrawing = false;
let lastX = 0;
let lastY = 0;
let canvasContext;
let drawingCanvas;

// Canvas要素の取得と初期化
function initializeCanvas() {
  drawingCanvas = document.getElementById('drawing-canvas');
  canvasContext = drawingCanvas.getContext('2d');
  
  // キャンバスのサイズを設定（デバイスピクセル比を考慮）
  const dpr = window.devicePixelRatio || 1;
  const rect = drawingCanvas.getBoundingClientRect();
  drawingCanvas.width = rect.width * dpr;
  drawingCanvas.height = rect.height * dpr;
  canvasContext.scale(dpr, dpr);
  
  // 背景を白で塗りつぶし
  canvasContext.fillStyle = 'white';
  canvasContext.fillRect(0, 0, rect.width, rect.height);
  
  // マウスイベントのリッスン
  drawingCanvas.addEventListener('mousedown', startDrawing);
  drawingCanvas.addEventListener('mousemove', draw);
  drawingCanvas.addEventListener('mouseup', stopDrawing);
  drawingCanvas.addEventListener('mouseout', stopDrawing);
  
  // タッチイベントのリッスン（モバイル対応）
  drawingCanvas.addEventListener('touchstart', handleTouchStart);
  drawingCanvas.addEventListener('touchmove', handleTouchMove);
  drawingCanvas.addEventListener('touchend', stopDrawing);
  
  // 描画設定UI
  const brushColorInput = document.getElementById('brush-color');
  const brushSizeInput = document.getElementById('brush-size');
  const brushSizeDisplay = document.getElementById('brush-size-display');
  const clearCanvasBtn = document.getElementById('clear-canvas-btn');
  const toggleVideoBtn = document.getElementById('toggle-video-btn');
  
  brushColorInput.addEventListener('change', (e) => {
    canvasContext.strokeStyle = e.target.value;
  });
  
  brushSizeInput.addEventListener('input', (e) => {
    canvasContext.lineWidth = e.target.value;
    brushSizeDisplay.textContent = e.target.value;
  });
  
  clearCanvasBtn.addEventListener('click', clearCanvas);
  
  // ビデオON/OFFボタン
  if (toggleVideoBtn) {
    toggleVideoBtn.addEventListener('click', toggleVideo);
  }
  
  // 初期値の設定
  canvasContext.strokeStyle = brushColorInput.value;
  canvasContext.lineWidth = brushSizeInput.value;
  canvasContext.lineCap = 'round';
  canvasContext.lineJoin = 'round';
}

// 描画開始
function startDrawing(e) {
  isDrawing = true;
  const rect = drawingCanvas.getBoundingClientRect();
  lastX = (e.clientX - rect.left) * (drawingCanvas.width / rect.width);
  lastY = (e.clientY - rect.top) * (drawingCanvas.height / rect.height);
}

// 描画処理
function draw(e) {
  if (!isDrawing) return;
  
  const rect = drawingCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (drawingCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (drawingCanvas.height / rect.height);
  
  // ローカルに描画
  drawLine(lastX, lastY, x, y);
  
  // WebSocket経由で送信
  if (socket) {
    socket.emit('draw', roomId, {
      x0: lastX,
      y0: lastY,
      x1: x,
      y1: y,
      color: canvasContext.strokeStyle,
      width: canvasContext.lineWidth
    });
  }
  
  lastX = x;
  lastY = y;
}

// 描画停止
function stopDrawing() {
  isDrawing = false;
}

// タッチ開始
function handleTouchStart(e) {
  const touch = e.touches[0];
  const rect = drawingCanvas.getBoundingClientRect();
  isDrawing = true;
  lastX = (touch.clientX - rect.left) * (drawingCanvas.width / rect.width);
  lastY = (touch.clientY - rect.top) * (drawingCanvas.height / rect.height);
}

// タッチ移動
function handleTouchMove(e) {
  if (!isDrawing) return;
  e.preventDefault();
  
  const touch = e.touches[0];
  const rect = drawingCanvas.getBoundingClientRect();
  const x = (touch.clientX - rect.left) * (drawingCanvas.width / rect.width);
  const y = (touch.clientY - rect.top) * (drawingCanvas.height / rect.height);
  
  drawLine(lastX, lastY, x, y);
  
  if (socket) {
    socket.emit('draw', roomId, {
      x0: lastX,
      y0: lastY,
      x1: x,
      y1: y,
      color: canvasContext.strokeStyle,
      width: canvasContext.lineWidth
    });
  }
  
  lastX = x;
  lastY = y;
}

// 線を描画する関数
function drawLine(x0, y0, x1, y1, color = null, width = null) {
  if (color) canvasContext.strokeStyle = color;
  if (width) canvasContext.lineWidth = width;
  
  canvasContext.beginPath();
  canvasContext.moveTo(x0, y0);
  canvasContext.lineTo(x1, y1);
  canvasContext.stroke();
}

// キャンバスをクリア
function clearCanvas() {
  const rect = drawingCanvas.getBoundingClientRect();
  canvasContext.fillStyle = 'white';
  canvasContext.fillRect(0, 0, rect.width, rect.height);
  
  if (socket) {
    socket.emit('clear-canvas', roomId);
  }
}

// ビデオ表示/非表示切り替え
function toggleVideo() {
  const videoContainer = document.querySelector('.video-container');
  videoContainer.style.display = videoContainer.style.display === 'none' ? 'block' : 'none';
}

// ============================================
// ビデオ機能
// ============================================

let remoteStream;
let isVideoEnabled = false;  // ビデオON/OFF状態

// ローカルビデオの表示
async function displayLocalVideo() {
  try {
    const localVideo = document.getElementById('local-video');
    if (localStream && localVideo) {
      localVideo.srcObject = localStream;
      
      // ビデオトラックを初期状態でOFFに設定
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = isVideoEnabled;
      });
    }
  } catch (error) {
    console.error('ローカルビデオ表示エラー:', error);
  }
}

// リモートビデオの表示
function displayRemoteVideo(stream) {
  const remoteVideo = document.getElementById('remote-video');
  if (remoteVideo) {
    remoteVideo.srcObject = stream;
    remoteStream = stream;
  }
}

// ビデオON/OFF切り替え
function toggleVideo() {
  if (!localStream) return;
  
  const videoTracks = localStream.getVideoTracks();
  isVideoEnabled = !isVideoEnabled;
  
  videoTracks.forEach(track => {
    track.enabled = isVideoEnabled;
  });
  
  // ボタンのテキストを更新
  const toggleVideoBtn = document.getElementById('toggle-video-btn');
  if (toggleVideoBtn) {
    if (isVideoEnabled) {
      toggleVideoBtn.classList.add('active');
      toggleVideoBtn.querySelector('.material-icons').textContent = 'videocam';
      toggleVideoBtn.querySelector('span:last-child').textContent = 'ビデオ中';
    } else {
      toggleVideoBtn.classList.remove('active');
      toggleVideoBtn.querySelector('.material-icons').textContent = 'videocam_off';
      toggleVideoBtn.querySelector('span:last-child').textContent = 'ビデオOFF';
    }
  }
}

// 初期化
loadUserInfo();
