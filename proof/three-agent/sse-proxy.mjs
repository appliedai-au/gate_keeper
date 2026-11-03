// Re-frames the TrueFoundry gateway's SSE stream for TrueForge. The gateway can put several
// `data:` lines in one event (no blank line between them); the AI SDK then joins them and
// fails with AI_JSONParseError. This proxy passes everything through unchanged except that
// it ends each `data:` line as its own event. Bodies are never logged.
import http from "node:http";
import { Readable } from "node:stream";
export function reframe() {
  let buf = "";
  const dec = new TextDecoder(), enc = new TextEncoder();
  return new TransformStream({
    transform(chunk, ctl) {
      // One decoder per stream so a UTF-8 character split across chunks survives.
      buf += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
        if (line === "") continue;
        ctl.enqueue(enc.encode(line + (line.startsWith("data:") ? "\n\n" : "\n")));
      }
    },
    flush(ctl) { buf += dec.decode(); if (buf.trim()) ctl.enqueue(enc.encode(buf + "\n\n")); },
  });
}
// prefix: a per-run random path segment. TrueForge refuses private hosts, so the proxy is
// reached through a public Railway domain; requests without the prefix get 404. The proxy
// never adds credentials: it forwards the caller's own Authorization header.
export function startProxy({ port = 8787, upstream = "https://stranger-builds.truefoundry.cloud", prefix = "" } = {}) {
  let requests = 0, reframed = 0, rejected = 0;
  const server = http.createServer(async (req, res) => {
    if (prefix && !req.url.startsWith("/" + prefix + "/")) { rejected++; res.writeHead(404); return res.end(); }
    if (prefix) req.url = req.url.slice(prefix.length + 1);
    requests++;
    try {
      const body = await new Promise((ok) => { const a = []; req.on("data", (d) => a.push(d)); req.on("end", () => ok(Buffer.concat(a))); });
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "content-length", "connection", "accept-encoding"].includes(k)));
      const r = await fetch(upstream + req.url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
      const type = r.headers.get("content-type") || "";
      const out = {}; r.headers.forEach((v, k) => { if (!["content-length", "content-encoding", "transfer-encoding", "connection"].includes(k)) out[k] = v; });
      res.writeHead(r.status, out);
      if (!r.body) return res.end();
      const stream = type.includes("text/event-stream") ? (reframed++, r.body.pipeThrough(reframe())) : r.body;
      Readable.fromWeb(stream).pipe(res);
    } catch (e) { if (!res.headersSent) res.writeHead(502); res.end(); }
  });
  server.listen(port, "::");
  return { server, stats: () => ({ requests, reframed, rejected }) };
}
