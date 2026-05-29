const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const cors = require('cors');
const { config } = require('./config/env');
const serviceAuth = require('./middleware/auth.middleware');
const { requestId, notFound, errorHandler } = require('./middleware/error.middleware');
const routes = require('./routes/index.route');
const ffmpegService = require('./services/ffmpeg.service');
const { addLog } = require('./services/log.service');
const logger = require('./utils/logger');

function createApp() {
  const app = express();

  app.use(requestId);
  app.use(cors());
  app.use(express.json());

  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.nodeEnv === 'production',
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );

  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  app.use(serviceAuth);
  app.use(routes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

function startServer() {
  const { validateEnv } = require('./config/env');
  validateEnv();

  const app = createApp();
  const server = app.listen(config.port, () => {
    const ffmpegOk = ffmpegService.checkFfmpegAvailable();
    addLog(`Restream service running on port ${config.port}`, 'info');
    logger.info('Service started', {
      port: config.port,
      environment: config.nodeEnv,
      ffmpegAvailable: ffmpegOk,
    });

    if (!ffmpegOk) {
      logger.warn('FFmpeg is not available — stream start requests will fail');
    }
  });

  const shutdown = (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    const stopped = ffmpegService.stopAllPlatforms();
    if (stopped > 0) {
      addLog(`Stopped ${stopped} active stream(s) during shutdown`, 'info');
    }

    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

module.exports = { createApp, startServer };
