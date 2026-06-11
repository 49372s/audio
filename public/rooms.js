// DOM要素の取得
const userNameSpan = document.getElementById('user-name');
const logoutBtn = document.getElementById('logout-btn');
const roomNameInput = document.getElementById('room-name-input');
const roomPasswordInput = document.getElementById('room-password-input');
const createRoomBtn = document.getElementById('create-room-btn');
const refreshBtn = document.getElementById('refresh-btn');
const roomsList = document.getElementById('rooms-list');
const noRoomsDiv = document.getElementById('no-rooms');
const themeToggleBtn = document.getElementById('theme-toggle');

// パスワードモーダル
const passwordModal = document.getElementById('password-modal');
const modalRoomName = document.getElementById('modal-room-name');
const modalPasswordInput = document.getElementById('modal-password-input');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalJoinBtn = document.getElementById('modal-join-btn');
const modalError = document.getElementById('modal-error');

// 共有モーダル
const shareModal = document.getElementById('share-modal');
const shareUrlInput = document.getElementById('share-url-input');
const copyUrlBtn = document.getElementById('copy-url-btn');
const shareModalCloseBtn = document.getElementById('share-modal-close-btn');

// グローバル変数
let currentUser = null;
let currentRoomForPassword = null;

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
    userNameSpan.innerHTML = `<span class="material-icons" style="vertical-align: middle; font-size: 18px; margin-right: 4px;">person</span>${currentUser.name}`;
  } catch (error) {
    console.error('ユーザー情報取得エラー:', error);
  }
}

// ルーム一覧取得
async function loadRooms() {
  try {
    const response = await fetch('/api/rooms');
    if (!response.ok) throw new Error('ルーム一覧の取得に失敗しました');
    
    const rooms = await response.json();
    displayRooms(rooms);
  } catch (error) {
    console.error('ルーム一覧取得エラー:', error);
  }
}

// ルーム表示
function displayRooms(rooms) {
  roomsList.innerHTML = '';
  
  if (rooms.length === 0) {
    noRoomsDiv.classList.remove('hidden');
    return;
  }
  
  noRoomsDiv.classList.add('hidden');
  
  rooms.forEach(room => {
    const card = document.createElement('div');
    card.className = 'room-card';
    
    const timeAgo = getTimeAgo(room.last_activity);
    
    card.innerHTML = `
      <div class="room-card-header">
        <h3 class="room-card-title">${escapeHtml(room.name)}</h3>
        ${room.hasPassword ? '<span class="room-card-lock material-icons">lock</span>' : ''}
      </div>
      <div class="room-card-info">
        作成者: ${escapeHtml(room.creator_name)}
      </div>
      <div class="room-card-info">
        最終アクティビティ: ${timeAgo}
      </div>
      <div class="room-card-participants">
        <span class="room-card-participants-icon material-icons">group</span>
        <span>${room.participantCount}人参加中</span>
      </div>
      <div class="room-card-actions">
        <button class="room-card-btn room-card-btn-join" onclick="joinRoom('${room.id}', ${room.hasPassword})">
          <span class="material-icons">mic</span>参加
        </button>
        <button class="room-card-btn room-card-btn-share" onclick="shareRoom('${room.id}', '${escapeHtml(room.name)}')">
          <span class="material-icons">share</span>共有
        </button>
      </div>
    `;
    
    roomsList.appendChild(card);
  });
}

