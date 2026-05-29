jest.mock('../../src/services/ffmpeg.service', () => ({
  checkFfmpegAvailable: jest.fn(() => true),
  stopAllPlatforms: jest.fn(() => 0),
  resetState: jest.fn(),
}));

jest.mock('../../src/services/log.service', () => ({
  addLog: jest.fn(),
}));

const { createApp } = require('../../src/server');

describe('server', () => {
  it('createApp returns an express application', () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.use).toBe('function');
    expect(typeof app.listen).toBe('function');
  });
});
