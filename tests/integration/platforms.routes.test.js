const request = require('supertest');
const { createTestApp } = require('../helpers/createTestApp');

describe('platforms routes', () => {
  const app = createTestApp();
  const serviceKey = { 'X-Service-Key': 'test-secret' };

  describe('GET /platforms', () => {
    it('returns all supported platforms', async () => {
      const res = await request(app).get('/platforms').set(serviceKey);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(4);
      expect(res.body.map((p) => p.id)).toEqual(
        expect.arrayContaining(['youtube', 'twitch', 'facebook', 'custom'])
      );
    });

    it('returns 401 without service key', async () => {
      const res = await request(app).get('/platforms');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Unauthorized');
    });
  });
});
