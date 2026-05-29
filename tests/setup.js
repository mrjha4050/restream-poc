process.env.NODE_ENV = 'test';
process.env.SERVICE_API_KEY = 'test-secret';
process.env.SESSION_SECRET = 'test-session';
process.env.PORT = '3000';
process.env.LOG_BUFFER_SIZE = '200';

const { reloadConfig } = require('../src/config/env');
reloadConfig();

const logService = require('../src/services/log.service');

afterEach(() => {
  logService.clearLogs();
  jest.clearAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();

  process.env.NODE_ENV = 'test';
  process.env.SERVICE_API_KEY = 'test-secret';
  process.env.SESSION_SECRET = 'test-session';
  reloadConfig();
});
