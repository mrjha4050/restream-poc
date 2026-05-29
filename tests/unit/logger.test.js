const { config, reloadConfig } = require('../../src/config/env');
const logger = require('../../src/utils/logger');

describe('logger', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    reloadConfig();
    jest.restoreAllMocks();
  });

  it('logs info messages', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('hello', { id: 1 });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[INFO] hello'));
    spy.mockRestore();
  });

  it('suppresses debug in production', () => {
    process.env.NODE_ENV = 'production';
    reloadConfig();
    const spy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('hidden');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logs debug outside production', () => {
    process.env.NODE_ENV = 'test';
    reloadConfig();
    const spy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('visible');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
