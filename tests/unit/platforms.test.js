const {
  isValidPlatform,
  platformLabel,
  buildOutputUrl,
  listPlatforms,
  PLATFORMS,
} = require('../../src/constants/platforms');

describe('platforms constants', () => {
  describe('isValidPlatform', () => {
    it('returns true for known platforms', () => {
      expect(isValidPlatform('youtube')).toBe(true);
      expect(isValidPlatform('twitch')).toBe(true);
      expect(isValidPlatform('facebook')).toBe(true);
      expect(isValidPlatform('custom')).toBe(true);
    });

    it('returns false for unknown platforms', () => {
      expect(isValidPlatform('unknown')).toBe(false);
      expect(isValidPlatform('')).toBe(false);
    });
  });

  describe('platformLabel', () => {
    it('returns display name for known platform', () => {
      expect(platformLabel('youtube')).toBe('YouTube');
    });

    it('falls back to raw id for unknown platform', () => {
      expect(platformLabel('unknown')).toBe('unknown');
    });
  });

  describe('buildOutputUrl', () => {
    it('prepends YouTube RTMP base URL', () => {
      expect(buildOutputUrl('youtube', 'my-key')).toBe(
        `${PLATFORMS.youtube.url}my-key`
      );
    });

    it('concatenates custom URL and key', () => {
      expect(buildOutputUrl('custom', 'key', 'rtmp://x/')).toBe('rtmp://x/key');
    });

    it('returns key only for custom with empty base URL', () => {
      expect(buildOutputUrl('custom', 'key', '')).toBe('key');
    });
  });

  describe('listPlatforms', () => {
    it('returns all platforms with id, name, and url', () => {
      const platforms = listPlatforms();
      expect(platforms).toHaveLength(4);
      expect(platforms[0]).toEqual(
        expect.objectContaining({ id: expect.any(String), name: expect.any(String), url: expect.any(String) })
      );
      expect(platforms.map((p) => p.id)).toEqual(
        expect.arrayContaining(['youtube', 'twitch', 'facebook', 'custom'])
      );
    });
  });
});
