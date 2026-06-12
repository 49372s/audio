const express = require('express');
const session = require('express-session');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const axios = require('axios');

// 認証とデータベース
const { config, sessionConfig, keycloak, requireAuth, requireApiAuth } = require('./auth');
const { roomOps, participantOps, chatOps, cleanupOldRooms } = require('./database');
const { verifyMisskeyToken, generateMiAuthUrl } = require('./misskey');

const PORT = config.server.port || 3367;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// アップロードディレクトリ作成
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function resolveUploadFilePath(content) {
  if (typeof content !== 'string' || !content.startsWith('/uploads/')) {
    return null;
  }

  const normalizedPath = path.posix.normalize(content);
  if (!normalizedPath.startsWith('/uploads/')) {
    return null;
  }

  const fileName = path.posix.basename(normalizedPath);
  if (!fileName || fileName === '.' || fileName === '..') {
    return null;
  }

  return path.join(UPLOAD_DIR, fileName);
}

// ルーム削除処理（画像とDBデータをクリーンアップ）
function deleteRoomWithCleanup(roomId) {
  try {
    console.log(`ルーム ${roomId} を削除中...`);
    
    // チャット履歴を取得し、そのルームの画像だけを個別に検査して削除
    const messages = chatOps.getByRoom.all(roomId, 10000);
    let deletedImages = 0;
    const processedContents = new Set();
    
    messages.forEach(msg => {
      if (msg.message_type !== 'image' || processedContents.has(msg.content)) {
        return;
      }

      processedContents.add(msg.content);

      const filePath = resolveUploadFilePath(msg.content);
      if (!filePath) {
        console.warn(`画像メッセージのパス形式が不正のため削除をスキップ: ${msg.content}`);
        return;
      }

      const otherRoomRefs = chatOps.countImageRefsInOtherRooms.get(roomId, msg.content);
      if (otherRoomRefs && otherRoomRefs.count > 0) {
        console.log(`画像ファイルは別ルームでも参照中のため削除をスキップ: ${msg.content}`);
        return;
      }

      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedImages++;
        }
      } catch (err) {
        console.error(`画像ファイル削除エラー (${filePath}):`, err.message);
      }
    });
    
    // DBからチャットメッセージ削除
    const deletedMessages = chatOps.deleteByRoom.run(roomId);
    
    // DBから参加者削除（CASCADEで自動削除されるが明示的に実行）
    const participants = participantOps.getByRoom.all(roomId);
    participants.forEach(p => {
      participantOps.removeBySocket.run(p.socket_id);
    });
    
    // DBからルーム削除
    roomOps.delete.run(roomId);
    
    console.log(`ルーム ${roomId} を削除完了: 画像${deletedImages}件, メッセージ${messages.length}件, 参加者${participants.length}人`);
    
    return true;
  } catch (error) {
    console.error(`ルーム削除エラー (${roomId}):`, error);
    return false;
  }
}

// 定期クリーンアップ（1時間ごと）
setInterval(() => {
  try {
    const oldRooms = cleanupOldRooms();
    oldRooms.forEach(room => {
      deleteRoomWithCleanup(room.id);
    });
  } catch (error) {
    console.error('古いルームの定期クリーンアップに失敗しました:', error);
  }
}, 60 * 60 * 1000);

// プロキシ設定（リバースプロキシの背後で動作する場合に必要）
app.set('trust proxy', true);

// ミドルウェア
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session(sessionConfig));
app.use(keycloak.middleware());

