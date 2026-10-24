// Run on the Owner's machine. Prints a fresh evidence gateway key once: the value for the
// Lovable Cloud secret RECORD_RENTAL_EVIDENCE_GATEWAY_KEY and the psql line for
// proposed/record-rental-gateway/02-set-gateway-key.sql. Nothing is written to disk.
import { randomBytes } from "node:crypto";
const hex = randomBytes(32).toString("hex");
console.log(`RECORD_RENTAL_EVIDENCE_GATEWAY_KEY=${hex}`);
console.log(`psql "$DATABASE_URL" -v gateway_key_hex=${hex} -f proposed/record-rental-gateway/02-set-gateway-key.sql`);