// ルーム作成
createRoomBtn.addEventListener('click', async () => {
  const name = roomNameInput.value.trim();
  const password = roomPasswordInput.value.trim();
  
  if (!name) {
    alert('ルーム名を入力してください');
    return;
  }
  
  try {
    createRoomBtn.disabled = true;
    createRoomBtn.textContent = '作成中...';
    
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, password })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'ルームの作成に失敗しました');
    }
    
    const room = await response.json();
    
    const createdPassword = password; // 作成時のパスワードを保持
    roomNameInput.value = '';
    roomPasswordInput.value = '';
    
    await loadRooms();
    
    // 作成したルームに参加（パスワード付きの場合はパスワードを含める）
    setTimeout(() => {
      if (createdPassword && createdPassword.trim().length > 0) {
        window.location.href = `/room.html?id=${room.id}&password=${encodeURIComponent(createdPassword)}`;
      } else {
        window.location.href = `/room.html?id=${room.id}`;
      }
    }, 500);
    
  } catch (error) {
    console.error('ルーム作成エラー:', error);
    alert(error.message);
  } finally {
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = '➕ ルームを作成';
  }
});

// ルーム参加
async function joinRoom(roomId, hasPassword) {
  if (hasPassword) {
    // パスワードモーダル表示
    currentRoomForPassword = roomId;
    const room = await getRoomInfo(roomId);
    if (room) {
      modalRoomName.textContent = `ルーム: ${room.name}`;
      modalPasswordInput.value = '';
      modalError.classList.add('hidden');
      passwordModal.classList.remove('hidden');
    }
  } else {
    // 直接参加
    window.location.href = `/room.html?id=${roomId}`;
  }
}

// ルーム情報取得
async function getRoomInfo(roomId) {
  try {
    const response = await fetch(`/api/rooms/${roomId}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('ルーム情報取得エラー:', error);
    return null;
  }
}

// パスワード検証して参加
modalJoinBtn.addEventListener('click', async () => {
  const password = modalPasswordInput.value;
  
  // パスワードが空の場合
  if (!password || password.trim().length === 0) {
    modalError.textContent = 'パスワードを入力してください';
    modalError.classList.remove('hidden');
    return;
  }
  
  try {
    modalJoinBtn.disabled = true;
    modalJoinBtn.textContent = '確認中...';
    
    const response = await fetch(`/api/rooms/${currentRoomForPassword}/verify-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });
    
    const result = await response.json();
    
    if (result.valid) {
      // パスワード正しい - ルームに参加
      window.location.href = `/room.html?id=${currentRoomForPassword}&password=${encodeURIComponent(password)}`;
    } else {
      modalError.textContent = 'パスワードが正しくありません';
      modalError.classList.remove('hidden');
    }
  } catch (error) {
    console.error('パスワード検証エラー:', error);
    modalError.textContent = 'パスワード検証に失敗しました';
    modalError.classList.remove('hidden');
  } finally {
    modalJoinBtn.disabled = false;
    modalJoinBtn.textContent = '参加';
  }
});

// パスワードモーダルキャンセル
modalCancelBtn.addEventListener('click', () => {
  passwordModal.classList.add('hidden');
  currentRoomForPassword = null;
});

// ルーム共有
function shareRoom(roomId, roomName) {
  const url = `${window.location.origin}/room.html?id=${roomId}`;
  shareUrlInput.value = url;
  shareModal.classList.remove('hidden');
}

// URL コピー
copyUrlBtn.addEventListener('click', () => {
  shareUrlInput.select();
  document.execCommand('copy');
  copyUrlBtn.textContent = '✅ コピーしました';
  setTimeout(() => {
    copyUrlBtn.textContent = '📋 コピー';
  }, 2000);
});

// 共有モーダルを閉じる
shareModalCloseBtn.addEventListener('click', () => {
  shareModal.classList.add('hidden');
});

// 更新ボタン
refreshBtn.addEventListener('click', () => {
  loadRooms();
});

// ログアウト
logoutBtn.addEventListener('click', () => {
  if (confirm('ログアウトしますか？')) {
    window.location.href = '/logout';
  }
});

// ユーティリティ関数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  if (hours < 24) return `${hours}時間前`;
  return `${days}日前`;
}

// 初期化
loadUserInfo();
loadRooms();

// 定期的に更新（30秒ごと）
setInterval(loadRooms, 30000);
