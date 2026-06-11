const Database = require('better-sqlite3');
const path = require('path');

// データベース初期化
const db = new Database(path.join(__dirname, 'audio-chat.db'));

// テーブル作成
db.exec(`
  -- ルームテーブル
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    creator_name TEXT NOT NULL,
    password_hash TEXT,
    created_at INTEGER NOT NULL,
    last_activity INTEGER NOT NULL
  );

  -- ルーム参加者テーブル
  CREATE TABLE IF NOT EXISTS room_participants (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    socket_id TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  -- チャットメッセージテーブル
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    message_type TEXT NOT NULL CHECK(message_type IN ('text', 'image')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  -- インデックス作成
  CREATE INDEX IF NOT EXISTS idx_rooms_creator ON rooms(creator_id);
  CREATE INDEX IF NOT EXISTS idx_rooms_last_activity ON rooms(last_activity);
  CREATE INDEX IF NOT EXISTS idx_room_participants_room ON room_participants(room_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
`);

// ルーム操作
const roomOps = {
  // ルーム作成
  create: db.prepare(`
    INSERT INTO rooms (id, name, creator_id, creator_name, password_hash, created_at, last_activity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  // ルーム取得
  getById: db.prepare('SELECT * FROM rooms WHERE id = ?'),
  
  // 全ルーム取得（アクティブな順）
  getAll: db.prepare('SELECT id, name, creator_name, created_at, last_activity FROM rooms ORDER BY last_activity DESC'),
  
  // ルーム削除
  delete: db.prepare('DELETE FROM rooms WHERE id = ?'),
  
  // 最終アクティビティ更新
  updateActivity: db.prepare('UPDATE rooms SET last_activity = ? WHERE id = ?'),

  // 参加者数取得
  getParticipantCount: db.prepare('SELECT COUNT(*) as count FROM room_participants WHERE room_id = ?')
};

// 参加者操作
const participantOps = {
  // 参加者追加
  add: db.prepare(`
    INSERT OR REPLACE INTO room_participants (room_id, user_id, user_name, socket_id, joined_at)
    VALUES (?, ?, ?, ?, ?)
  `),

  // 参加者削除
  remove: db.prepare('DELETE FROM room_participants WHERE room_id = ? AND user_id = ?'),
  
  // ソケットIDで削除
  removeBySocket: db.prepare('DELETE FROM room_participants WHERE socket_id = ?'),
  
  // ルームの参加者取得
  getByRoom: db.prepare('SELECT * FROM room_participants WHERE room_id = ?'),
  
  // ルームの参加者数
  countByRoom: db.prepare('SELECT COUNT(*) as count FROM room_participants WHERE room_id = ?')
};

// チャット操作
const chatOps = {
  // メッセージ追加
  add: db.prepare(`
    INSERT INTO chat_messages (room_id, user_id, user_name, message_type, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  // ルームのメッセージ取得
  getByRoom: db.prepare(`
    SELECT * FROM chat_messages 
    WHERE room_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `),
  
  // ルームのメッセージ削除
  deleteByRoom: db.prepare('DELETE FROM chat_messages WHERE room_id = ?')
};

// 古いルームのクリーンアップ（24時間以上アクティビティなし）
function cleanupOldRooms() {
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const oldRooms = db.prepare('SELECT id FROM rooms WHERE last_activity < ?').all(oneDayAgo);
  
  for (const room of oldRooms) {
    roomOps.delete.run(room.id);
    console.log(`クリーンアップ: ルーム ${room.id} を削除しました`);
  }
}

// 定期クリーンアップ（1時間ごと）
setInterval(cleanupOldRooms, 60 * 60 * 1000);

module.exports = {
  db,
  roomOps,
  participantOps,
  chatOps,
  cleanupOldRooms
};
