// LOCAL TEST ONLY: send a file's exact bytes as one simple-query message (as query_database does). 127.0.0.1 only.
import { readFileSync } from "node:fs";
import postgres from "postgres";
const [url, file] = process.argv.slice(2);
if (!/^postgresql:\/\/postgres@127\.0\.0\.1:\d+\//.test(url)) throw new Error("refusing non-local target");
const sql = postgres(url, { max: 1, onnotice: () => {} });
try { await sql.unsafe(readFileSync(file, "utf8")).simple(); console.log("OK"); }
catch (e) { console.log("ERROR: " + e.message); }
finally { await sql.end(); }
