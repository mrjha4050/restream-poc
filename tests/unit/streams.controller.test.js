jest.mock('../../src/services/ffmpeg.service', () => ({
  startPlatform: jest.fn(),
  isPlatformActive: jest.fn(),
  stopPlatform: jest.fn(),
  stopAllPlatforms: jest.fn(),
  getStatus: jest.fn(),
}));

jest.mock('../../src/constants/platforms', () => {
  const actual = jest.requireActual('../../src/constants/platforms');
  return {
    ...actual,
    buildOutputUrl: jest.fn(actual.buildOutputUrl),
  };
});

const streamsController = require('../../src/controllers/streams.controller');
const ffmpegService = require('../../src/services/ffmpeg.service');
const { buildOutputUrl } = require('../../src/constants/platforms');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('streams.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ffmpegService.isPlatformActive.mockReturnValue(false);
    ffmpegService.startPlatform.mockReturnValue({ ok: true });
  });

  describe('startPlatform', () => {
    it('returns 400 when buildOutputUrl returns empty string', () => {
      buildOutputUrl.mockReturnValue('');
      const req = {
        params: { id: 'youtube' },
        body: { ivsUrl: 'https://ivs/', key: 'key' },
      };
      const res = mockRes();
      streamsController.startPlatform(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('Could not build output URL');
    });
  });
});
