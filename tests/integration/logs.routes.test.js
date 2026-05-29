const request = require('supertest');
const logService = require('../../src/services/log.service');
const { createTestApp } = require('../helpers/createTestApp');

describe('logs routes', () => {
  const app = createTestApp();
  const serviceKey = { 'X-Service-Key': 'test-secret' };

  beforeEach(() => {
    logService.clearLogs();
  });

  describe('GET /logs', () => {
    it('returns historical logs as JSON array', async () => {
      logService.addLog('test log entry');
      const res = await request(app).get('/logs').set(serviceKey);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].message).toBe('test log entry');
    });

    it('returns empty array when no logs', async () => {
      const res = await request(app).get('/logs').set(serviceKey);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /stream-logs', () => {
    it('returns SSE content type and initial ping', (done) => {
      request(app)
        .get('/stream-logs')
        .set(serviceKey)
        .buffer(true)
        .parse((res, callback) => {
          res.setEncoding('utf8');
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
            if (data.includes(':ping')) {
              res.destroy();
              callback(null, data);
            }
          });
          res.on('error', callback);
        })
        .end((err, res) => {
          if (err) return done(err);
          expect(res.headers['content-type']).toMatch(/text\/event-stream/);
          expect(res.body).toContain(':ping');
          done();
        });
    });
  });

  describe('GET /logs/stream', () => {
    it('aliases stream-logs endpoint', (done) => {
      request(app)
        .get('/logs/stream')
        .set(serviceKey)
        .buffer(true)
        .parse((res, callback) => {
          res.setEncoding('utf8');
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
            res.destroy();
            callback(null, data);
          });
          res.on('error', callback);
        })
        .end((err, res) => {
          if (err) return done(err);
          expect(res.headers['content-type']).toMatch(/text\/event-stream/);
          done();
        });
    });
  });
});
