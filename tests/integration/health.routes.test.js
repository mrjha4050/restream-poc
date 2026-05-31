jest.mock('../../src/services/ffmpeg.service', () => ({
  checkFfmpegAvailable: jest.fn(),
  startPlatform: jest.fn(),
  stopPlatform: jest.fn(),
  stopAllPlatforms: jest.fn(),
  isPlatformActive: jest.fn(),
  getStatus: jest.fn(),
  resetState: jest.fn(),
}));

jest.mock('../../src/services/youtube.service', () => ({
  isConfigured: jest.fn(() => false),
}));

jest.mock('../../src/services/facebook.service', () => ({
  isConfigured: jest.fn(() => false),
}));

const request = require('supertest');
const ffmpegService = require('../../src/services/ffmpeg.service');
const { createTestApp } = require('../helpers/createTestApp');

describe('health routes', () => {
  const app = createTestApp();
  const serviceKey = { 'X-Service-Key': 'test-secret' };

  beforeEach(() => {
    jest.clearAllMocks();
    ffmpegService.getStatus.mockReturnValue({
      running: false,
      anyRunning: false,
      activeCount: 0,
      uptime: null,
      platforms: {},
    });
  });

  describe('GET /health', () => {
    it('returns ok without service key', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        service: 'restream',
      });
      expect(res.body.uptime).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('GET /ready', () => {
    it('returns ready when ffmpeg is available', async () => {
      ffmpegService.checkFfmpegAvailable.mockReturnValue(true);
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.checks.ffmpeg).toBe(true);
      expect(res.body.checks.facebookOAuth).toBe(false);
    });

    it('returns not_ready when ffmpeg is unavailable', async () => {
      ffmpegService.checkFfmpegAvailable.mockReturnValue(false);
      const res = await request(app).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.checks.ffmpeg).toBe(false);
    });

    it('does not require service key', async () => {
      ffmpegService.checkFfmpegAvailable.mockReturnValue(true);
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
    });
  });

  it('protected route still requires key when configured', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(401);
    await request(app).get('/status').set(serviceKey).expect(200);
  });
});