// Misskey連携チェックミドルウェア
async function requireMisskeyAuth(req, res, next) {
  try {
    const token = req.kauth.grant.access_token;
    const accessTokenString = token.token;
    
    // Keycloak UserInfoエンドポイントからユーザー属性を取得
    const userInfoUrl = `${config.keycloak['auth-server-url']}/realms/${config.keycloak.realm}/protocol/openid-connect/userinfo`;
    const userInfoResponse = await axios.get(userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessTokenString}`
      }
    });
    
    const userAttributes = userInfoResponse.data;
    let misskeyToken = userAttributes.misskeyToken;
    
    // misskeyTokenがオブジェクトの場合、tokenフィールドを抽出
    if (misskeyToken && typeof misskeyToken === 'object' && misskeyToken.token) {
      misskeyToken = misskeyToken.token;
    }
    
    // デバッグ用ログ
    console.log('=== Misskey認証チェック ===');
    console.log('UserInfo URL:', userInfoUrl);
    console.log('UserInfo Response:', JSON.stringify(userAttributes, null, 2));
    console.log('ユーザー:', userAttributes.preferred_username || userAttributes.email);
    console.log('misskeyToken存在:', !!misskeyToken);
    console.log('misskeyToken値:', misskeyToken);
    
    if (!misskeyToken) {
      console.log('→ トークンなし: /misskey-required.html にリダイレクト');
      return res.redirect('/misskey-required.html');
    }
    
    // トークンの有効性を検証
    const verification = await verifyMisskeyToken(misskeyToken);
    console.log('トークン検証結果:', verification.valid ? '有効' : '無効');
    
    if (!verification.valid) {
      console.log('→ トークン無効: /misskey-required.html にリダイレクト');
      return res.redirect('/misskey-required.html');
    }
    
    // 検証済みユーザー情報をリクエストに追加
    req.misskeyUser = verification.user;
    console.log('→ 認証成功:', verification.user?.username);
    next();
  } catch (error) {
    console.error('=== Misskey認証チェックエラー ===');
    console.error('エラー詳細:', error);
    console.error('エラーメッセージ:', error.message);
    if (error.response) {
      console.error('HTTPステータス:', error.response.status);
      console.error('レスポンスデータ:', error.response.data);
    }
    res.redirect('/misskey-required.html');
  }
}

// ================== ページルーティング ==================

// ルートパスをログインページにリダイレクト
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// ログインページ（認証不要）
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ルーム一覧へのリダイレクト（認証＋Misskey連携必要）
app.get('/rooms', keycloak.protect(), requireMisskeyAuth, (req, res) => {
  res.redirect('/rooms.html');
});

// ルーム一覧ページ（認証＋Misskey連携必要）
app.get('/rooms.html', keycloak.protect(), requireMisskeyAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rooms.html'));
});

// ルームページ（認証＋Misskey連携必要）
app.get('/room.html', keycloak.protect(), requireMisskeyAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Misskey連携必須ページ（認証のみ必要）
app.get('/misskey-required.html', keycloak.protect(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'misskey-required.html'));
});

// ログアウト
app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/login.html');
});

// 静的ファイルの提供（CSS, JS, 画像など）
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOAD_DIR));

// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('許可されていないファイル形式です'));
    }
  }
});

// ================== API エンドポイント ==================

// ユーザー情報取得（Misskeyトークン検証含む）
app.get('/api/user', keycloak.protect(), async (req, res) => {
  try {
    const token = req.kauth.grant.access_token;
    const accessTokenString = token.token;
    const userId = token.content.sub;
    const userInfo = {
      id: userId,
      username: token.content.preferred_username || token.content.email,
      email: token.content.email,
      name: token.content.name || token.content.preferred_username
    };

    // Keycloak UserInfoエンドポイントからユーザー属性を取得
    const userInfoUrl = `${config.keycloak['auth-server-url']}/realms/${config.keycloak.realm}/protocol/openid-connect/userinfo`;
    const userInfoResponse = await axios.get(userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessTokenString}`
      }
    });
    
    const userAttributes = userInfoResponse.data;
    let misskeyToken = userAttributes.misskeyToken;
    
    // misskeyTokenがオブジェクトの場合、tokenフィールドを抽出
    if (misskeyToken && typeof misskeyToken === 'object' && misskeyToken.token) {
      misskeyToken = misskeyToken.token;
    }

    console.log('=== /api/user エンドポイント ===');
    console.log('UserInfo Response:', JSON.stringify(userAttributes, null, 2));
    console.log('misskeyToken存在:', !!misskeyToken);
    console.log('misskeyToken値:', misskeyToken);

    if (!misskeyToken) {
      // Misskeyトークンがない場合
      return res.json({
        ...userInfo,
        misskey: {
          connected: false,
          authUrl: generateMiAuthUrl(userId)
        }
      });
    }

    // Misskeyトークンを検証
    const verification = await verifyMisskeyToken(misskeyToken);

    if (!verification.valid) {
      // トークンが無効な場合
      return res.json({
        ...userInfo,
        misskey: {
          connected: false,
          error: verification.error,
          authUrl: generateMiAuthUrl(userId)
        }
      });
    }

    // トークンが有効な場合
    res.json({
      ...userInfo,
      name: verification.user.name,
      misskey: {
        connected: true,
        user: verification.user
      }
    });
  } catch (error) {
    console.error('=== /api/user エンドポイントエラー ===');
    console.error('エラー詳細:', error);
    console.error('エラーメッセージ:', error.message);
    if (error.response) {
      console.error('HTTPステータス:', error.response.status);
      console.error('レスポンスデータ:', error.response.data);
    }
    res.status(500).json({ error: 'ユーザー情報の取得に失敗しました' });
  }
});

