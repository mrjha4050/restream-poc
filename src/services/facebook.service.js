const { config } = require('../config/env');

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
].join(',');

function graphBaseUrl() {
  return `https://graph.facebook.com/${config.facebook.graphVersion}`;
}

function ensureConfigured() {
  if (!isConfigured()) {
    throw new Error('Facebook OAuth credentials are not configured');
  }
}

async function graphRequest(path, { method = 'GET', params = {}, accessToken } = {}) {
  const url = new URL(`${graphBaseUrl()}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  if (accessToken) {
    url.searchParams.set('access_token', accessToken);
  }

  const response = await fetch(url, { method });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const message = data.error?.message || `Facebook API request failed (${response.status})`;
    const error = new Error(message);
    error.statusCode = data.error?.code === 190 ? 401 : response.status || 502;
    throw error;
  }

  return data;
}

function isConfigured() {
  return Boolean(config.facebook.appId && config.facebook.appSecret);
}

function getAuthUrl() {
  ensureConfigured();
  const url = new URL(`https://www.facebook.com/${config.facebook.graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', config.facebook.appId);
  url.searchParams.set('redirect_uri', config.facebook.redirectUri);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

async function exchangeCodeForTokens(code) {
  ensureConfigured();
  const data = await graphRequest('/oauth/access_token', {
    params: {
      client_id: config.facebook.appId,
      client_secret: config.facebook.appSecret,
      redirect_uri: config.facebook.redirectUri,
      code,
    },
  });

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || null,
  };
}

async function getUserProfile(accessToken) {
  const data = await graphRequest('/me', {
    params: { fields: 'id,name' },
    accessToken,
  });
  return { id: data.id, name: data.name };
}

async function getManagedPages(accessToken) {
  const data = await graphRequest('/me/accounts', {
    params: { fields: 'id,name,access_token' },
    accessToken,
  });

  const pages = data.data || [];
  return pages.map((page) => ({
    id: page.id,
    name: page.name,
    accessToken: page.access_token,
  }));
}

async function createLiveVideo(pageAccessToken, pageId, options = {}) {
  const params = { status: 'LIVE_NOW' };
  if (options.title) {
    params.title = options.title;
  }

  const data = await graphRequest(`/${pageId}/live_videos`, {
    method: 'POST',
    params,
    accessToken: pageAccessToken,
  });

  if (!data.secure_stream_url) {
    const error = new Error('Facebook did not return a secure stream URL');
    error.statusCode = 502;
    throw error;
  }

  return {
    liveVideoId: data.id,
    secureStreamUrl: data.secure_stream_url,
  };
}

async function endLiveVideo(pageAccessToken, liveVideoId) {
  await graphRequest(`/${liveVideoId}`, {
    method: 'POST',
    params: { end_live_video: true },
    accessToken: pageAccessToken,
  });
}

module.exports = {
  isConfigured,
  getAuthUrl,
  exchangeCodeForTokens,
  getUserProfile,
  getManagedPages,
  createLiveVideo,
  endLiveVideo,
};
