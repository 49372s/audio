// グローバル変数
let socket;
let localStream;
let peerConnection;
let roomId;
let userId;
let isMuted = false;

// ICE サーバー設定 (Google の公開STUNサーバーを使用)
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// DOM要素の取得
const lobbySection = document.getElementById('lobby');
const roomSection = document.getElementById('room');
const roomInput = document.getElementById('room-input');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const muteBtn = document.getElementById('mute-btn');
const currentRoomSpan = document.getElementById('current-room');
const currentUsernameSpan = document.getElementById('current-username');
const statusDiv = document.getElementById('status');
const statusText = document.getElementById('status-text');
const participantsList = document.getElementById('participants-list');
const logDiv = document.getElementById('log');
const themeToggleBtn = document.getElementById('theme-toggle');

// テーマ管理
let isDarkMode = localStorage.getItem('darkMode') === 'true';

// テーマを適用
function applyTheme() {
  if (isDarkMode) {
    document.body.classList.add('dark-mode');
    themeToggleBtn.textContent = '☀️';
    themeToggleBtn.title = 'ライトモードに切り替え';
  } else {
    document.body.classList.remove('dark-mode');
    themeToggleBtn.textContent = '🌙';
    themeToggleBtn.title = 'ダークモードに切り替え';
  }
  localStorage.setItem('darkMode', isDarkMode);
}

// テーマ切り替えボタン
themeToggleBtn.addEventListener('click', () => {
  isDarkMode = !isDarkMode;
  applyTheme();
  addLog(`${isDarkMode ? 'ダーク' : 'ライト'}モードに切り替えました`, 'info');
});

// 初期テーマを適用
applyTheme();

// ログ出力関数
function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('ja-JP');
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry log-${type}`;
  logEntry.textContent = `[${timestamp}] ${message}`;
  logDiv.appendChild(logEntry);
  logDiv.scrollTop = logDiv.scrollHeight;
}

// ステータス更新
function updateStatus(text, isConnected) {
  statusText.textContent = text;
  statusDiv.className = isConnected ? 'status-connected' : 'status-disconnected';
}

// 参加ボタンのクリックイベント
joinBtn.addEventListener('click', async () => {
  roomId = roomInput.value.trim();
  userId = usernameInput.value.trim() || `User${Math.floor(Math.random() * 1000)}`;

  if (!roomId) {
    alert('ルームIDを入力してください');
    return;
  }

  try {
    // マイクへのアクセス許可を取得
    addLog('マイクへのアクセスを要求中...');
    localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: true, 
      video: false 
    });
    
    addLog('マイクへのアクセスが許可されました', 'success');
    
    // Socket.io接続
    socket = io();
    
    socket.on('connect', () => {
      addLog('サーバーに接続しました', 'success');
      socket.emit('join-room', roomId, userId);
      
      lobbySection.classList.add('hidden');
      roomSection.classList.remove('hidden');
      currentRoomSpan.textContent = roomId;
      currentUsernameSpan.textContent = userId;
      updateStatus('ルームに参加しました', true);
    });

    // 新しいユーザーが接続した時
    socket.on('user-connected', async (newUserId) => {
      addLog(`${newUserId} が参加しました`, 'success');
      
      // PeerConnectionを作成してofferを送信
      await createPeerConnection(newUserId);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('offer', roomId, offer, userId);
    });

    // ユーザーが切断した時
    socket.on('user-disconnected', (disconnectedUserId) => {
      addLog(`${disconnectedUserId} が退出しました`, 'warning');
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      updateStatus('待機中...', false);
    });

    // offerを受信した時
    socket.on('offer', async (offer, remoteUserId) => {
      addLog(`${remoteUserId} からのオファーを受信`, 'info');
      
      await createPeerConnection(remoteUserId);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('answer', roomId, answer, userId);
    });

    // answerを受信した時
    socket.on('answer', async (answer, remoteUserId) => {
      addLog(`${remoteUserId} からの応答を受信`, 'info');
      
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        updateStatus(`${remoteUserId} と通話中`, true);
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

  } catch (error) {
    console.error('エラー:', error);
    addLog(`エラー: ${error.message}`, 'error');
    alert('マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
  }
});

// PeerConnection作成
async function createPeerConnection(remoteUserId) {
  peerConnection = new RTCPeerConnection(iceServers);

  // ローカルストリームの各トラックを追加
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // リモートストリーム受信時の処理
  peerConnection.ontrack = (event) => {
    addLog('リモート音声ストリームを受信', 'success');
    const remoteAudio = new Audio();
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.play().catch(e => {
      addLog('音声再生エラー: ユーザー操作が必要な場合があります', 'warning');
    });
    updateStatus(`${remoteUserId} と通話中`, true);
  };

  // ICE candidate生成時の処理
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', roomId, event.candidate, userId);
    }
  };

  // 接続状態の監視
  peerConnection.onconnectionstatechange = () => {
    addLog(`接続状態: ${peerConnection.connectionState}`, 'info');
    
    if (peerConnection.connectionState === 'connected') {
      updateStatus(`${remoteUserId} と通話中`, true);
    } else if (peerConnection.connectionState === 'disconnected' || 
               peerConnection.connectionState === 'failed') {
      updateStatus('接続が切断されました', false);
    }
  };
}

// ミュートボタン
muteBtn.addEventListener('click', () => {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      isMuted = !isMuted;
      audioTrack.enabled = !isMuted;
      
      if (isMuted) {
        muteBtn.classList.add('muted');
        muteBtn.querySelector('.icon').textContent = '🔇';
        muteBtn.querySelector('.label').textContent = 'ミュート中';
        addLog('マイクをミュートしました', 'info');
      } else {
        muteBtn.classList.remove('muted');
        muteBtn.querySelector('.icon').textContent = '🎤';
        muteBtn.querySelector('.label').textContent = 'ミュート';
        addLog('マイクのミュートを解除しました', 'info');
      }
    }
  }
});

// 退出ボタン
leaveBtn.addEventListener('click', () => {
  leaveRoom();
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

  roomSection.classList.add('hidden');
  lobbySection.classList.remove('hidden');
  
  addLog('ルームから退出しました', 'warning');
  isMuted = false;
  muteBtn.classList.remove('muted');
  muteBtn.querySelector('.icon').textContent = '🎤';
  muteBtn.querySelector('.label').textContent = 'ミュート';
}

// ページを離れる前の警告
window.addEventListener('beforeunload', (e) => {
  if (socket && socket.connected) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// 初期ログ
addLog('WebRTC音声通話アプリケーションを起動しました', 'success');
