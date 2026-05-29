const { google } = require('googleapis');
const { config } = require('../config/env');

function createOAuth2Client() {
  if (!config.google.clientId || !config.google.clientSecret) {
    throw new Error('Google OAuth credentials are not configured');
  }

  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

function getAuthUrl() {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.readonly'],
    prompt: 'consent',
  });
}

async function exchangeCodeForTokens(code) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

async function getUserEmail(tokens) {
  const client = createOAuth2Client();
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const info = await oauth2.userinfo.get();
  return info.data.email;
}

async function fetchLiveStreamKey(tokens) {
  const client = createOAuth2Client();
  client.setCredentials(tokens);
  const youtube = google.youtube({ version: 'v3', auth: client });

  const streamsRes = await youtube.liveStreams.list({
    part: ['cdn'],
    mine: true,
    maxResults: 1,
  });

  const items = streamsRes.data.items;
  if (!items || items.length === 0) {
    const error = new Error(
      'No YouTube live stream found. Create one in YouTube Studio first.'
    );
    error.statusCode = 404;
    throw error;
  }

  return items[0].cdn.ingestionInfo.streamName;
}

function isConfigured() {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

module.exports = {
  createOAuth2Client,
  getAuthUrl,
  exchangeCodeForTokens,
  getUserEmail,
  fetchLiveStreamKey,
  isConfigured,
};
