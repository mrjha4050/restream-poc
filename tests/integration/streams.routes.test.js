jest.mock('../../src/services/ffmpeg.service', () => ({
  checkFfmpegAvailable: jest.fn(() => true),
  startPlatform: jest.fn(() => ({ ok: true })),
  stopPlatform: jest.fn(),
  stopAllPlatforms: jest.fn(() => 0),
  isPlatformActive: jest.fn(() => false),
  getStatus: jest.fn(() => ({
    running: false,
    anyRunning: false,
    activeCount: 0,
    uptime: null,
    platforms: {},
  })),
  resetState: jest.fn(),
}));

const request = require('supertest');
const ffmpegService = require('../../src/services/ffmpeg.service');
const { createTestApp } = require('../helpers/createTestApp');

describe('streams routes', () => {
  const app = createTestApp();
  const serviceKey = { 'X-Service-Key': 'test-secret' };
  const validBody = {
    ivsUrl: 'https://playback.ivs.example.com/stream.m3u8',
    key: 'stream-key',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ffmpegService.isPlatformActive.mockReturnValue(false);
    ffmpegService.startPlatform.mockReturnValue({ ok: true });
    ffmpegService.stopPlatform.mockReturnValue(false);
    ffmpegService.stopAllPlatforms.mockReturnValue(0);
    ffmpegService.getStatus.mockReturnValue({
      running: false,
      anyRunning: false,
      activeCount: 0,
      uptime: null,
      platforms: { youtube: { running: false } },
    });
  });

  describe('POST /platforms/:id/start', () => {
    it('returns 404 for unknown platform', async () => {
      const res = await request(app)
        .post('/platforms/invalid/start')
        .set(serviceKey)
        .send(validBody);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Unknown platform');
    });

    it('returns 400 when ivsUrl is missing', async () => {
      const res = await request(app)
        .post('/platforms/youtube/start')
        .set(serviceKey)
        .send({ key: 'k' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('A valid IVS input URL is required');
    });

    it('returns 400 when ivsUrl is not a string', async () => {
      const res = await request(app)
        .post('/platforms/youtube/start')
        .set(serviceKey)
        .send({ ivsUrl: 123, key: 'k' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when key is missing', async () => {
      const res = await request(app)
        .post('/platforms/youtube/start')
        .set(serviceKey)
        .send({ ivsUrl: validBody.ivsUrl });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Stream key is required');
    });

    it('returns 400 when key is empty string', async () => {
      const res = await request(app)
        .post('/platforms/custom/start')
        .set(serviceKey)
        .send({ ivsUrl: validBody.ivsUrl, key: '', customUrl: '' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Stream key is required');
    });

    it('starts stream successfully', async () => {
      const res = await request(app)
        .post('/platforms/youtube/start')
        .set(serviceKey)
        .send(validBody);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        message: 'Platform output started',
        platform: 'youtube',
        name: 'YouTube',
      });
      expect(ffmpegService.startPlatform).toHaveBeenCalledWith(
        'youtube',
        validBody.ivsUrl,
        expect.stringContaining('stream-key'),
        expect.objectContaining({ autoRestart: true, maxRestarts: 5 })
      );
    });

    it('returns 409 when platform already streaming', async () => {
      ffmpegService.isPlatformActive.mockReturnValue(true);
      const res = await request(app)
        .post('/platforms/youtube/start')
        .set(serviceKey)
        .send(validBody);
      expect(res.status).toBe(409);
    });

    it('returns 503 when ffmpeg unavailable', async () => {
      ffmpegService.startPlatform.mockReturnValue({ ok: false, reason: 'ffmpeg_unavailable' });
      const res = await request(app)
        .post('/platforms/youtube/start')
        .set(serviceKey)
        .send(validBody);
      expect(res.status).toBe(503);
    });

    it('returns 500 for other start failures', async () => {
      ffmpegService.startPlatform.mockReturnValue({ ok: false, reason: 'unknown' });
      const res = await request(app)
        .post('/platforms/youtube/start')
        .set(serviceKey)
        .send(validBody);
      expect(res.status).toBe(500);
    });

    it('clamps maxRestarts to 20', async () => {
      await request(app)
        .post('/platforms/youtube/start')
        .set(serviceKey)
        .send({ ...validBody, maxRestarts: 100 });
      expect(ffmpegService.startPlatform).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ maxRestarts: 20 })
      );
    });

    it('defaults invalid maxRestarts to 5', async () => {
      await request(app)
        .post('/platforms/youtube/start')
        .set(serviceKey)
        .send({ ...validBody, maxRestarts: 'abc' });
      expect(ffmpegService.startPlatform).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ maxRestarts: 5 })
      );
    });

    it('passes customUrl for custom platform', async () => {
      await request(app)
        .post('/platforms/custom/start')
        .set(serviceKey)
        .send({
          ivsUrl: validBody.ivsUrl,
          key: 'mykey',
          customUrl: 'rtmp://custom.example/live/',
        });
      expect(ffmpegService.startPlatform).toHaveBeenCalledWith(
        'custom',
        validBody.ivsUrl,
        'rtmp://custom.example/live/mykey',
        expect.any(Object)
      );
    });

    it('trims ivsUrl whitespace', async () => {
      await request(app)
        .post('/platforms/youtube/start')
        .set(serviceKey)
        .send({ ...validBody, ivsUrl: `  ${validBody.ivsUrl}  ` });
      expect(ffmpegService.startPlatform).toHaveBeenCalledWith(
        'youtube',
        validBody.ivsUrl,
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('POST /platforms/:id/stop', () => {
    it('returns 404 for unknown platform', async () => {
      const res = await request(app)
        .post('/platforms/invalid/stop')
        .set(serviceKey);
      expect(res.status).toBe(404);
    });

    it('returns 404 when no active stream', async () => {
      ffmpegService.stopPlatform.mockReturnValue(false);
      const res = await request(app)
        .post('/platforms/youtube/stop')
        .set(serviceKey);
      expect(res.status).toBe(404);
    });

    it('stops active stream', async () => {
      ffmpegService.stopPlatform.mockReturnValue(true);
      const res = await request(app)
        .post('/platforms/youtube/stop')
        .set(serviceKey);
      expect(res.status).toBe(200);
      expect(res.body.platform).toBe('youtube');
    });
  });

  describe('POST /stop', () => {
    it('returns message when no streams active', async () => {
      const res = await request(app).post('/stop').set(serviceKey);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('No active streams');
    });

    it('returns stopped count when streams were active', async () => {
      ffmpegService.stopAllPlatforms.mockReturnValue(2);
      const res = await request(app).post('/stop').set(serviceKey);
      expect(res.body.message).toBe('Stopped 2 output(s)');
    });
  });

  describe('GET /status', () => {
    it('returns status snapshot', async () => {
      const res = await request(app).get('/status').set(serviceKey);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('running');
      expect(res.body).toHaveProperty('platforms');
    });
  });
});
