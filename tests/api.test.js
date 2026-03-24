const RateLimit = require('../src/rate-limit');
const API = require('../src/api');

beforeEach(() => {
  jest.resetAllMocks();
  RateLimit._reset();
});

function mockFetch(body, status = 200) {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('getAlerts', () => {
  test('GETs /api/web/alerts and returns parsed JSON', async () => {
    const alerts = [{ id: '1', itemId: 44015 }];
    mockFetch(alerts);
    const result = await API.getAlerts();
    expect(global.fetch).toHaveBeenCalledWith('/api/web/alerts', undefined);
    expect(result).toEqual(alerts);
  });

  test('throws on non-ok response', async () => {
    mockFetch({ error: 'Unauthorized' }, 401);
    await expect(API.getAlerts()).rejects.toThrow('HTTP 401');
  });
});

describe('createAlert', () => {
  test('POSTs payload to /api/web/alerts with JSON headers', async () => {
    mockFetch({ id: 'new-id' });
    const payload = { itemId: 44015, worldId: 4030, name: 'Test' };
    await API.createAlert(payload);
    expect(global.fetch).toHaveBeenCalledWith('/api/web/alerts', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    }));
  });

  test('throws on non-ok response', async () => {
    mockFetch({}, 400);
    await expect(API.createAlert({})).rejects.toThrow('HTTP 400');
  });
});

describe('deleteAlert', () => {
  test('sends DELETE to /api/web/alerts/{id}', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 204 });
    await API.deleteAlert('alert-abc');
    expect(global.fetch).toHaveBeenCalledWith('/api/web/alerts/alert-abc', { method: 'DELETE' });
  });

  test('throws on non-ok response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 });
    await expect(API.deleteAlert('bad-id')).rejects.toThrow('HTTP 404');
  });
});
