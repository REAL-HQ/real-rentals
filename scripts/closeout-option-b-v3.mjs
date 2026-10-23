// Option B after M2.
//
// Option B returns a driver to Approved when a rental ends successfully. Its
// approved proposal, proposed/end-rental-returns-approved-v2.sql on
// claude/ops-2026-10-23, patches public.end_rental_tx.
//
// HOSTED-INSTALL step 4 (proposed/m2-packet/02.sql) does
// CREATE OR REPLACE FUNCTION public.end_rental_tx and reduces it to a four-line
// wrapper around public.end_rental_safe_v1. The 'closed' write Option B
// replaces moves with it, to 02.sql line 143 inside end_rental_safe_v1.
//
// So after M2, v2 neither applies nor is safe to apply: replacing
// end_rental_tx again would destroy the wrapper and the safe-release contract.
// This derives the post-M2 proposal instead -- end_rental_safe_v1 exactly as
// step 4 installs it, with that one statement changed and nothing else.
//
//   node scripts/closeout-option-b-v3.mjs            # print
//   node scripts/closeout-option-b-v3.mjs --write
//   node scripts/closeout-option-b-v3.mjs --check
import { readFileSync } from "node:fs";

const SOURCE = "proposed/m2-packet/02.sql";
const OUTPUT = "proposed/closeout-option-b/end-rental-safe-returns-approved-v3.sql";

const INSTALLED = "    UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;";
const OPTION_B = "    UPDATE public.applications SET status = 'approved'\n      WHERE id = r.application_id AND status = 'active';";

/** end_rental_safe_v1 exactly as proposed/m2-packet/02.sql installs it. */
export function installedSafeRelease(packet) {
  const start = packet.indexOf("CREATE FUNCTION public.end_rental_safe_v1(");
  if (start < 0) throw new Error("02.sql no longer declares CREATE FUNCTION public.end_rental_safe_v1(");
  const endMarker = "END $function$;";
  const end = packet.indexOf(endMarker, start);
  if (end < 0) throw new Error("end_rental_safe_v1 body is not closed with END $function$;");
  const body = packet.slice(start, end + endMarker.length);
  // The attributes every per-step verify from step 4 onward asserts.
  if (!body.includes("SECURITY DEFINER")) throw new Error("the installed function is not SECURITY DEFINER");
  if (!body.includes("SET search_path=''")) throw new Error("the installed function does not set an empty search_path");
  return body;
}

export function derive(packet) {
  const installed = installedSafeRelease(packet);
  const hits = installed.split("\n").filter((l) => l === INSTALLED).length;
  if (hits !== 1) throw new Error(`expected exactly 1 closing write in end_rental_safe_v1, found ${hits}`);
  // CREATE OR REPLACE, because the function necessarily exists by the time this
  // runs. This is the defect the v2 rollback was corrected for.
  const replaced = installed
    .replace("CREATE FUNCTION public.end_rental_safe_v1(", "CREATE OR REPLACE FUNCTION public.end_rental_safe_v1(")
    .replace(INSTALLED, OPTION_B);
  return `${header()}BEGIN;\n${replaced}\nCOMMIT;\n`;
}

/** The undo: the same function with step 4's statement back. */
export function deriveRollback(packet) {
  const installed = installedSafeRelease(packet).replace(
    "CREATE FUNCTION public.end_rental_safe_v1(",
    "CREATE OR REPLACE FUNCTION public.end_rental_safe_v1(",
  );
  return `${rollbackHeader()}BEGIN;\n${installed}\nCOMMIT;\n`;
}

function header() {
  return [
    "-- Rental Closeout Option B, for a database that has HOSTED-INSTALL step 4.",
    "--",
    "-- Owner decision 2026-10-23: a rental that ends successfully returns the",
    "-- driver to Approved, not Active and not Closed.",
    "--",
    "-- Step 4 (proposed/m2-packet/02.sql) replaces public.end_rental_tx with a",
    "-- wrapper around public.end_rental_safe_v1 and carries the 'closed' write",
    "-- into that function. So the approved v2 proposal, which patches",
    "-- end_rental_tx, does not apply after step 4 -- and applying it anyway would",
    "-- destroy the wrapper and the safe-release contract. Use v2 BEFORE M2 and",
    "-- this file AFTER step 4. Never both.",
    "--",
    "-- One statement differs from what step 4 installs:",
    "--   installed: UPDATE public.applications SET status = 'closed'",
    "--                WHERE id = r.application_id;",
    "--   here:      UPDATE public.applications SET status = 'approved'",
    "--                WHERE id = r.application_id AND status = 'active';",
    "--",
    "-- AND status = 'active' is load-bearing. 'active' is what a running rental",
    "-- means, so that is the state a normal closeout unwinds. Without it,",
    "-- returning a car would silently clear a suspension or a declination made",
    "-- during the rental.",
    "--",
    "-- CREATE OR REPLACE, not CREATE: the function exists by the time this runs.",
    "-- SECURITY DEFINER and SET search_path='' are preserved because every",
    "-- per-step verify from step 4 onward asserts prosecdef and search_path for",
    "-- this signature. Run it as the function's owner so the ACL is preserved;",
    "-- no verify asserts this function's body.",
    "--",
    "-- The recorded-rental closeout needs no change: public.close_recorded_rental_v2",
    "-- (proposed/m2-packet/04.sql) never writes applications.status, so a recorded",
    "-- rental already leaves the driver at 'approved'.",
    "--",
    "-- GENERATED from proposed/m2-packet/02.sql by scripts/closeout-option-b-v3.mjs.",
    "-- Do not hand-edit: run the generator. The packet file is not modified.",
    "--",
    "-- NOT INSTALLED. Needs separate owner approval. One transaction.",
    "",
  ].join("\n");
}

function rollbackHeader() {
  return [
    "-- Rollback for end-rental-safe-returns-approved-v3.sql.",
    "--",
    "-- Restores public.end_rental_safe_v1 exactly as HOSTED-INSTALL step 4",
    "-- installs it, so the closeout writes applications.status = 'closed' again.",
    "--",
    "-- GENERATED from proposed/m2-packet/02.sql by scripts/closeout-option-b-v3.mjs.",
    "-- One transaction. Run with ON_ERROR_STOP and without psql -1.",
    "",
  ].join("\n");
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("closeout-option-b-v3.mjs");
if (invokedDirectly) {
  const packet = readFileSync(SOURCE, "utf8");
  const forward = derive(packet);
  const back = deriveRollback(packet);
  const ROLLBACK = "proposed/closeout-option-b/rollback-end-rental-safe-returns-approved-v3.sql";
  if (process.argv.includes("--check")) {
    let bad = false;
    for (const [path, want] of [[OUTPUT, forward], [ROLLBACK, back]]) {
      if (readFileSync(path, "utf8") !== want) {
        console.error(`${path} does not match proposed/m2-packet/02.sql. Re-run the generator.`);
        bad = true;
      }
    }
    if (bad) process.exit(1);
    console.log("option B v3 and its rollback match proposed/m2-packet/02.sql");
  } else if (process.argv.includes("--write")) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync("proposed/closeout-option-b", { recursive: true });
    writeFileSync(OUTPUT, forward);
    writeFileSync(ROLLBACK, back);
    console.log(`wrote ${OUTPUT}\nwrote ${ROLLBACK}`);
  } else {
    process.stdout.write(forward);
  }
}
