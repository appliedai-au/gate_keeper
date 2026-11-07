// Gate Keeper's bag of rules, heuristics and fingerprints. One model call per review, like every other agent.
// Before the call: pick the rule packs that fit this code (its language and the patterns found in it) and point the
// model at lines that match known bug patterns. After the call: drop findings on lines that cannot hold a defect,
// re-anchor by quote, merge same/next-line duplicates, and apply learned bug / false-alarm fingerprints.
// Everything here is Gate Keeper's own agent code; the harness scores its output with the same score() as everyone.
import { createHash } from "node:crypto";

const LANG = { python: "python", py: "python", javascript: "js", js: "js", typescript: "js", ts: "js", tsx: "js", go: "go",
  java: "jvm", kotlin: "jvm", kt: "jvm", c: "c", cpp: "c", "c++": "c", h: "c", rust: "rust", rs: "rust", csharp: "cs", cs: "cs", "c#": "cs", php: "php", ruby: "ruby", rb: "ruby" };

// Heuristic detectors: [id, topic, regex, hint]. A match is a pointer, never a finding.
const DETECT = [
  ["money-float", "money", /\b(float|double|Float|Double|parseFloat|toFixed)\b.*\b(price|amount|total|fee|balance|cost|cents?|rate)\b|\b(price|amount|total|fee|balance|cost)\w*\s*[:=]\s*-?\d+\.\d+/i, "money held or computed in floating point"],
  ["rounding", "money", /\.divide\(|\bquantize\(|Math\.(round|floor|ceil)\(|\bround\(|\/\/|\bROUND_/, "division or rounding: check scale, mode and floor vs cap"],
  ["min-max", "money", /\b(min|max)\s*\(|Math\.(min|max)\(/, "min/max: check it is the right one for a floor or a cap"],
  ["sql-build", "inject", /\b(SELECT|INSERT|UPDATE|DELETE|WHERE|ORDER BY)\b[^\n]*(\+\s*\w|\$\{|\{\w+\}|%s'|'\s*\+|\.format\(|f"|f')/i, "SQL text built from values"],
  ["shell", "inject", /\b(exec|execSync|system|popen|subprocess\.\w+|Runtime\.getRuntime|shell_exec|passthru|child_process|os\.system)\s*\(/, "process or shell call"],
  ["path", "inject", /\b(path\.join|path\.resolve|filepath\.Join|os\.path\.join|Paths\.get|File\(|sendFile|readFile|fopen|file_get_contents|open\()\s*/, "file path built from input"],
  ["regex", "inject", /new RegExp|re\.(compile|match|search)|Regex\(|preg_match|\)\+[@$]|\(\[[^\]]+\]\+\)\+/, "regex on input: check catastrophic backtracking and anchoring"],
  ["redirect", "inject", /\bredirect\s*\(|res\.redirect|Location:|returnTo|next=|return_url/i, "redirect target from input"],
  ["log-input", "inject", /\b(printf|fprintf|log\w*|console\.\w+|logger\.\w+)\s*\([^"'`]*\b(req|request|user|path|query|body|input)\b/, "input reaching a format string or log"],
  ["deser", "inject", /pickle\.loads|yaml\.load\(|unserialize\(|ObjectInputStream|deepMerge|merge\(\s*\w+\s*,\s*JSON\.parse|__proto__/, "deserialising or deep-merging untrusted data"],
  ["weak-rand", "secret", /Math\.random|random\.(random|randint|choice)|\brand\(\)|new Random\(|mt_rand|uniqid/, "non-cryptographic random"],
  ["secret-compare", "secret", /\b\w*(token|secret|signature|sig|hmac|password|hash|digest|mac|otp|code)\w*\s*(===|!==|==|!=)|(===|!==|==|!=)\s*\w*(token|secret|signature|hmac|digest|expected)\b/i, "secret compared with ==, not constant time"],
  ["auth-scope", "access", /\b(find|get|select|query|delete|update)\w*\s*\(.*\b(id|Id|ID)\b(?!.*\b(user|owner|tenant|account|org)\w*)/, "lookup by id: check it is scoped to the caller"],
  ["cookie", "secret", /cookie\s*\(|Set-Cookie|httpOnly|secure\s*:/i, "cookie flags and what it stores"],
  ["jwt", "secret", /jwt|jwtVerify|verify\(|decode\(|alg|issuer|audience/i, "token verification: algorithm, issuer, audience, expiry"],
  ["swallow", "errors", /except\s*:|except\s+Exception|catch\s*\([^)]*\)\s*\{\s*\}|catch\s*\{\s*\}|\.catch\(\s*\(\)\s*=>\s*\{?\s*\}?\)|\b_\s*=\s*\w[\w.]*\(|,\s*_\s*:?=|\bpass\s*$|@\w+\(|rescue\s*=>?\s*nil/, "error swallowed or discarded"],
  ["status", "errors", /\.json\(\)|\.Body\b|fetch\(|requests\.(get|post|put)|http\.(Get|Post)|GetFromJsonAsync|urlopen|curl_exec/, "HTTP result used: check status, timeout and body close"],
  ["async", "errors", /async void|\.Result\b|\.Wait\(\)|\.then\([^)]*\)\s*$|asyncio\.(create_task|ensure_future)|go func/, "async work: check it is awaited and errors surface"],
  ["race", "state", /\b(setnx|exists|computeIfAbsent|getOrDefault|putIfAbsent|findOne|fetchone|SELECT)\b|if\s+not\s+\w+\s+in\b|\bcount\s*\+=|\+\+|-=/, "read then write: check for a race under concurrent callers"],
  ["lock", "state", /Lock\(|mutex|synchronized|\.Lock\(\)|sync\.Mutex|RLock|threading|transaction\(|BEGIN|FOR UPDATE/i, "locking or transaction scope"],
  ["shared-default", "state", /def \w+\([^)]*=\s*(\[\]|\{\}|set\(\)|datetime\.\w*now\(\))|static\s+(final\s+)?(Map|List|HashMap|Dictionary)|new HashMap|= \{\}\s*;?\s*$/, "shared or default mutable state"],
  ["cache-key", "state", /cache|memo|_rates|priceCache|lru/i, "cache: check the key has every dimension and entries expire"],
  ["time", "boundary", /utcnow|datetime\.now\(\)|new Date\(|Date\.now\(\)|time\.Now\(\)|AT TIME ZONE|DateTime\.(Utc)?Now|timedelta|TimeUnit|\bttl\b|_ms\b|seconds/i, "time: units, time zone, clock"],
  ["bounds", "boundary", /\[\s*\w+\s*[-+]\s*1\s*\]|<=\s*\w*(len|length|size|count)|\b(len|length|size)\s*\(?\w*\)?\s*-\s*1|\.slice\(|\[\s*\d*\s*:\s*\w*\s*\]|substr|LIMIT|OFFSET|page/i, "index, slice or page bounds"],
  ["c-mem", "memory", /\b(strcpy|strncpy|strcat|sprintf|gets|memcpy|memmove|malloc|realloc|alloca|atoi|atol)\s*\(/, "C memory or string call: check sizes and terminators"],
  ["unsafe", "memory", /\bunsafe\b|from_utf8_unchecked|as\s+usize|\.unwrap\(\)|vec!\[0u8;\s*\w+\]/, "unchecked conversion or allocation from input"],
  ["resource", "errors", /\b(open|OpenFile|os\.Create|fopen|new File\w*Stream|getConnection|cursor\(\)|NewReader|Body)\b/, "resource: closed on every path?"],
];

const PACKS = {
  python: ["Python: a default argument like `now=datetime.utcnow()` is evaluated once at import.", "Python: `except Exception: pass` or a bare `except` that hides a failure is a defect.", "Python: f-strings or `%` building SQL with request values is injection; parameters must be bound."],
  js: ["JS/TS: `==`/`!==` on secrets is not constant time; use `crypto.timingSafeEqual`.", "JS/TS: an un-awaited promise or `.catch(() => {})` loses errors.", "JS/TS: merging parsed JSON into objects can pollute `__proto__`; string `startsWith` on a resolved path is not a containment check unless the base ends with a separator."],
  go: ["Go: an error assigned to `_` or not checked is a defect.", "Go: `defer` inside a loop and unclosed `resp.Body` leak.", "Go: `filepath.Join(dest, name)` with archive names allows `../` escape unless the result is checked against `dest`."],
  jvm: ["Java/Kotlin: `BigDecimal.divide` without a scale and rounding mode throws on non-terminating results; `equals` compares scale (2.0 vs 2.00).", "Java/Kotlin: check-then-act on shared maps or rows needs a lock, `putIfAbsent`, or a unique constraint.", "Java/Kotlin: a loop that deletes from the collection it iterates throws or skips."],
  c: ["C: `strncpy` does not terminate when the source is long; `memcpy` with a length from input needs a bound check against the destination.", "C: an off-by-one on a fixed array (`>` vs `>=` MAX) overflows.", "C: a user string passed as the format to `printf`/`fprintf` is a format-string bug; `atoi`/`atol` give no error on bad input."],
  rust: ["Rust: `vec![0; len]` with `len` from input needs a cap.", "Rust: `from_utf8_unchecked` on untrusted bytes is undefined behaviour.", "Rust: slicing `p[0]`, `p[1]` needs a length check first."],
  cs: ["C#: `async void` loses exceptions; `.Result`/`.Wait()` can deadlock.", "C#: a new `HttpClient` per call exhausts sockets.", "C#: a shared field replaced while readers use it needs a lock or immutable swap."],
  php: ["PHP: `==` on hashes or tokens is loose and not constant time; use `hash_equals`.", "PHP: paths from input need `realpath` and a prefix check.", "PHP: signed URLs must check expiry and compare the whole signature."],
  ruby: ["Ruby: string-built SQL is injection; `rescue nil` hides failures."],
  money: ["Money: a fee with a minimum needs `max(fee, MIN)`, a cap needs `min`; amounts must use decimal types and one rounding rule."],
  inject: ["Untrusted input reaching SQL, shell, paths, regexes, redirects or format strings is a finding on the line where it reaches the sink."],
  secret: ["Secrets and tokens: generated with a secure random source, compared in constant time, checked for expiry and single use, never logged or put in URLs."],
  access: ["Every read or write by id must be scoped to the caller's owner or tenant."],
  errors: ["A failure path that returns success, swallows the error, or skips cleanup is a finding."],
  state: ["Read-then-write on shared state without a transaction, lock or unique constraint is a race when the context says there are retries or many workers."],
  boundary: ["Check units (ms vs s), time zones, inclusive vs exclusive bounds and the first/last page."],
  memory: ["Every copy into a fixed buffer needs a size check against the destination, not the source."],
};

// Report bar adapted from the OpenAI Codex review guidelines (Apache-2.0).
const STRICT = `\n\n## Report bar (adapted from OpenAI Codex review guidelines, Apache-2.0)
- Report a finding only if the author would definitely fix it once shown. When unsure, leave it out.
- A hint, a risky-looking API or a missing best practice is not a finding by itself: name the input and the wrong result it causes in this code.
- Never report the same root cause twice or on a neighbouring line.`;

const norm = (s) => s.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "S").replace(/\b\d+(\.\d+)?\b/g, "N").replace(/\s+/g, " ").trim().toLowerCase();
export const fingerprint = (line) => createHash("sha1").update(norm(line)).digest("hex").slice(0, 16);

export function codeLines(prompt) { const m = new Map(); for (const x of prompt.matchAll(/^\s*(\d+) \| ?(.*)$/gm)) m.set(+x[1], x[2]); return m; }
export function language(prompt) { const f = prompt.match(/```([\w+#-]+)/); return LANG[(f?.[1] || "").toLowerCase()] || null; }

export function hints(prompt) {
  const code = codeLines(prompt), out = [], topics = new Set();
  for (const [n, text] of code) for (const [id, topic, re, hint] of DETECT) if (re.test(text)) { out.push({ line: n, id, hint }); topics.add(topic); }
  return { hints: out, topics };
}

export function prepare(baseSystem, prompt, { strict = false, maxHints = 14 } = {}) {
  const lang = language(prompt), { hints: hs, topics } = hints(prompt);
  const packs = [...(lang && PACKS[lang] ? PACKS[lang] : []), ...[...topics].flatMap((t) => PACKS[t] || [])];
  const rules = [...new Set(packs)].slice(0, 9);
  const sys = baseSystem.replace(/\n\nExtra field:/, (rules.length ? "\n\n## Rules for this code\n" + rules.map((r) => "- " + r).join("\n") : "") + (strict ? STRICT : "") + "\n\nExtra field:");
  const byLine = new Map(); for (const h of hs) if (!byLine.has(h.line)) byLine.set(h.line, h.hint);
  const list = [...byLine].slice(0, maxHints).map(([l, h]) => `L${l}: ${h}`);
  const user = prompt + (list.length ? "\n\nLines a pattern scan points at (a pointer, not a finding; many are fine): " + list.join("; ") + "." : "");
  return { system: sys, prompt: user, lang, rules: rules.length, hints: list.length };
}

const EMPTY = /^\s*(\/\/.*|#(?:\s.*|!.*)?|\/\*.*|\*(?:\s.*|\/.*)?|--\s.*|[{}()[\];,]*|import\b.*|from\s+\S+\s+import\b.*|package\b.*|using\s+[\w.]+;|use\s+[\w:]+;|#include.*|<\?php)?\s*$/;
export function post(prompt, findings, fp = null) {
  if (!findings) return { out: null, dropped: 0, moved: 0, fpAdded: 0, fpCut: 0 };
  const code = codeLines(prompt), N = (s) => s.replace(/\s+/g, " ").trim();
  let dropped = 0, moved = 0, fpAdded = 0, fpCut = 0;
  let fs = findings.map((f) => { const q = N(f.quote || ""); if (q.length < 4) return f; const here = N(code.get(f.start) || "");
    if (here.includes(q) || (here.length >= 4 && q.includes(here))) return f;
    let best = null; for (const [n, c0] of code) { const c = N(c0); if (c.length >= 4 && (c.includes(q) || q.includes(c)) && (best === null || Math.abs(n - f.start) < Math.abs(best - f.start))) best = n; }
    if (best !== null && Math.abs(best - f.start) <= 8) { moved++; return { ...f, start: best, end: best }; } return f; });
  fs = fs.filter((f) => { const t = code.get(f.start); if (t !== undefined && EMPTY.test(t)) { dropped++; return false; } return true; });
  if (fp) {
    fs = fs.filter((f) => { const h = fingerprint(code.get(f.start) || ""); if (fp.fa?.includes(h) && !fp.bug?.includes(h)) { fpCut++; return false; } return true; });
    for (const [n, t] of code) { if (norm(t).length < 12) continue; const h = fingerprint(t); if (fp.bug?.includes(h) && !fs.some((f) => Math.abs(f.start - n) <= 1)) { fs.push({ start: n, end: n, comment: "matches a known bug fingerprint" }); fpAdded++; } }
  }
  const out = []; for (const f of [...fs].sort((a, b) => a.start - b.start)) { if (out.length && f.start - out[out.length - 1].start <= 1) continue; out.push(f); }
  return { out, dropped, moved, fpAdded, fpCut };
}

// Trigger-gated learned rules. Each rule has a code trigger (a line regex); the rule and the matching lines are shown to
// the reviewer only on code where the trigger fires, so a rule cannot add false alarms on code it does not apply to.
// Rule text follows: when <pattern>, check <X>; flag only if you can quote <evidence>; not when <exception>.
export const GATED = [
  { id: "ci-ident", source: "round D rule 1, gated by hand",
    trigger: /\b(header|headers|email|e_mail|mail|domain|host|hostname|origin|scheme)\w*\b[^\n]*(===?|!==?|\.equals\(|\.get\(|\[\s*["'`]|\bin\b|startsWith|endsWith|contains\(|includes\()/i,
    rule: "When code compares or looks up a protocol identifier (HTTP header name, email address, domain or host name), check the comparison is case-insensitive or normalised; flag only if you can quote the comparison line and no earlier line lowercases or normalises the value; not when comparing values the code itself already normalised or constants against constants." },
  { id: "sec-transition", source: "round D rule 2, gated by hand",
    trigger: /\b(set_?password|change_?password|reset_?password|update_?password|password\w*\s*=|passwd\w*\s*=|role\w*\s*=|is_?admin\s*=|permissions?\s*=|login\(|log_?in\(|sign_?in\(|authenticate\(|session\[|session\.\w+\s*=|regenerate|invalidate)/i,
    rule: "When code changes a security state (login, password change or reset, role or permission change), check existing sessions or tokens are invalidated or regenerated and any secret comparison on that path is constant time; flag only if you can quote the line that saves the change and the function has no invalidation or regeneration; not when the context says sessions are stateless or the path is a trusted admin tool." },
];

export function gate(prompt, rules = GATED) {
  const code = codeLines(prompt), on = [];
  for (const r of rules) { const lines = [...code].filter(([, t]) => r.trigger.test(t)).map(([n]) => n); if (lines.length) on.push({ ...r, lines: lines.slice(0, 6) }); }
  return on;
}

// Stack of a review prompt, from its code fence, file name and imports. Deterministic; used to pick a per-language
// rule pack (learned separately for each stack and model) and to show it only on code of that stack.
export function stackOf(prompt) {
  const fence = (prompt.match(/```([\w+#-]+)/)?.[1] || "").toLowerCase(), file = prompt.match(/File: `([^`]+)`/)?.[1] || "";
  if (fence === "erlang" || /\.[eh]rl$/.test(file)) return "erlang";
  if (fence === "php" || /\.php$/.test(file)) return "php";
  if (fence === "go" || /\.go$/.test(file)) return "go";
  if (fence === "rust" || /\.rs$/.test(file)) return "rust";
  const js = /^(javascript|js|typescript|ts|tsx|jsx)$/.test(fence);
  if (js && /from\s+["']elysia["']/.test(prompt)) return "elysia";
  if (js && (/\bBun\.\w+|from\s+["']bun(:\w+)?["']/.test(prompt))) return "bun";
  if (js && (/\.(tsx|jsx)$/.test(file) || /from\s+["']react["']/.test(prompt))) return "react";
  if (js && (/require\(["']|from\s+["'](express|express-session|node:\w+|fs|http|https|child_process|crypto)["']/.test(prompt) || /^(javascript|js)$/.test(fence))) return "node";
  if (js) return "ts";
  return LANG[fence] || fence || "other";
}
