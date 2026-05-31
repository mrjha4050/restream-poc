const { reloadConfig } = require('../../src/config/env');
const facebookService = require('../../src/services/facebook.service');

describe('facebook.service', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.FACEBOOK_APP_ID = 'fb-app-id';
    process.env.FACEBOOK_APP_SECRET = 'fb-app-secret';
    reloadConfig();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('isConfigured', () => {
    it('returns false when credentials missing', () => {
      delete process.env.FACEBOOK_APP_ID;
      reloadConfig();
      expect(facebookService.isConfigured()).toBe(false);
    });

    it('returns true when both credentials set', () => {
      expect(facebookService.isConfigured()).toBe(true);
    });
  });

  describe('getAuthUrl', () => {
    it('throws when credentials not configured', () => {
      delete process.env.FACEBOOK_APP_ID;
      reloadConfig();
      expect(() => facebookService.getAuthUrl()).toThrow(
        /Facebook OAuth credentials are not configured/
      );
    });

    it('returns Facebook OAuth URL with scopes', () => {
      const url = facebookService.getAuthUrl();
      expect(url).toContain('facebook.com');
      expect(url).toContain('client_id=fb-app-id');
      expect(url).toContain('pages_show_list');
      expect(url).toContain('pages_manage_posts');
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('returns normalized token payload', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'user-token', expires_in: 3600 }),
      });

      const tokens = await facebookService.exchangeCodeForTokens('auth-code');
      expect(tokens).toEqual({
        accessToken: 'user-token',
        expiresIn: 3600,
      });
    });

    it('throws when token exchange fails', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Invalid code' } }),
      });

      await expect(facebookService.exchangeCodeForTokens('bad-code')).rejects.toThrow(
        'Invalid code'
      );
    });
  });

  describe('getUserProfile', () => {
    it('returns user id and name', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'user-1', name: 'Jane Doe' }),
      });

      const profile = await facebookService.getUserProfile('user-token');
      expect(profile).toEqual({ id: 'user-1', name: 'Jane Doe' });
    });
  });

  describe('getManagedPages', () => {
    it('returns page list with access tokens', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: 'page-1', name: 'My Page', access_token: 'page-token' }],
        }),
      });

      const pages = await facebookService.getManagedPages('user-token');
      expect(pages).toEqual([
        { id: 'page-1', name: 'My Page', accessToken: 'page-token' },
      ]);
    });
  });

  describe('createLiveVideo', () => {
    it('returns live video id and secure stream url', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'live-123',
          secure_stream_url: 'rtmps://rtmp-api.facebook.com/rtmp/live-123',
        }),
      });

      const liveVideo = await facebookService.createLiveVideo('page-token', 'page-1', {
        title: 'Test Stream',
      });
      expect(liveVideo).toEqual({
        liveVideoId: 'live-123',
        secureStreamUrl: 'rtmps://rtmp-api.facebook.com/rtmp/live-123',
      });
    });

    it('throws when secure stream url missing', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'live-123' }),
      });

      await expect(
        facebookService.createLiveVideo('page-token', 'page-1')
      ).rejects.toMatchObject({
        message: expect.stringContaining('secure stream URL'),
        statusCode: 502,
      });
    });
  });

  describe('endLiveVideo', () => {
    it('posts end_live_video to Graph API', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await expect(
        facebookService.endLiveVideo('page-token', 'live-123')
      ).resolves.toBeUndefined();
      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
