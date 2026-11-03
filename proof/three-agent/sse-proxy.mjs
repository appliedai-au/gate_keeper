// Re-frames the TrueFoundry gateway's SSE stream for TrueForge. The gateway can put several
// `data:` lines in one event (no blank line between them); the AI SDK then joins them and
// fails with AI_JSONParseError. This proxy passes everything through unchanged except that
// it ends each `data:` line as its own event. Bodies are never logged.
import http from "node:http";
import { Readable } from "node:stream";
export function reframe() {
  let buf = "";
  return new TransformStream({
    transform(chunk, ctl) {
      buf += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
        if (line === "") continue;
        ctl.enqueue(new TextEncoder().encode(line + (line.startsWith("data:") ? "\n\n" : "\n")));
      }
    },
    flush(ctl) { if (buf.trim()) ctl.enqueue(new TextEncoder().encode(buf + "\n\n")); },
  });
}
export function startProxy({ port = 8787, upstream = "https://stranger-builds.truefoundry.cloud" } = {}) {
  let requests = 0, reframed = 0;
  const server = http.createServer(async (req, res) => {
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
  return { server, stats: () => ({ requests, reframed }) };
}
