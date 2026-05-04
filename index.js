const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { IvsClient, PutMetadataCommand } = require('@aws-sdk/client-ivs');
const session = require('express-session');
const { google } = require('googleapis');

const ivsClient = new IvsClient({ region: process.env.AWS_REGION || 'us-east-1' });

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID ||'402210900362-4q4g0t7kg3vk2hqn0kmvcfo8dtdfhl61.apps.googleusercontent.com'  ,
  process.env.GOOGLE_CLIENT_SECRET || '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',
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/youtube/callback'
);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const PLATFORMS = {
  youtube: { name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2/' },
  twitch: { name: 'Twitch', url: 'rtmp://live.twitch.tv/live/' },
  facebook: { name: 'Facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/' },
  custom: { name: 'Custom', url: '' }
};

let streamState = {
  logs: []
};

/** @type {Record<string, { process: import('child_process').ChildProcess, startTime: number, restarts: number, maxRestarts: number, autoRestart: boolean, ivsUrl: string, outputUrl: string }>} */
let activeStreams = {};

/** @type {Record<string, ReturnType<typeof setTimeout>>} */
let restartTimers = {};

let logListeners = [];

function clearRestartTimer(platformId) {
  if (restartTimers[platformId]) {
    clearTimeout(restartTimers[platformId]);
    delete restartTimers[platformId];
  }
}

function platformLabel(platformId) {
  return PLATFORMS[platformId]?.name || platformId;
}

function addLog(message, category = 'info', platformId = null) {
  const timestamp = new Date().toISOString();
  const name = platformId ? platformLabel(platformId) : null;
  const prefix = name ? `[${name}] ` : '';
  const logEntry = {
    timestamp,
    message,
    category,
    platform: platformId || null,
    platformName: name,
    displayText: `[${timestamp}] ${prefix}${message}`
  };
  streamState.logs.push(logEntry);
  if (streamState.logs.length > 200) {
    streamState.logs.shift();
  }
  logListeners.forEach(res => {
    res.write(`data: ${JSON.stringify({ log: logEntry })}\n\n`);
  });
  console.log(logEntry.displayText);
}

function buildOutputUrl(platformId, key, customUrl = '') {
  if (platformId === 'custom') {
    return (customUrl || '') + key;
  }
  const base = PLATFORMS[platformId]?.url || '';
  return base + key;
}

function launchPlatformFfmpeg(platformId, ivsUrl, outputUrl, options) {
  const {
    autoRestart = true,
    maxRestarts = 5,
    restartCount = 0,
    isRestart = false
  } = options;

  const ffmpegArgs = [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-re',
    '-i', ivsUrl,
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-f', 'flv',
    outputUrl
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  activeStreams[platformId] = {
    process: ffmpeg,
    startTime: Date.now(),
    restarts: restartCount,
    maxRestarts,
    autoRestart,
    ivsUrl,
    outputUrl
  };

  if (isRestart) {
    addLog(`FFmpeg restarted (PID ${ffmpeg.pid})`, 'reconnection', platformId);
  } else {
    addLog(`FFmpeg started (PID ${ffmpeg.pid}) — output connecting`, 'connection', platformId);
  }

  ffmpeg.on('error', error => {
    addLog(`FFmpeg error: ${error.message}`, 'error', platformId);
    if (activeStreams[platformId]?.process === ffmpeg) {
      delete activeStreams[platformId];
    }
  });

  let reportedLive = false;
  ffmpeg.stderr.on('data', data => {
    const line = data.toString().trim();
    if (line) addLog(`FFmpeg: ${line}`, 'info', platformId);
    if (!reportedLive && /speed=\s*[\d.]+x/.test(line) && /time=/.test(line)) {
      reportedLive = true;
      addLog('Output appears live (ffmpeg is sending data)', 'connection', platformId);
    }
  });

  ffmpeg.on('close', code => {
    const entry = activeStreams[platformId];
    if (!entry) return;

    const {
      ivsUrl: savedIvs,
      outputUrl: savedOut,
      autoRestart: willRestart,
      maxRestarts: cap,
      restarts: curRestarts
    } = entry;
    const runtime = Math.round((Date.now() - entry.startTime) / 1000);
    delete activeStreams[platformId];

    if (code === 0) {
      addLog(`Output stopped (ran ${runtime}s)`, 'disconnection', platformId);
    } else {
      addLog(`Output disconnected (exit ${code}, ran ${runtime}s)`, 'disconnection', platformId);
    }

    if (!willRestart) {
      return;
    }

    let nextRestarts = runtime > 60 ? 0 : curRestarts + 1;
    if (nextRestarts > cap) {
      addLog(`Max restart attempts reached (${cap})`, 'error', platformId);
      return;
    }

    const delay = Math.min(3000, 500 * nextRestarts);
    addLog(`Auto-restart in ${delay}ms (attempt ${nextRestarts}/${cap})`, 'reconnection', platformId);

    clearRestartTimer(platformId);
    restartTimers[platformId] = setTimeout(() => {
      delete restartTimers[platformId];
      if (activeStreams[platformId]) return;
      launchPlatformFfmpeg(platformId, savedIvs, savedOut, {
        autoRestart: true,
        maxRestarts: cap,
        restartCount: nextRestarts,
        isRestart: true
      });
    }, delay);
  });

  return true;
}

function startPlatformFFmpeg(platformId, ivsUrl, outputUrl, options = {}) {
  clearRestartTimer(platformId);
  if (activeStreams[platformId]) {
    addLog('Already streaming to this platform', 'error', platformId);
    return false;
  }
  const autoRestart = options.autoRestart !== false;
  const maxRestarts = Number.isFinite(options.maxRestarts) ? options.maxRestarts : 5;
  return launchPlatformFfmpeg(platformId, ivsUrl, outputUrl, {
    autoRestart,
    maxRestarts,
    restartCount: 0,
    isRestart: false
  });
}

function stopPlatform(platformId) {
  clearRestartTimer(platformId);
  const entry = activeStreams[platformId];
  if (!entry) return false;
  entry.autoRestart = false;
  entry.process.kill('SIGINT');
  return true;
}

function stopAllPlatforms() {
  Object.keys(restartTimers).forEach(clearRestartTimer);
  const ids = Object.keys(activeStreams);
  for (const id of ids) {
    stopPlatform(id);
  }
  return ids.length;
}

app.get('/platforms', (req, res) => {
  const platforms = Object.keys(PLATFORMS).map(key => ({
    id: key,
    name: PLATFORMS[key].name,
    url: PLATFORMS[key].url
  }));
  res.json(platforms);
});

app.get('/auth/youtube', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.readonly'],
    prompt: 'consent'
  });
  res.redirect(url);
});

