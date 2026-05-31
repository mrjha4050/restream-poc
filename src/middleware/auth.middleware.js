const { config } = require('../config/env');

const PUBLIC_PATH_PREFIXES = [
  '/health',
  '/ready',
  '/auth/youtube',
  '/auth/facebook',
];

function isPublicPath(path) {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

function requestPath(req) {
  const fromOriginal = (req.originalUrl || req.url || '').split('?')[0];
  return fromOriginal || req.path || '';
}

function serviceAuth(req, res, next) {
  if (isPublicPath(requestPath(req))) {
    return next();
  }

  if (!config.serviceApiKey) {
    if (config.nodeEnv === 'production') {
      return res.status(503).json({ message: 'Service authentication is not configured' });
    }
    return next();
  }

  const providedKey =
    req.headers['x-service-key'] ||
    (req.method === 'GET' ? req.query.key : null);
  if (!providedKey || providedKey !== config.serviceApiKey) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  return next();
}

serviceAuth.isPublicPath = isPublicPath;
serviceAuth.requestPath = requestPath;

module.exports = serviceAuth;
