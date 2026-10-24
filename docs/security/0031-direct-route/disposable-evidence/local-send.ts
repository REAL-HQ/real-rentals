import postgres from "/home/user/real-rentals/node_modules/postgres/src/index.js";
import { readFileSync } from "node:fs";
const db = postgres("postgresql://postgres@127.0.0.1:55462/rr?sslmode=disable", { max: 1, onnotice: () => {} });
for (const r of process.argv.slice(2)) {
  await db.unsafe("DROP TABLE IF EXISTS public.rr_guard_t");
  let out = "ok";
  try { await db.unsafe(readFileSync(`req${r}.sql`, "utf8")); } catch (e: any) { out = e.message; }
  const [{ t }] = await db`select to_regclass('public.rr_guard_t') is not null t`;
  console.log(`== ${r}: ${out} | table=${t}`);
}
await db.unsafe("DROP TABLE IF EXISTS public.rr_guard_t"); await db.end();
