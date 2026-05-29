const { config } = require('../config/env');
const { platformLabel } = require('../constants/platforms');
const logger = require('../utils/logger');

const logs = [];
const listeners = new Set();

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
    displayText: `[${timestamp}] ${prefix}${message}`,
  };

  logs.push(logEntry);
  if (logs.length > config.logBufferSize) {
    logs.shift();
  }

  listeners.forEach((res) => {
    res.write(`data: ${JSON.stringify({ log: logEntry })}\n\n`);
  });

  logger.info(logEntry.displayText);
  return logEntry;
}

function getLogs() {
  return [...logs];
}

function subscribe(res) {
  listeners.add(res);
  return () => listeners.delete(res);
}

function getListenerCount() {
  return listeners.size;
}

function clearLogs() {
  logs.length = 0;
  listeners.clear();
}

module.exports = {
  addLog,
  getLogs,
  subscribe,
  getListenerCount,
  clearLogs,
};
