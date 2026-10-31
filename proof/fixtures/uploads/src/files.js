// Upload storage helpers. User-supplied paths are relative to UPLOAD_ROOT.
import { join } from "node:path";

export const UPLOAD_ROOT = "/srv/uploads";

/** Resolve a user-supplied relative path to an absolute path inside UPLOAD_ROOT. */
export function resolveUpload(userPath) {
  if (typeof userPath !== "string" || userPath.length === 0) throw new TypeError("path required");
  return join(UPLOAD_ROOT, userPath);
}

/** Read an upload through an injected fs-like object ({ readFileSync }). */
export function readUpload(fs, userPath) {
  return fs.readFileSync(resolveUpload(userPath), "utf8");
}
