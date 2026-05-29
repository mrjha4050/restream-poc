const logger = require('../utils/logger');

function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

function notFound(req, res) {
  res.status(404).json({
    message: 'Route not found',
    path: req.originalUrl,
  });
}

function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  logger.error(message, {
    requestId: req.requestId,
    statusCode,
    stack: err.stack,
  });

  res.status(statusCode).json({
    message,
    requestId: req.requestId,
  });
}

module.exports = {
  requestId,
  notFound,
  errorHandler,
};
