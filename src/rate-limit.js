const RateLimit = (() => {
  const DELAY_MS = 200;
  const MAX_RETRIES = 3;
  const BASE_BACKOFF_MS = 1000;

  let lastRequestTime = 0;
  let queue = Promise.resolve();

  /**
   * Drop-in replacement for fetch() that serialises requests through a queue
   * and retries on HTTP 429 with exponential back-off / Retry-After.
   */
  function rateLimitedFetch(url, options) {
    const request = queue.then(async () => {
      const now = Date.now();
      const elapsed = now - lastRequestTime;
      if (elapsed < DELAY_MS) {
        await sleep(DELAY_MS - elapsed);
      }

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const res = await fetch(url, options);
        lastRequestTime = Date.now();

        if (res.status !== 429) return res;

        if (attempt < MAX_RETRIES) {
          const retryAfter = parseRetryAfter(res);
          const backoff = retryAfter || BASE_BACKOFF_MS * Math.pow(2, attempt);
          await sleep(backoff);
        }
      }

      // All retries exhausted — return the last 429 so the caller's !res.ok check fires
      lastRequestTime = Date.now();
      return { ok: false, status: 429, json: async () => ({}) };
    });

    // Chain next request after this one settles (success or failure)
    queue = request.catch(() => {});
    return request;
  }

  function parseRetryAfter(res) {
    const header = res.headers && res.headers.get && res.headers.get('Retry-After');
    if (!header) return null;
    const seconds = Number(header);
    return isNaN(seconds) ? null : seconds * 1000;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Reset internal state between tests. */
  function _reset() {
    lastRequestTime = 0;
    queue = Promise.resolve();
  }

  return { rateLimitedFetch, _reset };
})();

if (typeof module !== 'undefined') module.exports = RateLimit;
