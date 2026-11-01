// Settings: user overrides (JSON from the browser) applied over workspace defaults.

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Deep-merge source into target and return the result. */
export function deepMerge(target, source) {
  for (const key in source) {
    if (isObject(source[key])) {
      if (!isObject(target[key])) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

/** Effective settings for a user. */
export function effectiveSettings(defaults, userJson) {
  return deepMerge(defaults, JSON.parse(userJson));
}