// ルーム一覧取得
app.get('/api/rooms', keycloak.protect(), (req, res) => {
  try {
    const rooms = roomOps.getAll.all();
    console.log('=== ルーム一覧取得 ===');
    console.log('DB内のルーム数:', rooms.length);
    
    const roomsWithCount = rooms.map(room => {
      const count = participantOps.countByRoom.get(room.id);
      const participantCount = count ? count.count : 0;
      console.log(`ルーム: ${room.name}, 参加者数: ${participantCount}, 作成日時: ${new Date(room.created_at).toLocaleString()}`);
      return {
        ...room,
        participantCount: participantCount,
        hasPassword: !!room.password_hash
      };
    });
    
    // 0人参加中で作成から5分以上経過したルームを削除
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    roomsWithCount.forEach(room => {
      if (room.participantCount === 0 && room.created_at < fiveMinutesAgo) {
        console.log(`古いルームを削除: ${room.name} (作成: ${new Date(room.created_at).toLocaleString()})`);
        deleteRoomWithCleanup(room.id);
      }
    });
    
    // 削除されていないルームのみを返す
    const activeRooms = roomsWithCount.filter(room => {
      return !(room.participantCount === 0 && room.created_at < fiveMinutesAgo);
    });
    
    console.log('返却するアクティブルーム数:', activeRooms.length);
    res.json(activeRooms);
  } catch (error) {
    console.error('ルーム一覧取得エラー:', error);
    res.status(500).json({ error: 'ルーム一覧の取得に失敗しました' });
  }
});

// ルーム作成
app.post('/api/rooms', keycloak.protect(), async (req, res) => {
  try {
    const token = req.kauth.grant.access_token;
    const accessTokenString = token.token;
    const userId = token.content.sub;
    
    // デフォルトのユーザー情報（Keycloakトークンから）
    let userName = token.content.name || token.content.preferred_username || token.content.email;
    
    // Misskeyと連携している場合は、Misskeyのユーザー名を使用
    try {
      const userInfoUrl = `${config.keycloak['auth-server-url']}/realms/${config.keycloak.realm}/protocol/openid-connect/userinfo`;
      const userInfoResponse = await axios.get(userInfoUrl, {
        headers: {
          'Authorization': `Bearer ${accessTokenString}`
        }
      });
      
      const userAttributes = userInfoResponse.data;
      let misskeyToken = userAttributes.misskeyToken;
      
      // misskeyTokenがオブジェクトの場合、tokenフィールドを抽出
      if (misskeyToken && typeof misskeyToken === 'object' && misskeyToken.token) {
        misskeyToken = misskeyToken.token;
      }
      
      if (misskeyToken) {
        const verification = await verifyMisskeyToken(misskeyToken);
        if (verification.valid && verification.user) {
          // Misskeyの表示名を使用（nameがない場合はusernameを使用）
          userName = verification.user.name || verification.user.username;
        }
      }
    } catch (misskeyError) {
      console.warn('Misskeyユーザー情報取得エラー（デフォルト名を使用）:', misskeyError.message);
    }
    
    const { name, password } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'ルーム名は必須です' });
    }

    const roomId = uuidv4();
    const now = Date.now();
    let passwordHash = null;

    if (password && password.trim().length > 0) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    roomOps.create.run(
      roomId,
      name.trim(),
      userId,
      userName,
      passwordHash,
      now,
      now
    );

    res.json({
      id: roomId,
      name: name.trim(),
      creatorName: userName
    });
  } catch (error) {
    console.error('ルーム作成エラー:', error);
    res.status(500).json({ error: 'ルームの作成に失敗しました' });
  }
});

