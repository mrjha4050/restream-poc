const { config } = require('../config/env');

const PUBLIC_PATH_PREFIXES = [
  '/health',
  '/ready',
  '/auth/youtube',
];

function isPublicPath(path) {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

function serviceAuth(req, res, next) {
  if (isPublicPath(req.path)) {
    return next();
  }

  if (!config.serviceApiKey) {
    if (config.nodeEnv === 'production') {
      return res.status(503).json({ message: 'Service authentication is not configured' });
    }
    return next();
  }

  const providedKey = req.headers['x-service-key'];
  if (!providedKey || providedKey !== config.serviceApiKey) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  return next();
}

serviceAuth.isPublicPath = isPublicPath;

module.exports = serviceAuth;