app.get('/auth/youtube/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    addLog(`YouTube OAuth error: ${error || 'no code'}`, 'error');
    return res.redirect('/?youtube=error');
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    req.session.youtubeTokens = tokens;
    addLog('YouTube OAuth tokens stored in session', 'connection');
    res.redirect('/?youtube=connected');
  } catch (err) {
    addLog(`YouTube token exchange failed: ${err.message}`, 'error');
    res.redirect('/?youtube=error');
  }
});

app.get('/auth/youtube/status', async (req, res) => {
  const tokens = req.session.youtubeTokens;
  if (!tokens) return res.json({ connected: false, email: null });
  try {
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const info = await oauth2.userinfo.get();
    res.json({ connected: true, email: info.data.email });
  } catch {
    res.json({ connected: false, email: null });
  }
});

app.post('/auth/youtube/fetch-key', async (req, res) => {
  const tokens = req.session.youtubeTokens;
  if (!tokens) return res.status(401).json({ message: 'Not authenticated with YouTube' });

  const { ivsUrl, autoRestart = true, maxRestarts = 5 } = req.body || {};

  try {
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const streamsRes = await youtube.liveStreams.list({
      part: ['cdn'],
      mine: true,
      maxResults: 1
    });

    const items = streamsRes.data.items;
    if (!items || items.length === 0) {
      return res.status(404).json({ message: 'No YouTube live stream found. Create one in YouTube Studio first.' });
    }

    const streamKey = items[0].cdn.ingestionInfo.streamName;
    addLog(`YouTube stream key fetched via OAuth`, 'connection', 'youtube');

    if (ivsUrl) {
      const outputUrl = buildOutputUrl('youtube', streamKey);
      if (activeStreams['youtube']) {
        return res.status(409).json({ message: 'YouTube is already streaming' });
      }
      startPlatformFFmpeg('youtube', ivsUrl.trim(), outputUrl, { autoRestart, maxRestarts });
      return res.json({ key: streamKey, message: 'YouTube stream started', autoStarted: true });
    }

    res.json({ key: streamKey, message: 'Stream key fetched', autoStarted: false });
  } catch (err) {
    addLog(`YouTube API error: ${err.message}`, 'error', 'youtube');
    res.status(500).json({ message: `YouTube API error: ${err.message}` });
  }
});