// ルーム詳細取得
app.get('/api/rooms/:roomId', keycloak.protect(), (req, res) => {
  try {
    const { roomId } = req.params;
    const room = roomOps.getById.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'ルームが見つかりません' });
    }

    const participants = participantOps.getByRoom.all(roomId);
    
    res.json({
      id: room.id,
      name: room.name,
      creatorName: room.creator_name,
      hasPassword: !!room.password_hash,
      participants: participants.map(p => ({
        userId: p.user_id,
        userName: p.user_name
      }))
    });
  } catch (error) {
    console.error('ルーム詳細取得エラー:', error);
    res.status(500).json({ error: 'ルーム詳細の取得に失敗しました' });
  }
});

// ルームパスワード検証
app.post('/api/rooms/:roomId/verify-password', keycloak.protect(), async (req, res) => {
  try {
    const { roomId } = req.params;
    const { password } = req.body;

    const room = roomOps.getById.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'ルームが見つかりません' });
    }

    if (!room.password_hash) {
      return res.json({ valid: true });
    }

    const valid = await bcrypt.compare(password || '', room.password_hash);
    res.json({ valid });
  } catch (error) {
    console.error('パスワード検証エラー:', error);
    res.status(500).json({ error: 'パスワード検証に失敗しました' });
  }
});

// チャット履歴取得
app.get('/api/rooms/:roomId/messages', keycloak.protect(), (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    const messages = chatOps.getByRoom.all(roomId, limit);
    res.json(messages.reverse());
  } catch (error) {
    console.error('メッセージ取得エラー:', error);
    res.status(500).json({ error: 'メッセージの取得に失敗しました' });
  }
});

// 画像アップロード
app.post('/api/upload', keycloak.protect(), upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'ファイルがアップロードされていません' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({
      url: fileUrl,
      filename: req.file.filename
    });
  } catch (error) {
    console.error('画像アップロードエラー:', error);
    res.status(500).json({ error: '画像のアップロードに失敗しました' });
  }
});

// ルーム削除（作成者のみ）
app.delete('/api/rooms/:roomId', keycloak.protect(), (req, res) => {
  try {
    const token = req.kauth.grant.access_token;
    const userId = token.content.sub;
    const { roomId } = req.params;

    const room = roomOps.getById.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'ルームが見つかりません' });
    }

    if (room.creator_id !== userId) {
      return res.status(403).json({ error: 'ルームを削除する権限がありません' });
    }

    // ルーム削除（画像とDBデータもクリーンアップ）
    deleteRoomWithCleanup(roomId);

    // ルーム内の全員に通知
    io.to(roomId).emit('room-closed');

    res.json({ message: 'ルームを削除しました' });
  } catch (error) {
    console.error('ルーム削除エラー:', error);
    res.status(500).json({ error: 'ルームの削除に失敗しました' });
  }
});

// ================== Socket.IO ==================

// Socket.IO認証ミドルウェア
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const userId = socket.handshake.auth.userId;
  const userName = socket.handshake.auth.userName;
  const avatarUrl = socket.handshake.auth.avatarUrl || '';

  if (!userId || !userName) {
    return next(new Error('認証情報が不足しています'));
  }

  socket.userId = userId;
  socket.userName = userName;
  socket.avatarUrl = avatarUrl;
  next();
});

