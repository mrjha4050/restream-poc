const youtubeService = require('../services/youtube.service');
const facebookService = require('../services/facebook.service');
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

function redirectToFacebook(req, res, next) {
  try {
    const url = facebookService.getAuthUrl();
    res.redirect(url);
  } catch (err) {
    next(err);
  }
}

async function handleFacebookCallback(req, res) {
  const { code, error } = req.query;
  if (error || !code) {
    addLog(`Facebook OAuth error: ${error || 'no code'}`, 'error');
    return res.redirect('/?facebook=error');
  }

  try {
    const tokens = await facebookService.exchangeCodeForTokens(code);
    req.session.facebookTokens = tokens;
    delete req.session.facebookPage;
    delete req.session.facebookLiveVideoId;
    addLog('Facebook OAuth tokens stored in session', 'connection');
    res.redirect('/?facebook=connected');
  } catch (err) {
    addLog(`Facebook token exchange failed: ${err.message}`, 'error');
    res.redirect('/?facebook=error');
  }
}

async function getFacebookStatus(req, res) {
  const tokens = req.session.facebookTokens;
  const page = req.session.facebookPage;
  if (!tokens) {
    return res.json({
      connected: false,
      name: null,
      pageId: null,
      pageName: null,
    });
  }

  try {
    const profile = await facebookService.getUserProfile(tokens.accessToken);
    res.json({
      connected: true,
      name: profile.name,
      pageId: page?.id || null,
      pageName: page?.name || null,
    });
  } catch {
    res.json({
      connected: false,
      name: null,
      pageId: null,
      pageName: null,
    });
  }
}

async function getFacebookPages(req, res, next) {
  const tokens = req.session.facebookTokens;
  if (!tokens) {
    return res.status(401).json({ message: 'Not authenticated with Facebook' });
  }

  try {
    const pages = await facebookService.getManagedPages(tokens.accessToken);
    res.json({
      pages: pages.map(({ id, name }) => ({ id, name })),
    });
  } catch (err) {
    addLog(`Facebook API error: ${err.message}`, 'error', 'facebook');
    next(err);
  }
}

async function selectFacebookPage(req, res, next) {
  const tokens = req.session.facebookTokens;
  if (!tokens) {
    return res.status(401).json({ message: 'Not authenticated with Facebook' });
  }

  const { pageId } = req.body || {};
  if (!pageId || typeof pageId !== 'string') {
    return res.status(400).json({ message: 'A valid pageId is required' });
  }

  try {
    const pages = await facebookService.getManagedPages(tokens.accessToken);
    const page = pages.find((entry) => entry.id === pageId);
    if (!page) {
      return res.status(404).json({ message: 'Facebook Page not found for this account' });
    }

    req.session.facebookPage = {
      id: page.id,
      name: page.name,
      accessToken: page.accessToken,
    };
    delete req.session.facebookLiveVideoId;
    addLog(`Facebook Page selected: ${page.name}`, 'connection', 'facebook');
    res.json({
      message: 'Facebook Page selected',
      pageId: page.id,
      pageName: page.name,
    });
  } catch (err) {
    addLog(`Facebook API error: ${err.message}`, 'error', 'facebook');
    next(err);
  }
}

async function startFacebookLive(req, res, next) {
  const tokens = req.session.facebookTokens;
  const page = req.session.facebookPage;
  if (!tokens) {
    return res.status(401).json({ message: 'Not authenticated with Facebook' });
  }
  if (!page) {
    return res.status(400).json({ message: 'Select a Facebook Page before starting a live stream' });
  }

  const { ivsUrl, autoRestart = true, maxRestarts = 5, title } = req.body || {};

  try {
    const liveVideo = await facebookService.createLiveVideo(
      page.accessToken,
      page.id,
      { title: typeof title === 'string' ? title : undefined }
    );
    req.session.facebookLiveVideoId = liveVideo.liveVideoId;
    addLog('Facebook live video created via OAuth', 'connection', 'facebook');

    if (ivsUrl) {
      if (ffmpegService.isPlatformActive('facebook')) {
        return res.status(409).json({ message: 'Facebook is already streaming' });
      }

      const result = ffmpegService.startPlatform(
        'facebook',
        ivsUrl.trim(),
        liveVideo.secureStreamUrl,
        { autoRestart, maxRestarts }
      );

      if (!result.ok) {
        return res.status(503).json({ message: 'Failed to start Facebook stream' });
      }

      return res.json({
        liveVideoId: liveVideo.liveVideoId,
        secureStreamUrl: liveVideo.secureStreamUrl,
        message: 'Facebook stream started',
        autoStarted: true,
      });
    }

    res.json({
      liveVideoId: liveVideo.liveVideoId,
      secureStreamUrl: liveVideo.secureStreamUrl,
      message: 'Facebook live video created',
      autoStarted: false,
    });
  } catch (err) {
    addLog(`Facebook API error: ${err.message}`, 'error', 'facebook');
    next(err);
  }
}

function disconnectFacebook(req, res) {
  delete req.session.facebookTokens;
  delete req.session.facebookPage;
  delete req.session.facebookLiveVideoId;
  addLog('Facebook OAuth session cleared', 'disconnection', 'facebook');
  res.json({ message: 'Facebook disconnected' });
}

module.exports = {
  redirectToYouTube,
  handleYouTubeCallback,
  getYouTubeStatus,
  fetchYouTubeKey,
  disconnectYouTube,
  redirectToFacebook,
  handleFacebookCallback,
  getFacebookStatus,
  getFacebookPages,
  selectFacebookPage,
  startFacebookLive,
  disconnectFacebook,
};
