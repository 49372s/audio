# 🎙️ MSNIC WEB CHATサービス (エンタープライズ版)

Keycloak SSO認証、ルーム管理、チャット機能を備えた本格的なWebRTC音声通話サービスです。

## ✨ 主な機能

### 🔐 認証・セキュリティ
- **Keycloak SSO統合** - auth.msnic.jpでシングルサインオン
- **ルームパスワード** - パスワードで保護されたプライベートルーム
- **セッション管理** - 安全なユーザーセッション管理

### 🏠 ルーム管理
- **ルーム作成・削除** - 簡単にルームを作成・管理
- **ルーム一覧** - アクティブなルームをリアルタイム表示
- **ルーム共有** - URLで簡単にルームを共有
- **自動クリーンアップ** - 24時間使用されていないルームを自動削除

### 🎤 音声通話
- **リアルタイムP2P通話** - WebRTCによる高品質音声通話
- **ミュート機能** - ワンクリックでマイクをミュート
- **参加者表示** - 現在の参加者をリアルタイム表示
- **接続状態表示** - 通話状態をビジュアル表示

### 💬 チャット機能
- **テキストチャット** - ルーム内でテキストメッセージ送信
- **画像共有** - 画像をアップロードして共有（最大10MB）
- **チャット履歴** - ルーム参加時に過去のメッセージを読み込み
- **自動削除** - ルーム削除時にチャット履歴も自動削除

### 🎨 UI/UX
- **ライト/ダークモード** - 目に優しいテーマ切り替え
- **レスポンシブデザイン** - PC・タブレット・スマートフォン対応
- **リアルタイム更新** - 参加者やメッセージのリアルタイム同期

## 🛠️ 技術スタック

### フロントエンド
- HTML5, CSS3, JavaScript (Vanilla)
- WebRTC API (PeerConnection)
- Socket.io Client

### バックエンド
- Node.js + Express
- Socket.io Server
- Keycloak Connect
- Better-SQLite3 (データベース)
- Multer (ファイルアップロード)
- Bcrypt (パスワードハッシュ化)

### インフラ
- SQLite (ルーム・チャット管理)
- ローカルファイルシステム (画像保存)
- Google STUN Server (WebRTC接続)

## 📋 必要条件

- **Node.js** v16以降
- **npm** v7以降
- **Keycloak サーバー** (auth.msnic.jp)
- **HTTPS環境** (本番環境の場合)

## 🚀 セットアップ手順

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 設定ファイルの作成

`.env` ファイルを作成（または `config.yaml` を編集）:

```bash
cp .env.example .env
```

`.env` ファイルを編集:

```env
# Keycloak設定
KEYCLOAK_REALM=master
KEYCLOAK_AUTH_SERVER_URL=https://auth.msnic.jp
KEYCLOAK_CLIENT_ID=audio-chat-client
KEYCLOAK_CLIENT_SECRET=YOUR_CLIENT_SECRET_HERE

# サーバー設定
PORT=3367
SESSION_SECRET=your-random-secret-key-here

# ファイルアップロード設定
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760
```

**重要:** `KEYCLOAK_CLIENT_SECRET` と `SESSION_SECRET` を必ず変更してください。

### 3. Keycloak クライアント設定

Keycloak管理画面で以下を設定:

1. 新しいクライアント `audio-chat-client` を作成
2. **Access Type**: `confidential`
3. **Valid Redirect URIs**: `http://localhost:3367/*`, `https://yourdomain.com/*`
4. **Credentials** タブから **Secret** をコピーして `.env` に設定

### 4. サーバーの起動

```bash
npm start
```

サーバーは `http://localhost:3367` で起動します。

### 5. ブラウザでアクセス

1. `http://localhost:3367/login.html` にアクセス
2. Keycloakでログイン
3. ルーム一覧が表示されます

## 📖 使用方法

### ルームの作成

1. ルーム一覧ページで「新しいルームを作成」セクションへ
2. ルーム名を入力（必須）
3. パスワードを入力（任意）
4. 「ルームを作成」ボタンをクリック

### ルームへの参加

1. ルーム一覧から参加したいルームを選択
2. パスワード保護されている場合はパスワードを入力
3. 「参加」ボタンをクリック
4. マイクへのアクセスを許可

### ルームの共有

1. ルームカードの「共有」ボタンをクリック
2. 表示されたURLをコピー
3. URLを共有したい相手に送信

### チャット機能

- **テキスト送信**: メッセージを入力して送信ボタンまたはEnterキー
- **画像送信**: 🖼️ ボタンをクリックして画像を選択
- **画像表示**: チャット内の画像をクリックで拡大表示

### 音声通話操作

- **ミュート**: マイクボタンでミュート/ミュート解除
- **退出**: 📞ボタンでルームから退出

## 📁 プロジェクト構造

```
audio/
├── server.js              # メインサーバー
├── auth.js                # Keycloak認証ミドルウェア
├── database.js            # SQLiteデータベース管理
├── config.yaml            # 設定ファイル (YAML形式)
├── .env.example           # 環境変数テンプレート
├── package.json           # プロジェクト設定
├── audio-chat.db          # SQLiteデータベース (自動生成)
├── uploads/               # アップロードされた画像 (自動生成)
└── public/                # クライアント側ファイル
    ├── login.html         # ログインページ
    ├── rooms.html         # ルーム一覧ページ
    ├── room.html          # 通話ルームページ
    ├── style.css          # 共通スタイル
    ├── rooms.css          # ルーム一覧スタイル
    ├── room.css           # ルームページスタイル
    ├── rooms.js           # ルーム一覧ロジック
    └── room.js            # ルームページロジック
```

