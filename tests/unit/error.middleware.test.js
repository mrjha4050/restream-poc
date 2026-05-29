jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  requestId,
  notFound,
  errorHandler,
} = require('../../src/middleware/error.middleware');

describe('error.middleware', () => {
  describe('requestId', () => {
    it('preserves incoming X-Request-Id', () => {
      const req = { headers: { 'x-request-id': 'custom-id' } };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();
      requestId(req, res, next);
      expect(req.requestId).toBe('custom-id');
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'custom-id');
      expect(next).toHaveBeenCalled();
    });

    it('generates id when header missing', () => {
      const req = { headers: {} };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();
      requestId(req, res, next);
      expect(req.requestId).toMatch(/^req-/);
    });
  });

  describe('notFound', () => {
    it('returns 404 with path', () => {
      const req = { originalUrl: '/missing' };
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.body = payload;
        },
      };
      notFound(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({
        message: 'Route not found',
        path: '/missing',
      });
    });
  });

  describe('errorHandler', () => {
    it('uses err.statusCode when present', () => {
      const err = Object.assign(new Error('Not found'), { statusCode: 404 });
      const req = { requestId: 'r1' };
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.body = payload;
        },
      };
      errorHandler(err, req, res, jest.fn());
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ message: 'Not found', requestId: 'r1' });
    });

    it('defaults to 500 for unknown errors', () => {
      const err = new Error();
      const req = { requestId: 'r2' };
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.body = payload;
        },
      };
      errorHandler(err, req, res, jest.fn());
      expect(res.statusCode).toBe(500);
      expect(res.body.message).toBe('Internal server error');
    });
  });
});
