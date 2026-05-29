const mockGenerateAuthUrl = jest.fn(() => 'https://accounts.google.com/o/oauth2/auth');
const mockGetToken = jest.fn();
const mockSetCredentials = jest.fn();
const mockUserinfoGet = jest.fn();
const mockLiveStreamsList = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: mockGenerateAuthUrl,
        getToken: mockGetToken,
        setCredentials: mockSetCredentials,
      })),
    },
    oauth2: jest.fn(() => ({
      userinfo: { get: mockUserinfoGet },
    })),
    youtube: jest.fn(() => ({
      liveStreams: { list: mockLiveStreamsList },
    })),
  },
}));

const { reloadConfig } = require('../../src/config/env');
const youtubeService = require('../../src/services/youtube.service');

describe('youtube.service', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    reloadConfig();
    jest.clearAllMocks();
  });

  describe('isConfigured', () => {
    it('returns false when credentials missing', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      reloadConfig();
      expect(youtubeService.isConfigured()).toBe(false);
    });

    it('returns true when both credentials set', () => {
      expect(youtubeService.isConfigured()).toBe(true);
    });
  });

  describe('createOAuth2Client', () => {
    it('throws when credentials not configured', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      reloadConfig();
      expect(() => youtubeService.createOAuth2Client()).toThrow(
        /Google OAuth credentials are not configured/
      );
    });
  });

  describe('getAuthUrl', () => {
    it('returns OAuth URL from client', () => {
      expect(youtubeService.getAuthUrl()).toBe(
        'https://accounts.google.com/o/oauth2/auth'
      );
      expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          access_type: 'offline',
          prompt: 'consent',
        })
      );
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('returns tokens from Google', async () => {
      mockGetToken.mockResolvedValue({ tokens: { access_token: 'tok' } });
      const tokens = await youtubeService.exchangeCodeForTokens('auth-code');
      expect(tokens).toEqual({ access_token: 'tok' });
      expect(mockGetToken).toHaveBeenCalledWith('auth-code');
    });
  });

  describe('getUserEmail', () => {
    it('returns email from userinfo API', async () => {
      mockUserinfoGet.mockResolvedValue({ data: { email: 'user@example.com' } });
      const email = await youtubeService.getUserEmail({ access_token: 'tok' });
      expect(email).toBe('user@example.com');
    });
  });

  describe('fetchLiveStreamKey', () => {
    it('returns stream key from first live stream', async () => {
      mockLiveStreamsList.mockResolvedValue({
        data: {
          items: [{ cdn: { ingestionInfo: { streamName: 'yt-stream-key' } } }],
        },
      });
      const key = await youtubeService.fetchLiveStreamKey({ access_token: 'tok' });
      expect(key).toBe('yt-stream-key');
    });

    it('throws 404 when no live streams exist', async () => {
      mockLiveStreamsList.mockResolvedValue({ data: { items: [] } });
      await expect(
        youtubeService.fetchLiveStreamKey({ access_token: 'tok' })
      ).rejects.toMatchObject({
        message: expect.stringContaining('No YouTube live stream found'),
        statusCode: 404,
      });
    });

    it('throws 404 when items is undefined', async () => {
      mockLiveStreamsList.mockResolvedValue({ data: {} });
      await expect(
        youtubeService.fetchLiveStreamKey({ access_token: 'tok' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
