const mockGenerateAuthUrl = jest.fn(() => 'https://accounts.google.com/o/oauth2/auth');
const mockGetToken = jest.fn();
const mockSetCredentials = jest.fn();
const mockUserinfoGet = jest.fn();
const mockLiveStreamsList = jest.fn();
const mockLiveBroadcastsList = jest.fn();
const mockLiveBroadcastsInsert = jest.fn();
const mockLiveBroadcastsBind = jest.fn();
const mockLiveBroadcastsTransition = jest.fn();
const mockLiveStreamsInsert = jest.fn();

const sampleStreamItem = {
  id: 'stream-abc',
  snippet: { title: 'Main Stream', description: 'Desc' },
  status: { streamStatus: 'active', healthStatus: 'good' },
  cdn: {
    resolution: '1080p',
    frameRate: '30fps',
    ingestionInfo: {
      streamName: 'yt-stream-key',
      ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2',
      backupIngestionAddress: 'rtmp://b.rtmp.youtube.com/live2?backup=1',
    },
  },
};

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
      liveStreams: { list: mockLiveStreamsList, insert: mockLiveStreamsInsert },
      liveBroadcasts: {
        list: mockLiveBroadcastsList,
        insert: mockLiveBroadcastsInsert,
        bind: mockLiveBroadcastsBind,
        transition: mockLiveBroadcastsTransition,
      },
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
          scope: expect.arrayContaining([
            'https://www.googleapis.com/auth/youtube',
            'https://www.googleapis.com/auth/youtube.readonly',
            'https://www.googleapis.com/auth/userinfo.email',
          ]),
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

  describe('ensureYouTubeLiveSetup / fetchLiveStreamDetails', () => {
    beforeEach(() => {
      mockLiveStreamsList.mockResolvedValue({
        data: { items: [sampleStreamItem] },
      });
      mockLiveBroadcastsList.mockResolvedValue({
        data: {
          items: [
            {
              id: 'broadcast-1',
              snippet: {
                title: 'Live Show',
                scheduledStartTime: '2026-06-01T12:00:00Z',
              },
              status: {
                privacyStatus: 'public',
                lifeCycleStatus: 'ready',
                recordingStatus: 'notRecording',
              },
              contentDetails: { boundStreamId: 'stream-abc' },
            },
          ],
        },
      });
    });

    it('returns stream key, stream metadata, and matched broadcast', async () => {
      const details = await youtubeService.ensureYouTubeLiveSetup({ access_token: 'tok' });
      expect(details.key).toBe('yt-stream-key');
      expect(details.rtmpUrl).toBe('rtmp://a.rtmp.youtube.com/live2/yt-stream-key');
      expect(details.stream.title).toBe('Main Stream');
      expect(details.stream.cdn.resolution).toBe('1080p');
      expect(details.broadcast.title).toBe('Live Show');
      expect(details.streams).toHaveLength(1);
      expect(mockLiveStreamsList).toHaveBeenCalledWith(
        expect.objectContaining({ part: ['snippet', 'cdn', 'status'] })
      );
    });

    it('returns stream key from fetchLiveStreamKey helper', async () => {
      const key = await youtubeService.fetchLiveStreamKey({ access_token: 'tok' });
      expect(key).toBe('yt-stream-key');
    });

    it('throws 404 when no live streams exist and auto-create disabled', async () => {
      mockLiveStreamsList.mockResolvedValue({ data: { items: [] } });
      await expect(
        youtubeService.ensureYouTubeLiveSetup(
          { access_token: 'tok' },
          { createIfMissing: false }
        )
      ).rejects.toMatchObject({
        message: expect.stringContaining('No YouTube live stream found'),
        statusCode: 404,
      });
    });

    it('throws 404 when items is undefined and auto-create disabled', async () => {
      mockLiveStreamsList.mockResolvedValue({ data: {} });
      await expect(
        youtubeService.ensureYouTubeLiveSetup(
          { access_token: 'tok' },
          { createIfMissing: false }
        )
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('auto-creates stream and broadcast when none exist', async () => {
      mockLiveStreamsList.mockResolvedValueOnce({ data: { items: [] } });
      mockLiveStreamsInsert.mockResolvedValue({
        data: sampleStreamItem,
      });
      mockLiveBroadcastsInsert.mockResolvedValue({
        data: {
          id: 'broadcast-new',
          snippet: { title: 'New Event' },
          status: { lifeCycleStatus: 'created', privacyStatus: 'unlisted' },
          contentDetails: {},
        },
      });
      mockLiveBroadcastsList
        .mockResolvedValueOnce({ data: { items: [] } })
        .mockResolvedValueOnce({
          data: {
            items: [
              {
                id: 'broadcast-new',
                snippet: { title: 'New Event' },
                status: { lifeCycleStatus: 'created' },
                contentDetails: {},
              },
            ],
          },
        })
        .mockResolvedValue({
          data: {
            items: [
              {
                id: 'broadcast-new',
                snippet: { title: 'New Event' },
                status: { lifeCycleStatus: 'created' },
                contentDetails: { boundStreamId: 'stream-abc' },
              },
            ],
          },
        });

      const details = await youtubeService.ensureYouTubeLiveSetup(
        { access_token: 'tok' },
        { broadcastTitle: 'My Auto Event', privacyStatus: 'public' }
      );

      expect(details.autoCreated).toEqual({ stream: true, broadcast: true });
      expect(mockLiveStreamsInsert).toHaveBeenCalled();
      expect(mockLiveBroadcastsInsert).toHaveBeenCalled();
      expect(mockLiveBroadcastsBind).toHaveBeenCalled();
    });

    it('throws when nothing exists and createIfMissing is false', async () => {
      mockLiveStreamsList.mockResolvedValue({ data: { items: [] } });
      await expect(
        youtubeService.ensureYouTubeLiveSetup(
          { access_token: 'tok' },
          { createIfMissing: false }
        )
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('prepareYouTubeBroadcast / goLiveYouTubeBroadcast', () => {
    beforeEach(() => {
      mockLiveBroadcastsList.mockImplementation(({ id }) => {
        if (id) {
          return Promise.resolve({
            data: {
              items: [
                {
                  id: 'broadcast-1',
                  status: { lifeCycleStatus: 'ready' },
                  contentDetails: { boundStreamId: null },
                },
              ],
            },
          });
        }
        return Promise.resolve({
          data: {
            items: [
              {
                id: 'broadcast-1',
                status: { lifeCycleStatus: 'ready' },
                contentDetails: { boundStreamId: null },
              },
            ],
          },
        });
      });
      mockLiveBroadcastsBind.mockResolvedValue({});
      mockLiveBroadcastsTransition.mockResolvedValue({});
      mockLiveStreamsList.mockResolvedValue({
        data: {
          items: [{ id: 'stream-abc', status: { streamStatus: 'active' } }],
        },
      });
    });

    it('binds stream, transitions to testing, then live', async () => {
      mockLiveBroadcastsList
        .mockImplementationOnce(({ id }) =>
          Promise.resolve({
            data: {
              items: [
                {
                  id: id?.[0] || 'broadcast-1',
                  status: { lifeCycleStatus: 'ready' },
                  contentDetails: {},
                },
              ],
            },
          })
        )
        .mockImplementation(({ id }) => {
          const lifeCycle =
            mockLiveBroadcastsTransition.mock.calls.length >= 2 ? 'testing' : 'ready';
          return Promise.resolve({
            data: {
              items: [
                {
                  id: id?.[0] || 'broadcast-1',
                  status: { lifeCycleStatus: lifeCycle },
                  contentDetails: { boundStreamId: 'stream-abc' },
                },
              ],
            },
          });
        });

      const prep = await youtubeService.prepareYouTubeBroadcast(
        { access_token: 'tok' },
        { streamId: 'stream-abc', broadcastId: 'broadcast-1' }
      );
      expect(prep.lifeCycleStatus).toBe('testing');
      expect(mockLiveBroadcastsBind).toHaveBeenCalled();

      const live = await youtubeService.goLiveYouTubeBroadcast(
        { access_token: 'tok' },
        'broadcast-1',
        'stream-abc',
        { deferTesting: false }
      );
      expect(live.lifeCycleStatus).toBe('live');
      expect(mockLiveBroadcastsTransition).toHaveBeenCalledWith(
        expect.objectContaining({ broadcastStatus: 'live' })
      );
    });
  });
});
