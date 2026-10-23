// Production-order baseline for the M2 rehearsal.
//
// Source of truth is production's own ledgers (read-only, 2026-10-23), not the
// repo directory: 105 Supabase receipts and 23 Drizzle receipts, each mapped to
// the bytes that ran. Repo migrations with no receipt (seq 60-65, 77-88) never
// ran in production and are excluded.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

// version:hash16 of array_to_string(statements,'') — from production.
const SUPABASE = `20260611133219:457eb9fedca4e207 20260611133238:3d5895d08b2dcbbe 20260611133303:b57520801e0c34c3 20260611143823:b4280ba766c73337 20260611164516:2ed9127edc0ea1d3 20260611233333:34b804d4ab54bcbe 20260613214528:d4c9bae2e05450b3 20260613214556:a417565838809a8b 20260613215546:bcde571e01779297 20260613215603:9fb28f251e3f3e57 20260614110610:38d196b1fbb04b34 20260614225401:eea94fa89254c8cb 20260615002158:734b68b7b2df321b 20260615002323:02ebd5d94f3c6759 20260615003004:071fbf8f9b4c11d1 20260617212930:f28ecd018328fabf 20260617224145:0aa80aee88049ba7 20260618000852:5ca93360896f08a7 20260618002018:23560577d35162f9 20260618003112:901931c1c75f0d31 20260618003302:188826801c7b8a4d 20260618003421:ff30f920fa291767 20260618003533:b05d60fd8d3ba7a0 20260618005441:1a439889ccac001a 20260620045006:2b8dbc1cf1b80604 20260621011523:8c07b9516404807c 20260621024849:f4fe9c9989c465c3 20260621025138:3a4680cad748d08c 20260622160002:689e2c32bb04904a 20260622221326:55a41213e3290a7c 20260628200526:0940fac19ec2df63 20260629044107:66017f7673301aba 20260629044126:56cf8d1b145e2228 20260629052830:06084ff764f45104 20260713030451:02563d156f51807e 20260713042531:4b1f28a04cf4642f 20260713042640:50811ad14a008869 20260721191236:a40346e943afdf5e 20260721192417:6bd462d2dddad505 20260721192713:2e88848ca18ac35f 20260722203536:54c64b29c0c19e31 20260722204255:b4b2d01b75393d5a 20260722204455:3e4a9d741b57ecbe 20260722204829:c03d8ec1df1c93bb 20260722205427:4b91d39a19246eda 20260722234432:3f5be1554d0d032d 20260722235627:4ca9b863bd07fcf0 20260722235658:786282c4cd7b0a8d 20260722235748:14dcb123a9978269 20260723011027:ddc0cf74c7737669 20260723044136:e0d769b3bc894923 20260723121700:3785c948339aa708 20260723135200:3d35cbd5a05af563 20260723182819:d007545a7b2ec177 20260723183257:56a764bab5f716a5 20260726131244:276c8a7b50ffe2ef 20260727033225:a4d7e275e8c3425e 20260804060953:49ffd555f3180403 20260815153000:d178eb3a9aad01e1 20260917021934:cff626695a2d6ad0 20260925130309:943396c150a62ce5 20260925130344:2d188ecbe453da4f 20260925130510:9910c9081fae6ab2 20260925130550:abc47cecef1fe484 20260925130612:54b103d9dc120bae 20260925130632:bb2b9bf0785b10ef 20260925132035:9bb83267b345102c 20260925160000:EMPTY 20260925161000:EMPTY 20260925170000:EMPTY 20260925171020:daf82c816b7d30b6 20260930222027:99ed00b5ea799660 20260930223843:9e5c7712c6322fa0 20261005021612:35c8f7ff8ba9c115 20261005060239:384d4cdaf3e43975 20261005072446:52832d0b19a1b330 20261005080129:02e8154cdc66b787 20261006012455:9a5c29e71dfc0209 20261006012758:6f64aff994119956 20261006013924:b383018240f08f91 20261006013942:494fc940c3e3dd60 20261006014106:b05a17cdfe6487bf 20261006014406:b1d02e335677b67a 20261006020456:6fa383b0f0e2cd14 20261006025756:2b7e3f24d7db0d31 20261006072823:ff32dfc55e3a3b43 20261006083427:6786409d477e6327 20261006083446:b76033e378340acb 20261006083501:abe3b4073d7b4598 20261006083905:816c47c1febd1c58 20261006084912:e0f59bd4e43d5e1e 20261006085332:0223d931b717f11d 20261006092634:a99e44cfe30db9da 20261006094717:016572d6eeb2e775 20261006104154:21d2d57a28c359a5 20261006110204:3fbe3f84d3b87614 20261006110227:fbe315e99eca5d3d 20261006110937:411e566dd73d498f 20261006112250:a0464d64790d697b 20261006112513:edb1bec6918aaf4f 20261007034524:9285a2ea57be057d 20261007053328:d229f2fe621c8d7c 20261007054953:3f18bf691a0b2f75 20261007120336:7fff590824db29fd 20261011180000:012461899a60cc2a`;
// id:hash16:utc timestamp — from production drizzle.__drizzle_migrations.
const DRIZZLE = `1:60e27532f009295e:20261008005615 2:738ba1b78a229c55:20261008005754 3:cd11f5db078aaf63:20261008033926 4:611235fa2841a9b9:20261008034759 5:63623386f23a6c36:20261008040950 6:63695e00db5f1636:20261008041352 7:33c85b39c5410bc7:20261008112103 8:9442071c9712fa25:20261008114551 9:dcbabda64efa476c:20261008122413 10:ee0ee9066eb3e0e9:20261008122546 11:18fb3113f234e0bb:20261008124536 12:6a558eda9c92b87d:20261008124558 13:873e4c4d4e4df1c0:20261008125339 14:c5807075884bdd3f:20261008145417 15:0165723216a1346a:20261008152821 16:2f12f169a12fc3ac:20261008153710 17:a3f9b526698a5f68:20261008163219 18:71b806abd5211fbe:20261008171203 19:cb6f88b17b356c9c:20261008172732 20:6ab09e206256d0b3:20261008173542 21:2c60e0bbd894ae6f:20261008173715 22:a8f14f62b9c84e02:20261008215352 23:9ee4a1ced75ee787:20261019112259`;

