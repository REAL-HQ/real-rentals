// Run on the Owner's own machine, never in CI or chat. Generates a random password
// for rr_evidence_transport and its SCRAM-SHA-256 verifier. Only the verifier goes
// into SQL; the password goes only into the Lovable Cloud secret
// RECORD_RENTAL_ISSUER_DATABASE_URL.
//   node scripts/record-rental-transport-scram.mjs <pooler-host> <project-ref>
import { randomBytes, pbkdf2Sync, createHmac, createHash } from "node:crypto";

export function scramVerifier(password, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

if (process.argv[1]?.endsWith("record-rental-transport-scram.mjs")) {
  const [host, ref] = process.argv.slice(2);
  if (!host || !ref) { console.error("usage: node scripts/record-rental-transport-scram.mjs <pooler-host> <project-ref>"); process.exit(2); }
  const password = randomBytes(32).toString("base64url");
  console.log("1. Run in the SQL editor (contains no password):\n");
  console.log(`ALTER ROLE rr_evidence_transport PASSWORD '${scramVerifier(password)}';\n`);
  console.log("2. Paste into the Lovable Cloud secret RECORD_RENTAL_ISSUER_DATABASE_URL, then clear this terminal:\n");
  console.log(`postgres://rr_evidence_transport.${ref}:${password}@${host}:6543/postgres?sslmode=require\n`);
}
