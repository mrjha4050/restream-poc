const { checkFfmpegAvailable } = require('../services/ffmpeg.service');
const { getListenerCount } = require('../services/log.service');
const { config } = require('../config/env');
const youtubeService = require('../services/youtube.service');

function health(req, res) {
  res.json({
    status: 'ok',
    service: 'restream',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}

function ready(req, res) {
  const ffmpegOk = checkFfmpegAvailable();
  const checks = {
    ffmpeg: ffmpegOk,
    youtubeOAuth: youtubeService.isConfigured(),
  };

  const ready = ffmpegOk;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks,
    environment: config.nodeEnv,
    activeLogListeners: getListenerCount(),
  });
}

module.exports = {
  health,
  ready,
};
