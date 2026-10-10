/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   THE ONLY VEHICLE PHOTO A STRANGER CAN FETCH IS ONE A PERSON PUT ON THE
 *   WEBSITE.
 *
 * The vehicle-photos bucket is private, so every public listing image is
 * served by one route, with the service-role key behind it. That route is the
 * entire boundary: if it serves a path it should not, an unpublished original
 * or an unapproved retouch is on the open internet, and no RLS policy is left
 * to catch it because the service role bypasses them all.
 *
 * So this calls the REAL route handler against a fake storage layer and asks
 * for things it must refuse. It also checks that nothing anywhere hands out a
 * signed URL for that bucket, which would route around this file completely.
 *
 * Run: node scripts/vehicle-photo-public-route.test.mjs   (wired into npm test)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const V = "0a1b2c3d-0000-4000-8000-00000000000b";
const OUT = ".proute-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });

// createFileRoute just hands back what it was given; we call the handler.
writeFileSync(`${OUT}/stub/router.js`, `export const createFileRoute = () => (cfg) => cfg;`);
writeFileSync(`${OUT}/stub/client.server.js`, `
const S = (globalThis.__pr ??= {});
S.rows ??= []; S.files ??= {}; S.downloads ??= [];
const match = (q, r) => q.every(([c, v]) => r[c] === v);
function from() {
  const q = [];
  const api = {
    select: () => api, eq: (c, v) => (q.push([c, v]), api), limit: () => api,
    maybeSingle: () => Promise.resolve({ data: S.rows.find((r) => match(q, r)) ?? null, error: null }),
  };
  return api;
}
export const supabaseAdmin = {
  from,
  storage: { from: () => ({
    download: (p) => { S.downloads.push(p); return Promise.resolve(S.files[p] === undefined
      ? { data: null, error: { message: "not found" } }
      : { data: { arrayBuffer: async () => S.files[p].buffer.slice(S.files[p].byteOffset, S.files[p].byteOffset + S.files[p].byteLength) }, error: null }); },
  }) },
};
`);

execFileSync("npx", ["esbuild", "src/routes/api/public/vehicle-photos/$.ts",
  "--bundle", "--platform=node", "--format=esm", "--alias:@=./src",
  `--alias:@tanstack/react-router=./${OUT}/stub/router.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/client.server.js`,
  `--outfile=${OUT}/route.mjs`, "--log-level=warning"], { stdio: "inherit" });

const { Route } = await import(`../${OUT}/route.mjs`);
const GET = Route.server.handlers.GET;
const S = (globalThis.__pr ??= {});
S.rows ??= []; S.files ??= {}; S.downloads ??= [];

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const get = (path) => GET({ params: { _splat: path } });
const reset = () => { S.rows.length = 0; S.downloads.length = 0; for (const k of Object.keys(S.files)) delete S.files[k]; };
const media = (over) => ({ id: "m1", storage_bucket: "vehicle-photos", mime_type: "image/jpeg", published: false, ...over });

console.log("A PUBLISHED LISTING PHOTO IS SERVED");
{
  reset();
  const p = `${V}/published.jpg`;
  S.files[p] = JPEG;
  S.rows.push(media({ storage_path: p, published: true }));
  const res = await get(p);
  ok(res.status === 200, `it is served (${res.status})`);
  ok(res.headers.get("Content-Type") === "image/jpeg", "  as an image");
  ok(res.headers.get("X-Content-Type-Options") === "nosniff", "  with nosniff");
  ok((await res.arrayBuffer()).byteLength === JPEG.byteLength, "  and the bytes are the file");
}

console.log("\nEVERYTHING ELSE IS A 404 — THE SAME ANSWER AS A PATH THAT IS NOT THERE");
for (const [label, row, path] of [
  ["an UNPUBLISHED original", media({ storage_path: `${V}/private.jpg`, published: false }), `${V}/private.jpg`],
  ["an unapproved RETOUCH", media({ storage_path: `${V}/enhanced-x.jpg`, published: false, kind: "ai_enhanced", review_status: "pending" }), `${V}/enhanced-x.jpg`],
  ["an APPROVED but unpublished retouch", media({ storage_path: `${V}/enhanced-y.jpg`, published: false, kind: "ai_enhanced", review_status: "approved" }), `${V}/enhanced-y.jpg`],
]) {
  reset();
  S.files[path] = JPEG;              // the file really is in the bucket
  S.rows.push(row);                  // and a row really does describe it
  const res = await get(path);
  ok(res.status === 404, `${label} is refused (${res.status})`);
  ok(!S.downloads.includes(path), `  and is never even read from storage`);
}
{
  reset();
  const p = `${V}/orphan.jpg`;
  S.files[p] = JPEG;                 // in the bucket, but no row at all
  ok((await get(p)).status === 404, "a file with no media row is refused");
}
{
  reset();
  const p = `${V}/other-bucket.jpg`;
  S.files[p] = JPEG;
  S.rows.push(media({ storage_path: p, published: true, storage_bucket: "vehicle-docs" }));
  ok((await get(p)).status === 404, "a published row in ANOTHER bucket does not unlock this one");
}

console.log("\nPATH TRICKS ARE REFUSED BEFORE ANYTHING IS LOOKED UP");
for (const bad of [
  "../../../etc/passwd",
  `${V}/../${V}/private.jpg`,
  "",
  `${V}/registration.pdf`,
  `${V}/script.svg`,
  `${V}/payload.html`,
  `${V}/${"a".repeat(420)}.jpg`,
]) {
  reset();
  const res = await get(bad);
  ok(res.status === 404, `refused: ${bad.slice(0, 44) || "(empty)"}`);
  ok(S.downloads.length === 0, "  nothing was read from storage");
}

console.log("\nNOBODY HANDS OUT A SIGNED URL FOR THE PRIVATE PHOTO BUCKET");
{
  // A signed URL would bypass this route entirely, and the bucket with it.
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) { if (e !== "node_modules") walk(f); }
      else if (/\.(ts|tsx)$/.test(e)) files.push(f);
    }
  })("src");
  // Match the bucket as a whole token on the call itself. A substring match
  // flagged FleetOwnersPanel.tsx, which signs "owner-vehicle-photos" — a
  // different, admin-only bucket that is not this boundary.
  const SIGNS_PHOTO_BUCKET = /\.from\(\s*["'`]vehicle-photos["'`]\s*\)\s*\.\s*createSignedUrls?\s*\(/;
  const offenders = files.filter((f) => SIGNS_PHOTO_BUCKET.test(readFileSync(f, "utf8")));
  ok(offenders.length === 0, `no source file signs a vehicle-photos URL (${offenders.join(", ") || "none"})`);
  // And the check still has teeth: it must fire on the shape it is looking for.
  ok(SIGNS_PHOTO_BUCKET.test(`supabase.storage.from("vehicle-photos").createSignedUrl(p, 60)`),
     "  (the check itself detects that shape)");
  ok(!SIGNS_PHOTO_BUCKET.test(`supabase.storage.from("owner-vehicle-photos").createSignedUrl(p, 60)`),
     "  (and does not confuse it with owner-vehicle-photos)");
  const helper = readFileSync("src/lib/photoUrl.ts", "utf8");
  ok(/\/api\/public\/vehicle-photos\//.test(helper), "the public helper points at this route");
  ok(/download\(/.test(helper), "and the staff helper downloads bytes rather than linking");
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
