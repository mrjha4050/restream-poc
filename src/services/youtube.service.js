const { google } = require('googleapis');
const { config } = require('../config/env');
const { addLog } = require('./log.service');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

function getAuthUrl() {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: OAUTH_SCOPES,
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
  return info.data.email || null;
}

function mapStreamItem(item) {
  const cdn = item.cdn || {};
  const ingestion = cdn.ingestionInfo || {};

  return {
    id: item.id,
    title: item.snippet?.title || null,
    description: item.snippet?.description || null,
    status: item.status?.streamStatus || null,
    health: item.status?.healthStatus || null,
    cdn: {
      ingestionAddress: ingestion.ingestionAddress || null,
      backupIngestionAddress: ingestion.backupIngestionAddress || null,
      streamName: ingestion.streamName || null,
      resolution: cdn.resolution || null,
      frameRate: cdn.frameRate || null,
    },
  };
}

function mapBroadcastItem(item) {
  return {
    id: item.id,
    title: item.snippet?.title || null,
    description: item.snippet?.description || null,
    privacyStatus: item.status?.privacyStatus || null,
    lifeCycleStatus: item.status?.lifeCycleStatus || null,
    recordingStatus: item.status?.recordingStatus || null,
    scheduledStartTime: item.snippet?.scheduledStartTime || null,
    actualStartTime: item.snippet?.actualStartTime || null,
    boundStreamId: item.contentDetails?.boundStreamId || null,
  };
}

const USABLE_BROADCAST_STATUSES = new Set(['created', 'ready', 'testing', 'live']);

function defaultBroadcastTitle() {
  return `Live stream ${new Date().toLocaleString('en-IN', { hour12: true })}`;
}

function isUsableBroadcast(item) {
  return USABLE_BROADCAST_STATUSES.has(item?.status?.lifeCycleStatus);
}

function pickStreamItem(items) {
  const score = (item) => {
    const status = item.status?.streamStatus;
    const isDefault = /default/i.test(item.snippet?.title || '');
    let points = 0;
    if (status === 'active') points += 100;
    else if (status === 'ready') points += 60;
    else if (status === 'created') points += 40;
    if (!isDefault) points += 15;
    return points;
  };
  return [...items].sort((a, b) => score(b) - score(a))[0];
}

function getApiErrorMessage(err) {
  const parts = err?.errors || err?.response?.data?.error?.errors || [];
  if (parts.length > 0) {
    return parts.map((e) => e.message || e.reason).filter(Boolean).join('; ');
  }
  return err?.message || String(err);
}

function isInactiveStreamError(err) {
  const text = getApiErrorMessage(err).toLowerCase();
  return text.includes('inactive') || text.includes('streaminactive');
}

async function createLiveStreamResource(youtube, title) {
  const res = await youtube.liveStreams.insert({
    part: ['snippet', 'cdn', 'status'],
    requestBody: {
      snippet: {
        title: title || 'Khareddo RTMP Stream',
      },
      cdn: {
        frameRate: '30fps',
        ingestionType: 'rtmp',
        resolution: '1080p',
      },
    },
  });
  return res.data;
}

async function createLiveBroadcastResource(youtube, { title, privacyStatus }) {
  const scheduledStart = new Date(Date.now() - 60_000).toISOString();
  const res = await youtube.liveBroadcasts.insert({
    part: ['snippet', 'status', 'contentDetails'],
    requestBody: {
      snippet: {
        title: title || defaultBroadcastTitle(),
        scheduledStartTime: scheduledStart,
      },
      status: {
        privacyStatus: privacyStatus || 'unlisted',
        selfDeclaredMadeForKids: false,
      },
      contentDetails: {
        enableAutoStart: false,
        enableAutoStop: true,
        enableDvr: true,
        enableEmbed: true,
        recordFromStart: true,
      },
    },
  });
  return res.data;
}

/**
 * Ensures a YouTube stream + live event exist (creates via API if missing),
 * binds them, and returns stream key + metadata.
 */
