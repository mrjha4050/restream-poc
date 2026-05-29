const { config, validateEnv, reloadConfig } = require('../../src/config/env');

describe('env config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    reloadConfig();
  });

  describe('validateEnv', () => {
    it('does not throw in development with defaults', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.SERVICE_API_KEY;
      reloadConfig();
      expect(() => validateEnv()).not.toThrow();
    });

    it('throws in production without SERVICE_API_KEY', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SERVICE_API_KEY;
      process.env.SESSION_SECRET = 'prod-secret';
      reloadConfig();
      expect(() => validateEnv()).toThrow(/SERVICE_API_KEY/);
    });

    it('throws in production with default SESSION_SECRET', () => {
      process.env.NODE_ENV = 'production';
      process.env.SERVICE_API_KEY = 'secret';
      delete process.env.SESSION_SECRET;
      reloadConfig();
      expect(() => validateEnv()).toThrow(/SESSION_SECRET/);
    });
  });

  describe('reloadConfig', () => {
    it('parses PORT and LOG_BUFFER_SIZE from env', () => {
      process.env.PORT = '4000';
      process.env.LOG_BUFFER_SIZE = '50';
      reloadConfig();
      expect(config.port).toBe(4000);
      expect(config.logBufferSize).toBe(50);
    });

    it('uses default redirect URI based on PORT', () => {
      process.env.PORT = '5000';
      delete process.env.GOOGLE_REDIRECT_URI;
      reloadConfig();
      expect(config.google.redirectUri).toBe(
        'http://localhost:5000/auth/youtube/callback'
      );
    });
  });
});
