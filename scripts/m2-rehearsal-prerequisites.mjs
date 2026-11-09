// The objects the M2 packet expects and supabase/migrations does not create.
//
// docs/m2-rehearsal.md records two first-pass failures caused by exactly this:
// step 6 failed on a missing public.application_identity_reviews, and step 13
// failed on a missing applications.deleted_at. A third gap is quieter --
// public.application_waitlist_holds is named inside a PL/pgSQL body, so
// CREATE FUNCTION succeeds without it and only execution fails.
//
// All three are live through Drizzle, not through supabase/migrations. No
// packet file may be changed to create them: on the real database they already
// exist, and a packet that created them would fail there.
//
// This extracts the exact statements from the Drizzle migrations rather than
// restating them, and takes only the objects the packet needs -- not the rest
// of those migrations, which reference further Drizzle tables.
//
//   node scripts/m2-rehearsal-prerequisites.mjs            # print
//   node scripts/m2-rehearsal-prerequisites.mjs --write
//   node scripts/m2-rehearsal-prerequisites.mjs --check
import { readFileSync } from "node:fs";

const OUTPUT = "proposed/rehearsal/drizzle-prerequisites.sql";

const SOURCES = [
  {
    file: "drizzle/migrations/0014_waitlist_holds_and_safe_promotion.sql",
    from: "CREATE TABLE public.application_waitlist_holds (",
    toEndOf: 'FOR SELECT TO authenticated USING (private.is_staff());',
    why: "public.application_waitlist_holds -- extend_rental_tx names it in a PL/pgSQL body",
    must: ["CREATE TABLE public.application_waitlist_holds", "application_waitlist_holds_one_active"],
  },
  {
    file: "drizzle/migrations/0016_0016_driver_deletion_stage1.sql",
    from: "ALTER TABLE public.applications",
    toEndOf: "CREATE INDEX IF NOT EXISTS applications_deleted_at_idx ON public.applications (deleted_at) WHERE deleted_at IS NOT NULL;",
    why: "applications.deleted_at and the four columns added by the same statement -- HOSTED-INSTALL step 13 failed without it",
    must: ["deleted_at timestamptz", "legal_hold boolean"],
  },
  {
    file: "drizzle/migrations/0019_application_identity_reviews.sql",
    whole: true,
    why: "public.application_identity_reviews -- HOSTED-INSTALL step 6 failed without it; its inline resolution CHECK is auto-named application_identity_reviews_resolution_check, which step 6 drops and replaces",
    must: ["CREATE TABLE public.application_identity_reviews", "resolution text CHECK"],
  },
  {
    file: "drizzle/migrations/0020_identity_reviews_tighten_grants.sql",
    whole: true,
    why: "the grants 0020 tightens on that table, so the rehearsal starts from the live grant shape",
    must: ["REVOKE ALL ON public.application_identity_reviews"],
  },
];

export function slice(source) {
  const text = readFileSync(source.file, "utf8");
  let body;
  if (source.whole) {
    body = text.trimEnd();
  } else {
    const start = text.indexOf(source.from);
    if (start < 0) throw new Error(`${source.file} no longer contains: ${source.from}`);
    const stop = text.indexOf(source.toEndOf, start);
    if (stop < 0) throw new Error(`${source.file} no longer contains: ${source.toEndOf}`);
    body = text.slice(start, stop + source.toEndOf.length);
  }
  for (const needle of source.must) {
    if (!body.includes(needle)) throw new Error(`${source.file} slice is missing: ${needle}`);
  }
  return body;
}

export function build() {
  const parts = SOURCES.map((s) => {
    const body = slice(s);
    return `-- ${s.why}\n-- from ${s.file}\n${body}\n`;
  });
  return `${header()}BEGIN;\n\n${parts.join("\n")}\nCOMMIT;\n`;
}

function header() {
  return [
    "-- M2 rehearsal baseline: the Drizzle-created objects the packet expects.",
    "--",
    "-- Apply AFTER supabase/migrations and BEFORE HOSTED-INSTALL step 1, on a",
    "-- disposable rehearsal database only. The production database already has",
    "-- every object below.",
    "--",
    "-- Requires private.is_staff() and private.is_owner(), which",
    "-- supabase/migrations creates, and the anon / authenticated / service_role",
    "-- roles.",
    "--",
    "-- GENERATED from the Drizzle migrations by",
    "-- scripts/m2-rehearsal-prerequisites.mjs. Do not hand-edit: run the",
    "-- generator. scripts/m2-rehearsal-prerequisites.test.mjs fails if this file",
    "-- and those migrations disagree. No packet file is modified.",
    "--",
    "-- One transaction. Run with ON_ERROR_STOP and without psql -1.",
    "",
  ].join("\n");
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("m2-rehearsal-prerequisites.mjs");
if (invokedDirectly) {
  const sql = build();
  if (process.argv.includes("--check")) {
    if (readFileSync(OUTPUT, "utf8") !== sql) {
      console.error(`${OUTPUT} does not match the Drizzle migrations. Re-run the generator.`);
      process.exit(1);
    }
    console.log(`${OUTPUT} matches the Drizzle migrations`);
  } else if (process.argv.includes("--write")) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync("proposed/rehearsal", { recursive: true });
    writeFileSync(OUTPUT, sql);
    console.log(`wrote ${OUTPUT}`);
  } else {
    process.stdout.write(sql);
  }
}
