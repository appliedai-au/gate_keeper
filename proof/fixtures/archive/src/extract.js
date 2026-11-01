// Archive extraction: map each archive entry name to its destination path.
import path from "node:path";

/** Destination for an archive entry inside destDir. */
export function entryDestination(destDir, entryName) {
  if (typeof entryName !== "string" || entryName === "") throw new TypeError("entry name required");
  return path.join(destDir, entryName);
}

/** Plan an extraction: returns [{name, dest}] for every entry, in order. */
export function planExtraction(destDir, entryNames) {
  return entryNames.map((name) => ({ name, dest: entryDestination(destDir, name) }));
}