io.on('connection', (socket) => {
  console.log('新しいクライアントが接続しました:', socket.userId);

  // ルームに参加
  socket.on('join-room', async (roomId, password, callback) => {
    try {
      const room = roomOps.getById.get(roomId);

      if (!room) {
        return callback({ error: 'ルームが見つかりません' });
      }

      // パスワード確認
      if (room.password_hash) {
        const valid = await bcrypt.compare(password || '', room.password_hash);
        if (!valid) {
          return callback({ error: 'パスワードが正しくありません' });
        }
      }

      socket.join(roomId);
      socket.currentRoomId = roomId;

      // 参加者追加
      participantOps.add.run(
        socket.id,
        roomId,
        socket.userId,
        socket.userName,
        socket.avatarUrl,
        Date.now()
      );

      // 最終アクティビティ更新
      roomOps.updateActivity.run(Date.now(), roomId);

      console.log(`ユーザー ${socket.userName} がルーム ${roomId} に参加しました`);

      // 既に部屋にいる他のユーザーに通知
      socket.to(roomId).emit('user-connected', socket.userId, socket.userName, socket.avatarUrl);

      // 現在の参加者リスト送信
      const participants = participantOps.getByRoom.all(roomId);
      callback({ 
        success: true,
        participants: participants.map(p => ({
          userId: p.user_id,
          userName: p.user_name,
          avatarUrl: p.avatar_url
        }))
      });

    } catch (error) {
      console.error('ルーム参加エラー:', error);
      callback({ error: 'ルームへの参加に失敗しました' });
    }
  });

  // WebRTCシグナリング: offer
  socket.on('offer', (roomId, offer) => {
    socket.to(roomId).emit('offer', offer, socket.userId);
  });

  // WebRTCシグナリング: answer
  socket.on('answer', (roomId, answer) => {
    socket.to(roomId).emit('answer', answer, socket.userId);
  });

  // WebRTCシグナリング: ice-candidate
  socket.on('ice-candidate', (roomId, candidate) => {
    socket.to(roomId).emit('ice-candidate', candidate, socket.userId);
  });

  // チャットメッセージ
  socket.on('chat-message', (roomId, message) => {
    try {
      const now = Date.now();
      
      // データベースに保存
      chatOps.add.run(
        roomId,
        socket.userId,
        socket.userName,
        'text',
        message,
        now
      );

      // 最終アクティビティ更新
      roomOps.updateActivity.run(now, roomId);

      // 全員に送信
      io.to(roomId).emit('chat-message', {
        id: chatOps.add.run(roomId, socket.userId, socket.userName, 'text', message, now).lastInsertRowid,
        userId: socket.userId,
        userName: socket.userName,
        messageType: 'text',
        content: message,
        createdAt: now
      });
    } catch (error) {
      console.error('チャットメッセージエラー:', error);
    }
  });

  // 画像送信
  socket.on('chat-image', (roomId, imageUrl) => {
    try {
      const now = Date.now();
      
      // データベースに保存
      const result = chatOps.add.run(
        roomId,
        socket.userId,
        socket.userName,
        'image',
        imageUrl,
        now
      );

      // 最終アクティビティ更新
      roomOps.updateActivity.run(now, roomId);

      // 全員に送信
      io.to(roomId).emit('chat-message', {
        id: result.lastInsertRowid,
        userId: socket.userId,
        userName: socket.userName,
        messageType: 'image',
        content: imageUrl,
        createdAt: now
      });
    } catch (error) {
      console.error('画像送信エラー:', error);
    }
  });

  // 切断時の処理
  socket.on('disconnect', () => {
    console.log('クライアントが切断しました:', socket.userId);

    if (socket.currentRoomId) {
      const roomId = socket.currentRoomId;
      
      // 参加者削除
      participantOps.removeBySocket.run(socket.id);

      // 他のユーザーに通知
      socket.to(roomId).emit('user-disconnected', socket.userId);

      // 参加者が0人になったらルーム削除
      const count = participantOps.countByRoom.get(roomId);
      if (count && count.count === 0) {
        console.log(`参加者が0人になったためルーム ${roomId} を削除します`);
        deleteRoomWithCleanup(roomId);
      }
    }
  });
});

http.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
  console.log(`http://localhost:${PORT} にアクセスしてください`);
  console.log(`Keycloak: ${config.keycloak['auth-server-url']}`);
});
