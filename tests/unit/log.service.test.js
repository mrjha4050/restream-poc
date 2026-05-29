jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { config, reloadConfig } = require('../../src/config/env');
const logService = require('../../src/services/log.service');

describe('log.service', () => {
  beforeEach(() => {
    logService.clearLogs();
  });

  it('creates log entry with expected shape', () => {
    const entry = logService.addLog('hello', 'info', 'youtube');
    expect(entry).toMatchObject({
      message: 'hello',
      category: 'info',
      platform: 'youtube',
      platformName: 'YouTube',
    });
    expect(entry.timestamp).toBeDefined();
    expect(entry.displayText).toContain('[YouTube]');
    expect(entry.displayText).toContain('hello');
  });

  it('uses null platform fields when platformId is omitted', () => {
    const entry = logService.addLog('system msg', 'info');
    expect(entry.platform).toBeNull();
    expect(entry.platformName).toBeNull();
  });

  it('evicts oldest logs when buffer exceeds LOG_BUFFER_SIZE', () => {
    process.env.LOG_BUFFER_SIZE = '3';
    reloadConfig();
    logService.clearLogs();

    logService.addLog('one');
    logService.addLog('two');
    logService.addLog('three');
    logService.addLog('four');

    const logs = logService.getLogs();
    expect(logs).toHaveLength(3);
    expect(logs[0].message).toBe('two');
    expect(logs[2].message).toBe('four');

    process.env.LOG_BUFFER_SIZE = '200';
    reloadConfig();
  });

  it('writes SSE payload to subscribed listeners', () => {
    const res = { write: jest.fn() };
    logService.subscribe(res);
    logService.addLog('sse test');

    expect(res.write).toHaveBeenCalledWith(
      expect.stringMatching(/^data: \{.*"message":"sse test".*\}\n\n$/)
    );
  });

  it('stops writing after unsubscribe', () => {
    const res = { write: jest.fn() };
    const unsubscribe = logService.subscribe(res);
    unsubscribe();
    logService.addLog('after close');
    expect(res.write).not.toHaveBeenCalled();
  });

  it('notifies all listeners', () => {
    const res1 = { write: jest.fn() };
    const res2 = { write: jest.fn() };
    logService.subscribe(res1);
    logService.subscribe(res2);
    expect(logService.getListenerCount()).toBe(2);

    logService.addLog('broadcast');
    expect(res1.write).toHaveBeenCalled();
    expect(res2.write).toHaveBeenCalled();
  });

  it('returns a copy from getLogs', () => {
    logService.addLog('a');
    const logs = logService.getLogs();
    logs.pop();
    expect(logService.getLogs()).toHaveLength(1);
  });
});
