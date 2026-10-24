// The evidence gateway's key, its signing domain and the issuer transport must never
// reach a browser bundle. Reads the build output (run `npm run build` first).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
const ASSETS = ".output/public/assets";
if (!existsSync(ASSETS)) { console.log("SKIP no build output; run `npm run build` first"); process.exit(0); }
const forbidden = ["RECORD_RENTAL_EVIDENCE_GATEWAY_KEY", "RECORD_RENTAL_ISSUER_DATABASE_URL", "record-evidence-gateway-v1",
  "gatewayKey", "rr_evidence_transport", "record_evidence_gateway_v1", "record_license_gateway_v1", "SET LOCAL ROLE"];
const files = readdirSync(ASSETS).filter((f) => f.endsWith(".js"));
assert.ok(files.length > 0, "no client chunks found");
for (const f of files) {
  const text = readFileSync(`${ASSETS}/${f}`, "utf8");
  for (const needle of forbidden) assert.ok(!text.includes(needle), `${needle} appears in client chunk ${f}`);
}
console.log(`PASS ${files.length} client chunks contain none of: ${forbidden.join(", ")}`);