async function ensureYouTubeLiveSetup(tokens, options = {}) {
  const {
    createIfMissing = true,
    streamTitle,
    broadcastTitle,
    privacyStatus = 'unlisted',
  } = options;

  const youtube = getYoutubeClient(tokens);
  const autoCreated = { stream: false, broadcast: false };

  const streamsRes = await youtube.liveStreams.list({
    part: ['snippet', 'cdn', 'status'],
    mine: true,
    maxResults: 50,
  });
  let streamItems = streamsRes.data.items || [];

  const needsFresh =
    streamItems.length === 0 ||
    streamItems.every((i) => i.status?.streamStatus === 'inactive') ||
    (streamItems.length === 1 && /default/i.test(streamItems[0].snippet?.title || ''));

  if (needsFresh && createIfMissing) {
    const created = await createLiveStreamResource(
      youtube,
      streamTitle || `Khareddo Live ${new Date().toISOString()}`
    );
    streamItems = [created, ...streamItems];
    autoCreated.stream = true;
    addLog('Created fresh YouTube RTMP stream (avoids inactive default key)', 'connection', 'youtube');
  } else if (streamItems.length === 0) {
    const error = new Error(
      'No YouTube live stream found. Enable auto-setup or create one in YouTube Studio.'
    );
    error.statusCode = 404;
    throw error;
  }

  const streamItem = pickStreamItem(streamItems);
  const stream = mapStreamItem(streamItem);
  const key = stream.cdn.streamName;

  if (!key) {
    const error = new Error('YouTube stream key is missing on the live stream resource.');
    error.statusCode = 404;
    throw error;
  }

  const broadcastsRes = await youtube.liveBroadcasts.list({
    part: ['snippet', 'status', 'contentDetails'],
    mine: true,
    maxResults: 50,
  });
  const broadcasts = broadcastsRes.data.items || [];

  let broadcastItem =
    broadcasts.find((b) => b.contentDetails?.boundStreamId === streamItem.id && isUsableBroadcast(b)) ||
    broadcasts.find((b) => isUsableBroadcast(b) && !b.contentDetails?.boundStreamId) ||
    broadcasts.find((b) => isUsableBroadcast(b));

  if (!broadcastItem && createIfMissing) {
    broadcastItem = await createLiveBroadcastResource(youtube, {
      title: broadcastTitle,
      privacyStatus,
    });
    autoCreated.broadcast = true;
    addLog(`Created YouTube live event: ${broadcastItem.snippet?.title}`, 'connection', 'youtube');
  }

  if (!broadcastItem) {
    const error = new Error(
      'No usable YouTube live event found. Enable auto-setup or create a new event in Studio.'
    );
    error.statusCode = 404;
    throw error;
  }

  if (broadcastItem.contentDetails?.boundStreamId !== streamItem.id) {
    await bindBroadcastToStream(youtube, broadcastItem.id, streamItem.id);
    broadcastItem = await getBroadcastResource(youtube, broadcastItem.id);
  }

  const broadcast = mapBroadcastItem(broadcastItem);

  const rtmpUrl = buildYoutubeRtmpUrl(stream);

  return {
    key,
    rtmpUrl,
    stream,
    broadcast,
    streams: streamItems.map(mapStreamItem),
    autoCreated,
  };
}

function buildYoutubeRtmpUrl(stream) {
  const key = stream.cdn?.streamName;
  if (!key) {
    throw new Error('YouTube stream key is missing');
  }
  const base = (stream.cdn?.ingestionAddress || 'rtmp://a.rtmp.youtube.com/live2').replace(
    /\/$/,
    ''
  );
  return `${base}/${key}`;
}

async function fetchLiveStreamDetails(tokens, options = {}) {
  return ensureYouTubeLiveSetup(tokens, { createIfMissing: true, ...options });
}

async function fetchLiveStreamKey(tokens) {
  const details = await fetchLiveStreamDetails(tokens);
  return details.key;
}

function getYoutubeClient(tokens) {
  const client = createOAuth2Client();
  client.setCredentials(tokens);
  return google.youtube({ version: 'v3', auth: client });
}

async function getBroadcastResource(youtube, broadcastId) {
  const res = await youtube.liveBroadcasts.list({
    id: [broadcastId],
    part: ['snippet', 'status', 'contentDetails'],
  });
  return res.data.items?.[0] || null;
}