## 🔧 設定

### ポート番号の変更

```bash
PORT=8080 npm start
```

または `.env` ファイルで設定:

```env
PORT=8080
```

### 画像アップロードの制限

`.env` ファイルで設定:

```env
MAX_FILE_SIZE=10485760  # 10MB (バイト単位)
```

### データベースのクリーンアップ

24時間以上アクティビティがないルームは自動的に削除されます。
間隔を変更する場合は `database.js` の `setInterval` を編集してください。

## 🌐 本番環境への展開

### HTTPSの設定

WebRTCは本番環境でHTTPSが必須です。

**Nginxの設定例:**

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3367;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 環境変数

```bash
NODE_ENV=production
PORT=3367
SESSION_SECRET=your-strong-random-secret
KEYCLOAK_CLIENT_SECRET=your-keycloak-secret
```

### プロセス管理

PM2を使用した起動:

```bash
npm install -g pm2
pm2 start server.js --name audio-chat
pm2 save
pm2 startup
```

## 🔍 トラブルシューティング

### Keycloak認証エラー

- Keycloakクライアント設定を確認
- `KEYCLOAK_CLIENT_SECRET` が正しいか確認
- Redirect URIが正しく設定されているか確認

### マイクが使えない

- ブラウザの設定でマイクへのアクセスを許可
- HTTPSまたはlocalhostでアクセスしているか確認
- 別のアプリケーションがマイクを使用していないか確認

### 音声が聞こえない

- スピーカー/ヘッドフォンの音量を確認
- 相手がミュートしていないか確認
- ブラウザのコンソールでエラーを確認

### ルームに参加できない

- ルームIDが正しいか確認
- パスワードが正しいか確認
- ルームがまだ存在するか確認（24時間で自動削除）

### 画像アップロードエラー

- ファイルサイズが10MB以下か確認
- 対応形式（JPEG, PNG, GIF, WebP）か確認
- `uploads/` ディレクトリの書き込み権限を確認

## 📝 API エンドポイント

すべてのAPIエンドポイントはKeycloak認証が必要です。

- `GET /api/user` - ユーザー情報取得
- `GET /api/rooms` - ルーム一覧取得
- `POST /api/rooms` - ルーム作成
- `GET /api/rooms/:roomId` - ルーム詳細取得
- `POST /api/rooms/:roomId/verify-password` - パスワード検証
- `GET /api/rooms/:roomId/messages` - チャット履歴取得
- `POST /api/upload` - 画像アップロード
- `DELETE /api/rooms/:roomId` - ルーム削除（作成者のみ）

## 🎨 カラーテーマ

### ライトモード
- メインカラー: #82ABA1
- ボタン背景: #94FBAB
- リンク色: #A9FFF7

### ダークモード
- メインカラー: #2d5450
- ボタン背景: #2d5440
- リンク色: #305055

## 🤝 開発

### 依存関係の追加

```bash
npm install package-name
```

### データベーススキーマの変更

`database.js` の `db.exec()` 内のSQLを編集してください。
変更後、データベースファイルを削除して再起動すると再作成されます。

```bash
rm audio-chat.db
npm start
```

## 📜 ライセンス

MIT License

## 🙏 謝辞

- WebRTC API
- Socket.io
- Keycloak
- Google Public STUN Servers
- Better-SQLite3

---

**開発者向けメモ:**
- Keycloakサーバーは `auth.msnic.jp` で動作している必要があります
- 本番環境ではHTTPS必須
- セッションシークレットは必ず変更してください
- 画像ファイルはローカルに保存されるため、ストレージ容量に注意してください

### HTTPSが必要

WebRTCはセキュリティ上の理由から、本番環境ではHTTPS接続が必須です。

### おすすめの展開方法

- **Heroku**: `Procfile` を追加して簡単にデプロイ可能
- **Vercel**: Node.jsアプリケーションとして展開
- **自前サーバー**: Nginx + Let's Encrypt でHTTPS化

### 環境変数

本番環境では以下の環境変数を設定してください：

```bash
PORT=3367
NODE_ENV=production
```

## ⚠️ 既知の制限事項

- **2者間通話のみ**: 現在の実装は1対1の通話のみをサポートしています
- **シンプルなシグナリング**: 複雑なネットワーク環境ではTURNサーバーが必要な場合があります
- **録音機能なし**: 通話の録音機能は実装されていません

## 🔍 トラブルシューティング

### マイクが使えない

- ブラウザの設定でマイクへのアクセスを許可しているか確認
- HTTPSまたはlocalhostでアクセスしているか確認
- 別のアプリケーションがマイクを使用していないか確認

### 接続できない

- 両方のユーザーが同じルームIDを使用しているか確認
- ファイアウォールがWebSocket接続をブロックしていないか確認
- ブラウザのコンソールでエラーメッセージを確認

### 音声が聞こえない

- 相手がミュートしていないか確認
- スピーカー/ヘッドフォンの音量を確認
- ブラウザのコンソールで「音声再生エラー」を確認し、ページをクリックしてから再試行

## 🤝 開発

### 開発モードでの実行

```bash
npm run dev
```

### コードの修正

- `server.js`: サーバー側のロジック
- `public/app.js`: WebRTC接続ロジック
- `public/index.html`: UI構造
- `public/style.css`: デザイン

## 📝 ライセンス

MIT License

## 🙏 謝辞

- WebRTC API
- Socket.io
- Google Public STUN Servers

---

質問や問題がある場合は、Issuesを作成してください。