app.post('/auth/youtube/disconnect', (req, res) => {
  delete req.session.youtubeTokens;
  addLog('YouTube OAuth session cleared', 'disconnection', 'youtube');
  res.json({ message: 'YouTube disconnected' });
});

app.get('/logs', (req, res) => {
  res.json(streamState.logs);
});

app.get('/stream-logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(':ping\n\n');

  logListeners.push(res);

  req.on('close', () => {
    logListeners = logListeners.filter(listener => listener !== res);
  });
});

app.post('/platforms/:id/start', (req, res) => {
  const platformId = req.params.id;
  if (!PLATFORMS[platformId]) {
    return res.status(404).json({ message: 'Unknown platform' });
  }

  const { ivsUrl, key, autoRestart = true, maxRestarts = 5, customUrl = '' } = req.body || {};

  if (!ivsUrl || typeof ivsUrl !== 'string') {
    return res.status(400).json({ message: 'A valid IVS input URL is required' });
  }
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ message: 'Stream key is required' });
  }

  const outputUrl = buildOutputUrl(platformId, key, typeof customUrl === 'string' ? customUrl : '');
  if (!outputUrl) {
    return res.status(400).json({ message: 'Could not build output URL' });
  }

  if (activeStreams[platformId]) {
    return res.status(409).json({ message: 'This platform is already streaming' });
  }

  const ok = startPlatformFFmpeg(platformId, ivsUrl.trim(), outputUrl, {
    autoRestart,
    maxRestarts: Math.min(20, Math.max(1, parseInt(maxRestarts, 10) || 5))
  });

  if (!ok) {
    return res.status(500).json({ message: 'Failed to start FFmpeg' });
  }

  res.json({
    message: 'Platform output started',
    platform: platformId,
    name: PLATFORMS[platformId].name
  });
});

app.post('/platforms/:id/stop', (req, res) => {
  const platformId = req.params.id;
  if (!PLATFORMS[platformId]) {
    return res.status(404).json({ message: 'Unknown platform' });
  }
  if (!stopPlatform(platformId)) {
    return res.status(404).json({ message: 'No active stream for this platform' });
  }
  res.json({ message: 'Platform output stopped', platform: platformId });
});

app.post('/stop', (req, res) => {
  const n = stopAllPlatforms();
  res.json({ message: n ? `Stopped ${n} output(s)` : 'No active streams' });
});

app.get('/status', (req, res) => {
  const platformStatuses = {};
  let maxUptime = null;

  for (const id of Object.keys(PLATFORMS)) {
    const a = activeStreams[id];
    const uptime = a ? Math.round((Date.now() - a.startTime) / 1000) : null;
    if (uptime !== null && (maxUptime === null || uptime > maxUptime)) {
      maxUptime = uptime;
    }
    platformStatuses[id] = {
      running: !!a,
      uptime,
      restarts: a ? a.restarts : 0,
      maxRestarts: a ? a.maxRestarts : null,
      autoRestart: a ? a.autoRestart : null
    };
  }

  const activeCount = Object.keys(activeStreams).length;

  res.json({
    running: activeCount > 0,
    anyRunning: activeCount > 0,
    activeCount,
    uptime: maxUptime,
    platforms: platformStatuses
  });
});

app.post('/overlay', async (req, res) => {
  const { channelArn, payload } = req.body || {};
  if (!channelArn || typeof channelArn !== 'string') {
    return res.status(400).json({ error: 'channelArn is required' });
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'payload object is required' });
  }
  try {
    await ivsClient.send(new PutMetadataCommand({
      channelArn,
      metadata: JSON.stringify(payload)
    }));
    addLog(`Overlay sent: type=${payload.type}`, 'info');
    res.json({ ok: true });
  } catch (err) {
    addLog(`Overlay error: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  addLog('Server running on http://localhost:3000', 'info');
});
