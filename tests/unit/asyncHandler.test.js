const asyncHandler = require('../../src/utils/asyncHandler');

describe('asyncHandler', () => {
  it('calls sync handler without error', async () => {
    const handler = asyncHandler((req, res) => {
      res.sent = true;
    });
    const res = {};
    await handler({}, res, jest.fn());
    expect(res.sent).toBe(true);
  });

  it('forwards async rejection to next', async () => {
    const error = new Error('async fail');
    const handler = asyncHandler(async () => {
      throw error;
    });
    const next = jest.fn();
    await handler({}, {}, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});
