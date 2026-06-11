const session = require('express-session');
const Keycloak = require('keycloak-connect');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

// 設定読み込み
let config;
try {
  // .envファイルがあれば読み込み
  if (fs.existsSync(path.join(__dirname, '.env'))) {
    require('dotenv').config();
    config = {
      keycloak: {
        realm: process.env.KEYCLOAK_REALM || 'master',
        'auth-server-url': process.env.KEYCLOAK_AUTH_SERVER_URL || 'https://auth.msnic.jp',
        'ssl-required': 'external',
        resource: process.env.KEYCLOAK_CLIENT_ID || 'audio-chat-client',
        'public-client': false,
        credentials: {
          secret: process.env.KEYCLOAK_CLIENT_SECRET || 'YOUR_CLIENT_SECRET_HERE'
        },
        'confidential-port': 0
      },
      server: {
        'session-secret': process.env.SESSION_SECRET || 'change-this-secret',
        port: process.env.PORT || 3367,
        'base-url': process.env.APP_BASE_URL || ''
      }
    };
  } else {
    // config.yamlから読み込み
    const configFile = fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8');
    config = yaml.load(configFile);
  }
} catch (error) {
  console.error('設定ファイルの読み込みエラー:', error);
  process.exit(1);
}

// セッションストア
const memoryStore = new session.MemoryStore();

// セッション設定
const sessionConfig = {
  secret: config.server['session-secret'],
  resave: false,
  saveUninitialized: true,
  store: memoryStore,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24時間
    secure: config.server['base-url'] && config.server['base-url'].startsWith('https'), // HTTPSの場合true
    httpOnly: true,
    sameSite: 'lax'
  }
};

// Keycloak初期化
const keycloak = new Keycloak({ store: memoryStore }, config.keycloak);

// 認証チェックミドルウェア
function requireAuth(req, res, next) {
  if (req.kauth && req.kauth.grant) {
    // ユーザー情報を取得
    const token = req.kauth.grant.access_token;
    req.user = {
      id: token.content.sub,
      username: token.content.preferred_username || token.content.email,
      email: token.content.email,
      name: token.content.name || token.content.preferred_username
    };
    next();
  } else {
    res.status(401).json({ error: '認証が必要です' });
  }
}

// API用の認証チェック
function requireApiAuth(req, res, next) {
  if (req.kauth && req.kauth.grant) {
    const token = req.kauth.grant.access_token;
    req.user = {
      id: token.content.sub,
      username: token.content.preferred_username || token.content.email,
      email: token.content.email,
      name: token.content.name || token.content.preferred_username
    };
    next();
  } else {
    res.status(401).json({ error: '認証が必要です' });
  }
}

module.exports = {
  config,
  sessionConfig,
  keycloak,
  requireAuth,
  requireApiAuth,
  memoryStore
};
