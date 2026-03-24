const RateLimit = require('../src/rate-limit');

beforeEach(() => {
  jest.resetAllMocks();
  jest.useRealTimers();
  RateLimit._reset();
});

function okResponse(body = {}) {
  return { ok: true, status: 200, json: async () => body, headers: new Map() };
}

function response429(retryAfterSeconds) {
  const headers = new Map();
  if (retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(retryAfterSeconds));
  }
  return {
    ok: false,
    status: 429,
    json: async () => ({}),
    headers: { get: (k) => headers.get(k) },
  };
}

describe('rateLimitedFetch', () => {
  test('passes through a successful response', async () => {
    const body = { id: 1 };
    jest.spyOn(global, 'fetch').mockResolvedValue(okResponse(body));

    const res = await RateLimit.rateLimitedFetch('/test');
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual(body);
    expect(global.fetch).toHaveBeenCalledWith('/test', undefined);
  });

  test('passes options through to fetch', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(okResponse());
    const opts = { method: 'POST', body: '{}' };

    await RateLimit.rateLimitedFetch('/test', opts);
    expect(global.fetch).toHaveBeenCalledWith('/test', opts);
  });

  test('serialises concurrent requests', async () => {
    const callOrder = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      callOrder.push(url);
      return okResponse();
    });

    // Fire three requests concurrently
    const p1 = RateLimit.rateLimitedFetch('/a');
    const p2 = RateLimit.rateLimitedFetch('/b');
    const p3 = RateLimit.rateLimitedFetch('/c');

    await Promise.all([p1, p2, p3]);

    // All should have completed, in order
    expect(callOrder).toEqual(['/a', '/b', '/c']);
  });

  test('retries on 429 and succeeds on subsequent attempt', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response429(0))
      .mockResolvedValueOnce(okResponse({ retried: true }));

    const res = await RateLimit.rateLimitedFetch('/test');
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ retried: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('respects Retry-After header', async () => {
    jest.useFakeTimers();
    const sleepSpy = [];

    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response429(2))
      .mockResolvedValueOnce(okResponse());

    const promise = RateLimit.rateLimitedFetch('/test');

    // Let the first fetch resolve and the retry-after sleep start
    await jest.advanceTimersByTimeAsync(2000);
    await promise;

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('returns 429 response after max retries exhausted', async () => {
    jest.useFakeTimers();
    jest.spyOn(global, 'fetch').mockResolvedValue(response429());

    const promise = RateLimit.rateLimitedFetch('/test');

    // Advance through all backoff delays: 1000 + 2000 + 4000
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(4000);

    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
    // 1 initial + 3 retries = 4 calls
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  test('does not retry on non-429 errors', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 500, json: async () => ({}), headers: new Map(),
    });

    const res = await RateLimit.rateLimitedFetch('/test');
    expect(res.status).toBe(500);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('queue continues after a failed request', async () => {
    jest.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(okResponse({ second: true }));

    const p1 = RateLimit.rateLimitedFetch('/fail');
    const p2 = RateLimit.rateLimitedFetch('/ok');

    await expect(p1).rejects.toThrow('Network error');

    const res = await p2;
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ second: true });
  });
});
