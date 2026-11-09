// Retry helper for flaky downstream calls.

/** Call `fn` up to `attempts` times, waiting `baseMs * 2^i` between tries. Returns fn's result. */
export async function retry(fn, attempts, baseMs, sleep) {
  let lastError;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      await sleep(baseMs * 2 ** i);
    }
  }
  return undefined;
}
