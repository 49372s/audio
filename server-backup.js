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

// 認証とデータベース
const { config, sessionConfig, keycloak, requireAuth, requireApiAuth } = require('./auth');
const { roomOps, participantOps, chatOps } = require('./database');

const PORT = config.server.port || 3367;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// アップロードディレクトリ作成
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ミドルウェア
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session(sessionConfig));
app.use(keycloak.middleware());

// 静的ファイルの提供
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

// ユーザー情報取得
app.get('/api/user', keycloak.protect(), (req, res) => {
  const token = req.kauth.grant.access_token;
  res.json({
    id: token.content.sub,
    username: token.content.preferred_username || token.content.email,
    email: token.content.email,
    name: token.content.name || token.content.preferred_username
  });
});

// ルーム一覧取得
app.get('/api/rooms', keycloak.protect(), (req, res) => {
  try {
    const rooms = roomOps.getAll.all();
    const roomsWithCount = rooms.map(room => {
      const count = participantOps.countByRoom.get(room.id);
      return {
        ...room,
        participantCount: count ? count.count : 0,
        hasPassword: !!room.password_hash
      };
    });
    res.json(roomsWithCount);
  } catch (error) {
    console.error('ルーム一覧取得エラー:', error);
    res.status(500).json({ error: 'ルーム一覧の取得に失敗しました' });
  }
});

// ルーム作成
app.post('/api/rooms', keycloak.protect(), async (req, res) => {
  try {
    const token = req.kauth.grant.access_token;
    const user = {
      id: token.content.sub,
      name: token.content.name || token.content.preferred_username
    };
    
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
      user.id,
      user.name,
      passwordHash,
      now,
      now
    );

    res.json({
      id: roomId,
      name: name.trim(),
      creatorName: user.name
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

    // チャットメッセージ削除
    chatOps.deleteByRoom.run(roomId);
    
    // ルーム削除
    roomOps.delete.run(roomId);

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

  if (!userId || !userName) {
    return next(new Error('認証情報が不足しています'));
  }

  socket.userId = userId;
  socket.userName = userName;
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
        roomId,
        socket.userId,
        socket.userName,
        socket.id,
        Date.now()
      );

      // 最終アクティビティ更新
      roomOps.updateActivity.run(Date.now(), roomId);

      console.log(`ユーザー ${socket.userName} がルーム ${roomId} に参加しました`);

      // 既に部屋にいる他のユーザーに通知
      socket.to(roomId).emit('user-connected', socket.userId, socket.userName);

      // 現在の参加者リスト送信
      const participants = participantOps.getByRoom.all(roomId);
      callback({ 
        success: true,
        participants: participants.map(p => ({
          userId: p.user_id,
          userName: p.user_name
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
      const result = chatOps.add.run(
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
        id: result.lastInsertRowid,
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
        // チャットメッセージと画像削除
        const messages = chatOps.getByRoom.all(roomId, 1000);
        messages.forEach(msg => {
          if (msg.message_type === 'image') {
            const filePath = path.join(__dirname, 'public', msg.content);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        });
        
        chatOps.deleteByRoom.run(roomId);
        roomOps.delete.run(roomId);
        console.log(`ルーム ${roomId} を削除しました（参加者0人）`);
      }
    }
  });
});

http.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
  console.log(`http://localhost:${PORT} にアクセスしてください`);
  console.log(`Keycloak: ${config.keycloak['auth-server-url']}`);
});
