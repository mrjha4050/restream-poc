const youtubeService = require('../services/youtube.service');
const ffmpegService = require('../services/ffmpeg.service');
const { buildOutputUrl } = require('../constants/platforms');
const { addLog } = require('../services/log.service');

function redirectToYouTube(req, res, next) {
  try {
    const url = youtubeService.getAuthUrl();
    res.redirect(url);
  } catch (err) {
    next(err);
  }
}

async function handleYouTubeCallback(req, res) {
  const { code, error } = req.query;
  if (error || !code) {
    addLog(`YouTube OAuth error: ${error || 'no code'}`, 'error');
    return res.redirect('/?youtube=error');
  }

  try {
    const tokens = await youtubeService.exchangeCodeForTokens(code);
    req.session.youtubeTokens = tokens;
    addLog('YouTube OAuth tokens stored in session', 'connection');
    res.redirect('/?youtube=connected');
  } catch (err) {
    addLog(`YouTube token exchange failed: ${err.message}`, 'error');
    res.redirect('/?youtube=error');
  }
}

async function getYouTubeStatus(req, res) {
  const tokens = req.session.youtubeTokens;
  if (!tokens) {
    return res.json({ connected: false, email: null });
  }

  try {
    const email = await youtubeService.getUserEmail(tokens);
    res.json({ connected: true, email });
  } catch {
    res.json({ connected: false, email: null });
  }
}

async function fetchYouTubeKey(req, res, next) {
  const tokens = req.session.youtubeTokens;
  if (!tokens) {
    return res.status(401).json({ message: 'Not authenticated with YouTube' });
  }

  const { ivsUrl, autoRestart = true, maxRestarts = 5 } = req.body || {};

  try {
    const streamKey = await youtubeService.fetchLiveStreamKey(tokens);
    addLog('YouTube stream key fetched via OAuth', 'connection', 'youtube');

    if (ivsUrl) {
      const outputUrl = buildOutputUrl('youtube', streamKey);
      if (ffmpegService.isPlatformActive('youtube')) {
        return res.status(409).json({ message: 'YouTube is already streaming' });
      }

      const result = ffmpegService.startPlatform('youtube', ivsUrl.trim(), outputUrl, {
        autoRestart,
        maxRestarts,
      });

      if (!result.ok) {
        return res.status(503).json({ message: 'Failed to start YouTube stream' });
      }

      return res.json({
        key: streamKey,
        message: 'YouTube stream started',
        autoStarted: true,
      });
    }

    res.json({ key: streamKey, message: 'Stream key fetched', autoStarted: false });
  } catch (err) {
    addLog(`YouTube API error: ${err.message}`, 'error', 'youtube');
    next(err);
  }
}

function disconnectYouTube(req, res) {
  delete req.session.youtubeTokens;
  addLog('YouTube OAuth session cleared', 'disconnection', 'youtube');
  res.json({ message: 'YouTube disconnected' });
}

module.exports = {
  redirectToYouTube,
  handleYouTubeCallback,
  getYouTubeStatus,
  fetchYouTubeKey,
  disconnectYouTube,
};
