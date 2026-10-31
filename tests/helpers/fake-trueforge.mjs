// SYNTHETIC test double for the TrueForge SDK. Used ONLY by harness tests to
// exercise orchestration logic offline. Nothing it produces is evidence.
const FIXES = {
  "src/money.js": `export function parseAmountCents(input) {
  if (typeof input !== "string") throw new TypeError("amount must be a string");
  const s = input.trim();
  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) throw new RangeError("invalid amount: " + input);
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
export function invoiceTotalCents(lines) {
  return lines.reduce((sum, line) => sum + parseAmountCents(line.amount) * line.qty, 0);
}`,
  "src/files.js": `import { join } from "node:path";
export const UPLOAD_ROOT = "/srv/uploads";
export function resolveUpload(userPath) {
  if (typeof userPath !== "string" || userPath.length === 0) throw new TypeError("path required");
  if (userPath.includes("..")) { const e = new Error("no"); e.code = "E_TRAVERSAL"; throw e; }
  return join(UPLOAD_ROOT, userPath);
}
export function readUpload(fs, userPath) { return fs.readFileSync(resolveUpload(userPath), "utf8"); }`,
};
const PAGINATE_FIX = `export function paginate(items, page, size) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  if (!Number.isInteger(page) || page < 1) throw new RangeError("page must be an integer >= 1");
  const totalPages = Math.ceil(items.length / size);
  if (items.length > 0 && page > totalPages) throw new RangeError("page out of range");
  const start = (page - 1) * size;
  return { items: items.slice(start, start + size), page, totalPages };
}
export function pageSummary(items, page, size) { const p = paginate(items, page, size); return \`Page \${p.page} of \${p.totalPages}: \${p.items.join(", ")}\`; }`;
export function fakeTrueForge({ models = ["anthropic/claude-sonnet-4-6"], costPerTurn = 0.01, failCreate = false } = {}) {
  const sessions = new Map(); const turns = new Map(); let n = 0;
  const reply = (instructions, content) => {
    if (/independent adjudicator for a code-review benchmark/.test(instructions)) {
      const ids = [...new Set(content.match(/f_[0-9a-f]{10}/g) || [])];
      return "```json\n" + JSON.stringify({ judgements: ids.map((id, i) => ({ id, matches: i % 2 ? null : "E1", real_defect: false, explanation_correct: i % 4 === 0 })) }) + "\n```";
    }
    if (/write ONE tenant-private lesson/.test(instructions)) return '```json\n{"lesson":"Check path containment after normalisation, not by rejecting dot segments."}\n```';
    if (/checking a repair gate/.test(instructions)) return '```json\n{"judgements":[{"index":0,"real":false}]}\n```';
    if (/Repair output contract/.test(instructions)) {
      if (content.includes("src/money.js")) return '```json\n' + JSON.stringify({ edits: [{ find: "Number(frac);", replace: 'Number(frac.padEnd(2, "0"));' }] }) + '\n```';
      if (content.includes("src/files.js")) return '```json\n' + JSON.stringify({ edits: [{ find: "  return join(UPLOAD_ROOT, userPath);", replace: '  if (userPath.includes("..")) { const e = new Error("no"); e.code = "E_TRAVERSAL"; throw e; }\n  return join(UPLOAD_ROOT, userPath);' }] }) + '\n```';
      if (content.includes("src/paginate.js")) return "```javascript\n" + PAGINATE_FIX + "\n```";
      return "no idea";
    }
    if (/\(repaired candidate\)/.test(content)) return /paginate/.test(content) ? '```json\n{"findings":[{"line":2,"category":"bug","severity":"high","comment":"synthetic gate block"}]}\n```' : '```json\n{"findings":[]}\n```';
    return '```json\n{"findings":[{"line":7,"category":"bug","severity":"high","comment":"synthetic finding"}]}\n```';
  };
  return {
    calls: () => n,
    server: { getCapabilities: async () => ({ data: { sandbox: { enabled: false }, skill: { enabled: false } } }) },
    models: { list: async () => ({ data: models.map((name) => ({ name })) }) },
    sessions: {
      create: async ({ agent, metadata = {} }) => { if (Object.values(metadata).some((v) => typeof v !== "string")) throw new Error("JsonError: metadata values must be strings"); const id = "s" + sessions.size; sessions.set(id, agent.spec); return { data: { id } }; },
      createTurn: async (sid, { input }) => {
        if (failCreate) throw new Error("synthetic create failure");
        n++; const id = "t" + n; const createdAt = new Date().toISOString();
        const text = reply(sessions.get(sid).instructions || "", input[0].content);
        turns.set(id, { id, sessionId: sid, createdAt, state: { status: "done", completedAt: new Date(Date.now() + 5).toISOString(), output: { content: text }, metrics: { totalTokens: 1000, totalCostInUsd: costPerTurn } } });
        return { data: { id, sessionId: sid, createdAt, state: { status: "running" } } };
      },
      getTurn: async (sid, tid) => ({ data: turns.get(tid) }),
      cancel: async () => ({}),
      get: async (sid) => ({ data: { id: sid } }),
      listTurns: async (sid) => [...turns.values()].filter((t) => t.sessionId === sid),
      listTurnEvents: async () => [],
    },
  };
}
