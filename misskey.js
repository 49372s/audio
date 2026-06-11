const axios = require('axios');

// Misskey設定
const MISSKEY_DOMAIN = process.env.MISSKEY_DOMAIN || 'freeski.msnis.net';
const MISSKEY_MIAUTH_DOMAIN = process.env.MISSKEY_MIAUTH_DOMAIN || 'miauth.thsvs.com';

/**
 * Misskey APIでトークンを検証
 * @param {string} token - Misskeyアクセストークン
 * @returns {Promise<{valid: boolean, user: object|null, error: string|null}>}
 */
async function verifyMisskeyToken(token) {
  if (!token || token.trim().length === 0) {
    return { valid: false, user: null, error: 'Token is empty' };
  }

  try {
    const response = await axios.post(
      `https://${MISSKEY_DOMAIN}/api/i`,
      { i: token },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      }
    );

    if (response.data && response.data.id) {
      return {
        valid: true,
        user: {
          id: response.data.id,
          username: response.data.username,
          name: response.data.name || response.data.username,
          avatarUrl: response.data.avatarUrl
        },
        error: null
      };
    }

    return { valid: false, user: null, error: 'Invalid response from Misskey' };
  } catch (error) {
    console.error('Misskey トークン検証エラー:', error.message);
    return { 
      valid: false, 
      user: null, 
      error: error.response?.data?.error?.message || error.message 
    };
  }
}

/**
 * MiAuth連携用のURLを生成
 * miauth.thsvs.comがKeycloakと直接連携し、misskeyToken属性を設定する
 * @param {string} userId - KeycloakユーザーID（セッション識別用）
 * @returns {string} MiAuth連携URL
 */
function generateMiAuthUrl(userId) {
  const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3367';
  const sessionId = `audio-chat-${userId}`;
  
  const params = new URLSearchParams({
    name: 'WebRTC Audio Chat',
    callback: `${appBaseUrl}/rooms.html`,
    permission: 'read:account,write:notes'
  });

  return `https://${MISSKEY_MIAUTH_DOMAIN}/${sessionId}?${params.toString()}`;
}

/**
 * MiAuthセッションからトークンを取得
 * @param {string} sessionId - セッションID
 * @returns {Promise<{ok: boolean, token: string|null, user: object|null}>}
 */
async function checkMiAuthSession(sessionId) {
  try {
    const response = await axios.post(
      `https://${MISSKEY_DOMAIN}/api/miauth/${sessionId}/check`,
      {},
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      }
    );

    if (response.data && response.data.ok && response.data.token) {
      // トークンを検証してユーザー情報も取得
      const verification = await verifyMisskeyToken(response.data.token);
      
      return {
        ok: true,
        token: response.data.token,
        user: verification.user
      };
    }

    return { ok: false, token: null, user: null };
  } catch (error) {
    console.error('MiAuth セッションチェックエラー:', error.message);
    return { ok: false, token: null, user: null };
  }
}

module.exports = {
  verifyMisskeyToken,
  generateMiAuthUrl,
  checkMiAuthSession,
  MISSKEY_DOMAIN,
  MISSKEY_MIAUTH_DOMAIN
};
