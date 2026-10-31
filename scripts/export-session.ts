// Explicitly authorised, owner-private export of a TrueForge session.
// There is no stdout export and no caller-chosen output destination.
import { join } from "node:path";
import { client, die, exportSession, writeJson, PRIVATE_ROOT } from "./lib.ts";

const [sessionId, ...extra] = process.argv.slice(2);
if(process.env.GK_EXPORT_AUTHORIZED!=="1") die("EXPORT_HELD: explicit owner approval required");
if(extra.length || !sessionId || !/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId))
  die("Usage: npm run export-session -- <valid_session_id>");
const exp=await exportSession(client(),sessionId);
writeJson(join(PRIVATE_ROOT,"exports",sessionId+".json"),exp);
console.log("Private TrueForge session export recorded; no session content printed.");