async function resolveBroadcastId(youtube, streamId, hintBroadcastId) {
  if (hintBroadcastId) {
    return hintBroadcastId;
  }

  const broadcastsRes = await youtube.liveBroadcasts.list({
    part: ['snippet', 'status', 'contentDetails'],
    mine: true,
    maxResults: 50,
  });
  const broadcasts = broadcastsRes.data.items || [];

  const bound = broadcasts.find((b) => b.contentDetails?.boundStreamId === streamId);
  if (bound) return bound.id;

  const ready = broadcasts.find(
    (b) =>
      b.status?.lifeCycleStatus === 'ready' ||
      b.status?.lifeCycleStatus === 'created' ||
      b.status?.lifeCycleStatus === 'testing'
  );
  if (ready) return ready.id;

  const usable = broadcasts.find((b) => isUsableBroadcast(b));
  if (usable) return usable.id;

  const error = new Error('No usable YouTube live event found.');
  error.statusCode = 404;
  throw error;
}

async function bindBroadcastToStream(youtube, broadcastId, streamId) {
  const broadcast = await getBroadcastResource(youtube, broadcastId);
  if (broadcast?.contentDetails?.boundStreamId === streamId) {
    return;
  }
  await youtube.liveBroadcasts.bind({
    id: broadcastId,
    streamId,
    part: ['id', 'contentDetails'],
  });
  addLog('YouTube broadcast bound to stream', 'connection', 'youtube');
}

async function transitionBroadcast(youtube, broadcastId, broadcastStatus) {
  try {
    await youtube.liveBroadcasts.transition({
      id: broadcastId,
      broadcastStatus,
      part: ['status'],
    });
  } catch (err) {
    const wrapped = new Error(getApiErrorMessage(err));
    wrapped.cause = err;
    wrapped.statusCode = err.code === 403 ? 403 : 502;
    throw wrapped;
  }
}

async function getStreamIngestState(youtube, streamId) {
  const res = await youtube.liveStreams.list({
    id: [streamId],
    part: ['status'],
  });
  const status = res.data.items?.[0]?.status || {};
  return {
    streamStatus: status.streamStatus || 'unknown',
    healthStatus: status.healthStatus || 'unknown',
  };
}

function isIngestReady({ streamStatus, healthStatus }) {
  if (streamStatus === 'active') return true;
  if (healthStatus === 'good' && streamStatus !== 'inactive') return true;
  return false;
}

async function waitForStreamActive(youtube, streamId, maxWaitMs = 180000) {
  const deadline = Date.now() + maxWaitMs;
  let last = { streamStatus: 'unknown', healthStatus: 'unknown' };
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    last = await getStreamIngestState(youtube, streamId);
    if (isIngestReady(last)) {
      addLog(
        `YouTube ingest ready: stream=${last.streamStatus} health=${last.healthStatus}`,
        'connection',
        'youtube'
      );
      return true;
    }
    if (attempt === 1 || attempt % 5 === 0) {
      addLog(
        `Waiting for YouTube ingest… stream=${last.streamStatus} health=${last.healthStatus}`,
        'info',
        'youtube'
      );
    }
    await sleep(3000);
  }

  addLog(
    `YouTube ingest timeout — stream=${last.streamStatus} health=${last.healthStatus}`,
    'error',
    'youtube'
  );
  return false;
}

async function getLivePipelineStatus(tokens, { streamId, broadcastId }) {
  const youtube = getYoutubeClient(tokens);
  const ingest = streamId ? await getStreamIngestState(youtube, streamId) : null;
  let broadcast = null;
  if (broadcastId) {
    const resource = await getBroadcastResource(youtube, broadcastId);
    if (resource) {
      broadcast = mapBroadcastItem(resource);
    }
  }
  return { ingest, broadcast };
}

