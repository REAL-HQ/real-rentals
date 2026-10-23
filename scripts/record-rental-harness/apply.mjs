// Applies the production-order rehearsal manifest to the local harness database:
// the baseline (ords 1-143), then preflight, the 29 packet steps with the hosted
// amendments, and every per-step verify. Run with cwd = the extracted packet ref.
// Refuses any non-local database.
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { stripTxn, outboundBlock } from "./scripts/m2-rehearsal-manifest.mjs";

const url = process.env.RR_HARNESS_DB_URL;
if (!url || !/@127\.0\.0\.1:/.test(url)) throw new Error("refusing: RR_HARNESS_DB_URL must be a 127.0.0.1 database");
const last = Number(process.argv[2] ?? 206);
const manifest = JSON.parse(readFileSync("proposed/rehearsal/manifest.json", "utf8"));
const sql = postgres(url, { max: 1, onnotice: () => {} });
const sanitize = (t) => t.replace(/^\s*create extension[^;]*(pg_net|pg_cron|pg_graphql|supabase_vault|pgsodium)[^;]*;/gim, "");
let applied = 0, verified = 0;
try {
  for (const e of manifest) {
    if (e.ord > last || e.kind === "rollback" || e.ord === 205) continue;
    let body = readFileSync(e.path, "utf8");
    if (e.transform === "outbound_block") body = outboundBlock(body, e.path);
    if (e.transform === "strip_txn") body = stripTxn(body, e.path);
    body = sanitize(body);
    try {
      if (e.kind === "verify") {
        const [row] = await sql.unsafe(body.replace(/;\s*$/, ""));
        if (Object.values(row)[0] !== true) throw new Error(`verify returned ${Object.values(row)[0]}`);
        verified++;
      } else if (e.kind === "query" && e.path.endsWith("m2-preflight.sql")) {
        const rows = await sql.unsafe(`SELECT check_name, actual FROM (${body.replace(/;\s*$/, "")}) q WHERE ok IS NOT TRUE`);
        if (rows.length) throw new Error(`preflight: ${rows.map((r) => `${r.check_name}=${r.actual}`).join("; ")}`);
      } else if (e.kind !== "query") {
        await sql.begin((tx) => tx.unsafe(body));
        applied++;
      }
    } catch (err) {
      throw new Error(`ord ${e.ord} ${e.path}: ${err.message}`);
    }
  }
  const [{ jobs }] = await sql`select count(*)::int jobs from cron.job`;
  const [{ queued }] = await sql`select count(*)::int queued from net.http_request_queue`;
  if (jobs || queued) throw new Error(`outbound effects committed: cron.job=${jobs} http=${queued}`);
  console.log(`applied ${applied} files, ${verified} verifies true, through ord ${last}`);
} finally {
  await sql.end();
}
