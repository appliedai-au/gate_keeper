// Private evidence handling. Raw traces, replies, adjudications, holdout data
// and test logs are written to a private directory, hashed, and uploaded to an
// owner-controlled S3-compatible bucket. Only hashes and object keys are ever
// printed; the public summary never contains raw content.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256 } from "./config.mjs";

export class EvidenceStore {
  constructor(root, runId) {
    this.root = join(root, runId);
    this.runId = runId;
    this.items = [];
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }
  put(rel, value, kind) {
    if (rel.includes("..") || rel.startsWith("/")) throw new Error("EVIDENCE_PATH_UNSAFE");
    const body = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
    const full = join(this.root, rel);
    mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
    writeFileSync(full, body, { mode: 0o600, flag: "wx" });
    const item = { kind, path: rel, sha256: sha256(body), bytes: Buffer.byteLength(body) };
    this.items.push(item);
    return item;
  }
  manifest() {
    const body = { run_id: this.runId, items: [...this.items].sort((a, b) => a.path.localeCompare(b.path)) };
    return { body, sha256: sha256(JSON.stringify(body)) };
  }
  /** Upload every item plus the manifest. Returns {uploaded, reference} or a reason. */
  async upload({ endpoint, bucket, region, accessKeyId, secretAccessKey, forcePathStyle = true }) {
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return { uploaded: false, reason: "PRIVATE_STORAGE_NOT_CONFIGURED" };
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({ endpoint, region: region || "auto", forcePathStyle, credentials: { accessKeyId, secretAccessKey } });
    const prefix = `gate-keeper-proof/${this.runId}/`;
    const m = this.manifest();
    const all = [...this.items.map((i) => ({ key: prefix + i.path, body: readFileSync(join(this.root, i.path)), sha: i.sha256 })),
      { key: prefix + "MANIFEST.json", body: JSON.stringify(m.body), sha: m.sha256 }];
    for (const o of all) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: o.key, Body: o.body, Metadata: { sha256: o.sha },
        ContentType: o.key.endsWith(".json") ? "application/json" : "text/plain" }));
    }
    return { uploaded: true, objects: all.length, reference: `railway-bucket://${bucket}/${prefix}`, manifest_sha256: m.sha256 };
  }
}