const h16 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);

export function baselineOrder() {
  const repo = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const byHash = new Map(repo.map((f) => [h16(`supabase/migrations/${f}`), f]));
  const rows = [];
  for (const tok of SUPABASE.split(/\s+/)) {
    const [version, h] = tok.split(":");
    let path, provenance;
    if (h === "EMPTY") {
      const f = repo.find((x) => x.startsWith(version + "_"));
      if (!f) throw new Error(`no repo file for out-of-band receipt ${version}`);
      path = `supabase/migrations/${f}`; provenance = "out_of_band_receipt_empty__repo_file_assumed";
    } else if (version === "20260628200526") {
      path = "proposed/rehearsal/receipts/20260628200526_receipt_only.sql"; provenance = "receipt_only__statement_fetched_from_production";
      if (h16(path) !== h) throw new Error("receipt-only file does not match production");
    } else if (version === "20261011180000") {
      path = "supabase/migrations/20261011180000_contact_status.sql"; provenance = "install_wrapper__body_hash_declared_by_receipt";
      if (h16(path) !== "400e1071856e7c4e") throw new Error("contact_status body does not match the receipt's declared hash");
    } else {
      const f = byHash.get(h);
      if (!f) throw new Error(`receipt ${version} has no byte-identical repo file`);
      path = `supabase/migrations/${f}`; provenance = "byte_identical_to_receipt";
    }
    rows.push({ ledger: "supabase", key: version, at: version, path, provenance });
  }
  // Repo files 77-88 (2026-09-26/27) carry no receipt, yet production holds the
  // objects only they create (vehicle_media, vehicle_finance,
  // application_resume_tokens, applicant_upload_grants), and receipt
  // 20261006083427 cannot be created without vehicle_media. Their neighbours
  // 73-75 have *empty* out-of-band receipts. So they are replayed at their own
  // timestamps as out-of-band, unreceipted, repo-file-assumed; the production
  // fingerprint decides whether the assumption holds.
  for (const f of repo) {
    const v = f.slice(0, 14);
    if (v >= "20260926090000" && v <= "20260927190000") {
      rows.push({ ledger: "supabase", key: v, at: v, path: `supabase/migrations/${f}`, provenance: "out_of_band_no_receipt__repo_file_assumed" });
    }
  }
  // Repo seq 61 has no receipt either, but production holds exactly the two
  // partial unique indexes it creates (rentals_one_active_per_*), and the packet
  // depends on them. No other file creates them.
  rows.push({ ledger: "supabase", key: "20260921180000", at: "20260921180000", path: "supabase/migrations/20260921180000_rental_activation_guards.sql", provenance: "out_of_band_no_receipt__repo_file_evidenced_by_catalog" });
  const dz = readdirSync("drizzle/migrations").filter((f) => f.endsWith(".sql")).sort();
  for (const tok of DRIZZLE.split(/\s+/)) {
    const [id, h, at] = tok.split(":");
    const path = `drizzle/migrations/${dz[Number(id) - 1]}`;
    if (h16(path) !== h) throw new Error(`drizzle receipt ${id} does not match ${path}`);
    rows.push({ ledger: "drizzle", key: id, at, path, provenance: "byte_identical_to_receipt" });
  }
  rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.ledger === "supabase" ? -1 : 1));
  // The drizzle-kit runner's own ledger table (no migration file creates it),
  // after its last receipt; then the catalog parity production holds beyond
  // every file. Both are read-only reproductions of production state.
  const ledger = "proposed/rehearsal/receipts/drizzle_runner_ledger.sql";
  const lt = readFileSync(ledger, "utf8");
  for (const [i, f] of dz.slice(0, 23).entries()) {
    const full = createHash("sha256").update(readFileSync(`drizzle/migrations/${f}`)).digest("hex");
    if (!lt.includes(`(${i + 1}, '${full}', `)) throw new Error(`runner ledger row ${i + 1} does not hash ${f}`);
  }
  const lastDz = rows.findLastIndex((r) => r.ledger === "drizzle");
  rows.splice(lastDz + 1, 0, { ledger: "runner", key: "__drizzle_migrations", at: rows[lastDz].at, path: ledger, provenance: "runner_ledger__rows_fetched_from_production" });
  rows.push({ ledger: "parity", key: "catalog", at: "end", path: "proposed/rehearsal/parity/production-catalog-parity.sql", provenance: "catalog_parity__definitions_fetched_from_production" });
  const used = new Set(rows.map((r) => r.path));
  const excluded = repo.filter((f) => !used.has(`supabase/migrations/${f}`));
  return { rows, excluded };
}

if (process.argv[1]?.endsWith("m2-rehearsal-order.mjs")) {
  const { rows, excluded } = baselineOrder();
  writeFileSync("proposed/rehearsal/baseline-order.json", JSON.stringify({ rows, excluded }, null, 1) + "\n");
  console.log(`baseline: ${rows.length} files (${rows.filter((r) => r.ledger === "supabase").length} supabase + ${rows.filter((r) => r.ledger === "drizzle").length} drizzle); excluded never-run repo files: ${excluded.length}`);
  const prov = {}; for (const r of rows) prov[r.provenance] = (prov[r.provenance] || 0) + 1; console.log(prov);
  const firstDz = rows.findIndex((r) => r.ledger === "drizzle"); console.log(`first drizzle at position ${firstDz + 1}, after ${rows[firstDz - 1].key}; last row ${rows.at(-1).ledger} ${rows.at(-1).key}`);
}
