// Version ordering for the plugin updater.

/** Compare two semantic versions. Returns -1, 0 or 1. */
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/** Newest version in a list. */
export function newest(versions) {
  return [...versions].sort(compareVersions).at(-1);
}