async function transitionBroadcastWithRetry(
  youtube,
  broadcastId,
  broadcastStatus,
  { maxAttempts = 15, delayMs = 3000 } = {}
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await transitionBroadcast(youtube, broadcastId, broadcastStatus);
      return;
    } catch (err) {
      if (isInactiveStreamError(err) && attempt < maxAttempts) {
        addLog(
          `YouTube stream inactive for "${broadcastStatus}", retry ${attempt}/${maxAttempts}…`,
          'info',
          'youtube'
        );
        await sleep(delayMs);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Puts the YouTube broadcast into testing mode (required before going live).
 * FFmpeg should start pushing RTMP after this returns.
 */
async function prepareYouTubeBroadcast(tokens, { streamId, broadcastId: hintBroadcastId }) {
  const youtube = getYoutubeClient(tokens);
  const broadcastId = await resolveBroadcastId(youtube, streamId, hintBroadcastId);
  await bindBroadcastToStream(youtube, broadcastId, streamId);

  const broadcast = await getBroadcastResource(youtube, broadcastId);
  const lifeCycle = broadcast?.status?.lifeCycleStatus;

  if (lifeCycle === 'complete' || lifeCycle === 'revoked') {
    const error = new Error(
      `YouTube event is "${lifeCycle}". Create a new live event in YouTube Studio.`
    );
    error.statusCode = 409;
    throw error;
  }

  if (lifeCycle === 'live') {
    addLog('YouTube broadcast already live', 'connection', 'youtube');
    return { broadcastId, lifeCycleStatus: 'live', alreadyLive: true };
  }

  if (lifeCycle === 'ready' || lifeCycle === 'created') {
    try {
      await transitionBroadcast(youtube, broadcastId, 'testing');
      addLog('YouTube broadcast → testing', 'connection', 'youtube');
    } catch (err) {
      if (!isInactiveStreamError(err)) {
        throw err;
      }
      addLog(
        'YouTube testing deferred until RTMP ingest is active',
        'info',
        'youtube'
      );
      return {
        broadcastId,
        lifeCycleStatus: lifeCycle,
        alreadyLive: false,
        deferTesting: true,
      };
    }
    return { broadcastId, lifeCycleStatus: 'testing', alreadyLive: false };
  }

  if (lifeCycle === 'testing') {
    return { broadcastId, lifeCycleStatus: 'testing', alreadyLive: false };
  }

  return { broadcastId, lifeCycleStatus: lifeCycle || 'unknown', alreadyLive: false };
}

/**
 * After RTMP ingest is active, transition testing → live so Studio shows the stream.
 */
/**
 * After FFmpeg is pushing RTMP: wait for ingest active, testing (if needed), then live.
 */
async function goLiveYouTubeBroadcast(tokens, broadcastId, streamId, prep = {}) {
  const youtube = getYoutubeClient(tokens);
  await bindBroadcastToStream(youtube, broadcastId, streamId);

  let broadcast = await getBroadcastResource(youtube, broadcastId);
  let lifeCycle = broadcast?.status?.lifeCycleStatus;

  if (lifeCycle === 'live') {
    return { broadcastId, lifeCycleStatus: 'live', ingestActive: true };
  }

  addLog('Waiting for RTMP ingest before YouTube go-live…', 'info', 'youtube');
  const ingestActive = await waitForStreamActive(youtube, streamId, 180000);
  if (!ingestActive) {
    const error = new Error(
      'YouTube stream stayed inactive. Check IVS URL, start IVS broadcast, and watch FFmpeg logs.'
    );
    error.statusCode = 408;
    throw error;
  }

  broadcast = await getBroadcastResource(youtube, broadcastId);
  lifeCycle = broadcast?.status?.lifeCycleStatus;

  const needsTesting =
    prep.deferTesting ||
    lifeCycle === 'ready' ||
    lifeCycle === 'created';

  if (needsTesting) {
    await transitionBroadcastWithRetry(youtube, broadcastId, 'testing', {
      maxAttempts: 10,
    });
    addLog('YouTube broadcast → testing', 'connection', 'youtube');
  }

  await transitionBroadcastWithRetry(youtube, broadcastId, 'live', {
    maxAttempts: 15,
  });
  addLog('YouTube broadcast is LIVE — should appear in YouTube Studio', 'connection', 'youtube');
  return { broadcastId, lifeCycleStatus: 'live', ingestActive: true };
}

async function completeYouTubeBroadcast(tokens, broadcastId) {
  if (!broadcastId) return;
  const youtube = getYoutubeClient(tokens);
  const broadcast = await getBroadcastResource(youtube, broadcastId);
  const lifeCycle = broadcast?.status?.lifeCycleStatus;

  if (lifeCycle === 'live' || lifeCycle === 'testing') {
    await transitionBroadcast(youtube, broadcastId, 'complete');
    addLog('YouTube broadcast ended (complete)', 'disconnection', 'youtube');
  }
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
  fetchLiveStreamDetails,
  ensureYouTubeLiveSetup,
  buildYoutubeRtmpUrl,
  getStreamIngestState,
  getLivePipelineStatus,
  prepareYouTubeBroadcast,
  goLiveYouTubeBroadcast,
  completeYouTubeBroadcast,
  isConfigured,
};
