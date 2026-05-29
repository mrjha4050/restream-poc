jest.mock('../../src/services/ffmpeg.service', () => ({
  checkFfmpegAvailable: jest.fn(() => true),
  startPlatform: jest.fn(() => ({ ok: true })),
  stopPlatform: jest.fn(),
  stopAllPlatforms: jest.fn(() => 0),
  isPlatformActive: jest.fn(() => false),
  getStatus: jest.fn(),
  resetState: jest.fn(),
}));

jest.mock('../../src/services/youtube.service', () => ({
  getAuthUrl: jest.fn(() => 'https://accounts.google.com/o/oauth2/auth?client=test'),
  exchangeCodeForTokens: jest.fn(),
  getUserEmail: jest.fn(),
  fetchLiveStreamKey: jest.fn(),
  isConfigured: jest.fn(() => true),
  createOAuth2Client: jest.fn(),
}));

const request = require('supertest');
const youtubeService = require('../../src/services/youtube.service');
const ffmpegService = require('../../src/services/ffmpeg.service');
const { createTestApp } = require('../helpers/createTestApp');

describe('auth routes', () => {
  const app = createTestApp();

  beforeEach(() => {
    jest.clearAllMocks();
    ffmpegService.isPlatformActive.mockReturnValue(false);
    ffmpegService.startPlatform.mockReturnValue({ ok: true });
    youtubeService.getAuthUrl.mockReturnValue(
      'https://accounts.google.com/o/oauth2/auth?client=test'
    );
  });

  describe('GET /auth/youtube', () => {
    it('redirects to Google OAuth without service key', async () => {
      const res = await request(app).get('/auth/youtube');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('accounts.google.com');
    });
  });

  describe('GET /auth/youtube/callback', () => {
    it('redirects to error when OAuth returns error', async () => {
      const res = await request(app).get('/auth/youtube/callback?error=access_denied');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/?youtube=error');
    });

    it('redirects to error when code is missing', async () => {
      const res = await request(app).get('/auth/youtube/callback');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/?youtube=error');
    });

    it('stores tokens and redirects to connected on success', async () => {
      youtubeService.exchangeCodeForTokens.mockResolvedValue({ access_token: 'tok' });
      const agent = request.agent(app);
      const res = await agent.get('/auth/youtube/callback?code=valid-code');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/?youtube=connected');

      const statusRes = await agent.get('/auth/youtube/status');
      expect(youtubeService.getUserEmail).toHaveBeenCalled();
    });

    it('redirects to error when token exchange fails', async () => {
      youtubeService.exchangeCodeForTokens.mockRejectedValue(new Error('exchange failed'));
      const res = await request(app).get('/auth/youtube/callback?code=bad-code');
      expect(res.headers.location).toBe('/?youtube=error');
    });
  });

  describe('GET /auth/youtube/status', () => {
    it('returns disconnected when no session', async () => {
      const res = await request(app).get('/auth/youtube/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: false, email: null });
    });

    it('returns connected with email when session valid', async () => {
      youtubeService.exchangeCodeForTokens.mockResolvedValue({ access_token: 'tok' });
      youtubeService.getUserEmail.mockResolvedValue('user@youtube.com');
      const agent = request.agent(app);
      await agent.get('/auth/youtube/callback?code=valid-code');

      const res = await agent.get('/auth/youtube/status');
      expect(res.body).toEqual({ connected: true, email: 'user@youtube.com' });
    });

    it('returns disconnected when getUserEmail fails', async () => {
      youtubeService.exchangeCodeForTokens.mockResolvedValue({ access_token: 'tok' });
      youtubeService.getUserEmail.mockRejectedValue(new Error('token expired'));
      const agent = request.agent(app);
      await agent.get('/auth/youtube/callback?code=valid-code');

      const res = await agent.get('/auth/youtube/status');
      expect(res.body).toEqual({ connected: false, email: null });
    });
  });

  describe('POST /auth/youtube/fetch-key', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await request(app).post('/auth/youtube/fetch-key').send({});
      expect(res.status).toBe(401);
    });

    it('returns stream key without auto-start when ivsUrl omitted', async () => {
      youtubeService.exchangeCodeForTokens.mockResolvedValue({ access_token: 'tok' });
      youtubeService.fetchLiveStreamKey.mockResolvedValue('yt-key-123');
      const agent = request.agent(app);
      await agent.get('/auth/youtube/callback?code=valid-code');

      const res = await agent.post('/auth/youtube/fetch-key').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        key: 'yt-key-123',
        message: 'Stream key fetched',
        autoStarted: false,
      });
    });

    it('auto-starts stream when ivsUrl provided', async () => {
      youtubeService.exchangeCodeForTokens.mockResolvedValue({ access_token: 'tok' });
      youtubeService.fetchLiveStreamKey.mockResolvedValue('yt-key-123');
      const agent = request.agent(app);
      await agent.get('/auth/youtube/callback?code=valid-code');

      const res = await agent.post('/auth/youtube/fetch-key').send({
        ivsUrl: 'https://playback.ivs.example.com/stream.m3u8',
      });
      expect(res.status).toBe(200);
      expect(res.body.autoStarted).toBe(true);
      expect(ffmpegService.startPlatform).toHaveBeenCalled();
    });

    it('returns 409 when youtube already streaming', async () => {
      youtubeService.exchangeCodeForTokens.mockResolvedValue({ access_token: 'tok' });
      youtubeService.fetchLiveStreamKey.mockResolvedValue('yt-key-123');
      ffmpegService.isPlatformActive.mockReturnValue(true);
      const agent = request.agent(app);
      await agent.get('/auth/youtube/callback?code=valid-code');

      const res = await agent.post('/auth/youtube/fetch-key').send({
        ivsUrl: 'https://playback.ivs.example.com/stream.m3u8',
      });
      expect(res.status).toBe(409);
    });

    it('returns 503 when ffmpeg start fails', async () => {
      youtubeService.exchangeCodeForTokens.mockResolvedValue({ access_token: 'tok' });
      youtubeService.fetchLiveStreamKey.mockResolvedValue('yt-key-123');
      ffmpegService.startPlatform.mockReturnValue({ ok: false, reason: 'ffmpeg_unavailable' });
      const agent = request.agent(app);
      await agent.get('/auth/youtube/callback?code=valid-code');

      const res = await agent.post('/auth/youtube/fetch-key').send({
        ivsUrl: 'https://playback.ivs.example.com/stream.m3u8',
      });
      expect(res.status).toBe(503);
    });

    it('returns 404 when no YouTube live stream exists', async () => {
      youtubeService.exchangeCodeForTokens.mockResolvedValue({ access_token: 'tok' });
      const err = new Error('No YouTube live stream found.');
      err.statusCode = 404;
      youtubeService.fetchLiveStreamKey.mockRejectedValue(err);
      const agent = request.agent(app);
      await agent.get('/auth/youtube/callback?code=valid-code');

      const res = await agent.post('/auth/youtube/fetch-key').send({});
      expect(res.status).toBe(404);
    });
  });

  describe('POST /auth/youtube/disconnect', () => {
    it('clears session and returns success', async () => {
      youtubeService.exchangeCodeForTokens.mockResolvedValue({ access_token: 'tok' });
      const agent = request.agent(app);
      await agent.get('/auth/youtube/callback?code=valid-code');

      const res = await agent.post('/auth/youtube/disconnect');
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('YouTube disconnected');

      const statusRes = await agent.get('/auth/youtube/status');
      expect(statusRes.body.connected).toBe(false);
    });
  });
});
