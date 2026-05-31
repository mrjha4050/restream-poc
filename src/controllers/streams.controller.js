const {
  isValidPlatform,
  buildOutputUrl,
  PLATFORMS,
} = require('../constants/platforms');
const ffmpegService = require('../services/ffmpeg.service');
const facebookService = require('../services/facebook.service');
const { addLog } = require('../services/log.service');

function clampMaxRestarts(value) {
  return Math.min(20, Math.max(1, parseInt(value, 10) || 5));
}

async function endFacebookLiveIfActive(req) {
  const liveVideoId = req.session?.facebookLiveVideoId;
  const page = req.session?.facebookPage;
  if (!liveVideoId || !page) {
    return;
  }

  try {
    await facebookService.endLiveVideo(page.accessToken, liveVideoId);
    addLog('Facebook live broadcast ended', 'disconnection', 'facebook');
  } catch (err) {
    addLog(`Facebook end broadcast failed: ${err.message}`, 'error', 'facebook');
  } finally {
    delete req.session.facebookLiveVideoId;
  }
}

function startPlatform(req, res) {
  const platformId = req.params.id;
  if (!isValidPlatform(platformId)) {
    return res.status(404).json({ message: 'Unknown platform' });
  }

  const { ivsUrl, key, autoRestart = true, maxRestarts = 5, customUrl = '' } = req.body || {};

  if (!ivsUrl || typeof ivsUrl !== 'string') {
    return res.status(400).json({ message: 'A valid IVS input URL is required' });
  }
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ message: 'Stream key is required' });
  }

  const outputUrl = buildOutputUrl(
    platformId,
    key,
    typeof customUrl === 'string' ? customUrl : ''
  );
  if (!outputUrl) {
    return res.status(400).json({ message: 'Could not build output URL' });
  }

  if (ffmpegService.isPlatformActive(platformId)) {
    return res.status(409).json({ message: 'This platform is already streaming' });
  }

  const result = ffmpegService.startPlatform(platformId, ivsUrl.trim(), outputUrl, {
    autoRestart,
    maxRestarts: clampMaxRestarts(maxRestarts),
  });

  if (!result.ok) {
    if (result.reason === 'ffmpeg_unavailable') {
      return res.status(503).json({ message: 'FFmpeg is not available on this host' });
    }
    return res.status(500).json({ message: 'Failed to start FFmpeg' });
  }

  res.json({
    message: 'Platform output started',
    platform: platformId,
    name: PLATFORMS[platformId].name,
  });
}

async function stopPlatform(req, res) {
  const platformId = req.params.id;
  if (!isValidPlatform(platformId)) {
    return res.status(404).json({ message: 'Unknown platform' });
  }

  if (platformId === 'facebook') {
    await endFacebookLiveIfActive(req);
  }

  if (!ffmpegService.stopPlatform(platformId)) {
    return res.status(404).json({ message: 'No active stream for this platform' });
  }
  res.json({ message: 'Platform output stopped', platform: platformId });
}

async function stopAll(req, res) {
  if (ffmpegService.isPlatformActive('facebook')) {
    await endFacebookLiveIfActive(req);
  }

  const count = ffmpegService.stopAllPlatforms();
  res.json({ message: count ? `Stopped ${count} output(s)` : 'No active streams' });
}

function getStatus(req, res) {
  res.json(ffmpegService.getStatus());
}

module.exports = {
  startPlatform,
  stopPlatform,
  stopAll,
  getStatus,
};
