// Per-key request limiter for the public API. Time is injected (milliseconds).

export function createLimiter({ limit, windowMs }) {
  const windows = {};
  return {
    /** True if this request is allowed for key at time now. */
    allow(key, now) {
      const w = windows[key];
      if (!w || now - w.start >= windowMs) {
        windows[key] = { start: now, count: 1 };
        return true;
      }
      if (w.count >= limit) return false;
      w.count += 1;
      return true;
    },
    /** Forget keys with no requests in the last window. */
    sweep(now) {
      for (const key in windows) if (now - windows[key].start >= windowMs) delete windows[key];
    },
    /** Number of keys currently tracked. */
    size() {
      return Object.keys(windows).length;
    },
  };
}
