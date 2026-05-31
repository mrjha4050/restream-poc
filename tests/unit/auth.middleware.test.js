const serviceAuth = require('../../src/middleware/auth.middleware');
const { reloadConfig } = require('../../src/config/env');

function runAuth(path, headers = {}) {
  const req = { path, headers };
  const res = {
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
  const next = jest.fn();
  serviceAuth(req, res, next);
  return { req, res, next };
}

describe('auth.middleware', () => {
  describe('isPublicPath', () => {
    it('marks health and auth paths as public', () => {
      expect(serviceAuth.isPublicPath('/health')).toBe(true);
      expect(serviceAuth.isPublicPath('/ready')).toBe(true);
      expect(serviceAuth.isPublicPath('/auth/youtube')).toBe(true);
      expect(serviceAuth.isPublicPath('/auth/youtube/callback')).toBe(true);
      expect(serviceAuth.isPublicPath('/auth/facebook')).toBe(true);
      expect(serviceAuth.isPublicPath('/auth/facebook/callback')).toBe(true);
      expect(serviceAuth.isPublicPath('/platforms')).toBe(false);
    });
  });

  describe('serviceAuth', () => {
    it('allows public paths without key', () => {
      process.env.SERVICE_API_KEY = 'secret';
      reloadConfig();
      const { next, res } = runAuth('/health');
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it('allows protected path with valid key', () => {
      process.env.SERVICE_API_KEY = 'secret';
      process.env.NODE_ENV = 'development';
      reloadConfig();
      const { next } = runAuth('/platforms', { 'x-service-key': 'secret' });
      expect(next).toHaveBeenCalled();
    });

    it('returns 401 for wrong key', () => {
      process.env.SERVICE_API_KEY = 'secret';
      process.env.NODE_ENV = 'development';
      reloadConfig();
      const { next, res } = runAuth('/platforms', { 'x-service-key': 'wrong' });
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.body.message).toBe('Unauthorized');
    });

    it('returns 503 in production when key not configured', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SERVICE_API_KEY;
      reloadConfig();
      const { next, res } = runAuth('/platforms');
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(503);
    });

    it('bypasses auth in development when key not configured', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.SERVICE_API_KEY;
      reloadConfig();
      const { next } = runAuth('/platforms');
      expect(next).toHaveBeenCalled();
    });
  });
});
