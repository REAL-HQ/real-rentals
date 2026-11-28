/**
 * Driver portal visibility (Dolmar 11/27/2026): a renter sees their own
 * records, including files staff or FLEET filed team only, and never internal
 * categories or another renter's files.
 *
 * Part 1: the TypeScript rule and the server reads that use it.
 * Part 2: 20261127203000_driver_portal_documents.sql against a throwaway
 * Postgres (RLS on documents and the storage read policy). Never reads
 * production env. Skips the Postgres part when no initdb is found.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DRIVER_PORTAL_CATEGORIES,
  DRIVER_PORTAL_INTERNAL_CATEGORIES,
  driverPortalShows,
} from "../src/lib/driver-portal-documents";

const MIGRATION = readFileSync(
  new URL("../supabase/migrations/20261127203000_driver_portal_documents.sql", import.meta.url),
  "utf8",
);

describe("driver portal document rule", () => {
  test("own records show even when filed team only", () => {
    for (const c of ["insurance", "license_front", "license_back", "gig_profile", "income", "trip_history", "agreement", "rental_application"])
      expect(driverPortalShows({ category: c, visibility: ["admin"] })).toBe(true);
  });
  test("internal categories never show, whatever visibility says", () => {
    for (const c of DRIVER_PORTAL_INTERNAL_CATEGORIES) {
      expect(driverPortalShows({ category: c, visibility: ["driver", "admin"] })).toBe(false);
      expect(driverPortalShows({ category: c, visibility: ["admin"] })).toBe(false);
    }
    expect(driverPortalShows({ category: "other", kind: "screening", visibility: ["driver", "admin"] })).toBe(false);
    for (const c of ["screening", "insurance_quote", "verification_recording"]) expect(DRIVER_PORTAL_INTERNAL_CATEGORIES).toContain(c);
  });
  test("everything else shows only when staff shared it", () => {
    for (const c of ["other", "registration", "condition_photo", "payment_confirmation", "unknown", null]) {
      expect(driverPortalShows({ category: c, visibility: ["admin"] })).toBe(false);
      expect(driverPortalShows({ category: c, visibility: ["driver", "admin"] })).toBe(true);
    }
  });
  test("SQL lists equal the TypeScript lists", () => {
    const arrays = [...MIGRATION.matchAll(/ARRAY\[((?:'[a-z_]+'(?:,\s*)?)+)\]/g)].map((m) =>
      [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort().join(","),
    );
    expect(arrays).toContain([...DRIVER_PORTAL_INTERNAL_CATEGORIES].sort().join(","));
    expect(arrays).toContain([...DRIVER_PORTAL_CATEGORIES].sort().join(","));
  });
  test("portal reads use the rule, sign as the service role, and drop staff notes", () => {
    const portal = readFileSync("src/lib/portal.functions.ts", "utf8");
    const docsFn = portal.slice(portal.indexOf("export const getDriverDocuments"), portal.indexOf("export type DriverIssue"));
    expect(docsFn).toContain("driverPortalShows(d)");
    expect(docsFn).toContain("await supabaseAdmin.storage");
    expect(docsFn).not.toContain("await supabase.storage");
    expect(docsFn).toContain("review_note: null");
    expect(docsFn).toContain('.in("driver_id", appIds)');
    expect(docsFn).toContain('.from("applications").select("id").eq("user_id", userId)');
    const lib = readFileSync("src/lib/documents.functions.ts", "utf8");
    const stored = lib.slice(lib.indexOf("export async function listStoredDriverDocuments"), lib.indexOf("export async function registerDocument"));
    expect(stored).toContain("DRIVER_PORTAL_CATEGORIES");
    expect(stored).toContain('.in("driver_id", applicationIds)');
    expect(stored).toContain("review_note: null");
    expect(stored).toContain("notes: null");
    const vault = lib.slice(lib.indexOf("export const getMyVault"), lib.indexOf("export const setDocumentReview"));
    expect(vault).toContain("driverPortalShows(d)");
    expect(vault).toContain('.eq("user_id", context.userId)');
    const ui = readFileSync("src/components/admin/DocumentVault.tsx", "utf8");
    expect(ui).toContain("DRIVER_PORTAL_INTERNAL_CATEGORIES.includes(c.key)");
  });
  test("vehicle: plate and VIN last 6 only, never a unit number or the full VIN", async () => {
    process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
    process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
    const portal = readFileSync("src/lib/portal.functions.ts", "utf8");
    const m = /export function vinLast6ForDriver[\s\S]*?\n}\n/.exec(portal)![0];
    const fn = new Function(`${m.replace("export ", "").replace(/: unknown/, "").replace(/: string \| null/, "")}; return vinLast6ForDriver;`)();
    expect(fn("1FAHP3F20CL123456")).toBe("123456");
    expect(fn(" 1fa-hp3f20cl12345a ")).toBe("12345A");
    expect(fn(null)).toBe(null);
    const dash = portal.slice(portal.indexOf("export const getDriverDashboard"));
    expect(dash).toContain("vin_last6: vinLast6ForDriver(");
    expect(dash).not.toContain("unit_number");
    const route = readFileSync("src/routes/portal.tsx", "utf8");
    const view = route.slice(route.indexOf("function VehicleView"), route.indexOf("function Field("));
    expect(view).toContain('label="Plate"');
    expect(view).toContain('label="VIN"');
    expect(view).toContain("v.vin_last6");
    expect(view).not.toMatch(/unit/i);
  });
});

// ------------------------------------------------------------------ Postgres

function candidates(): string[] {
  const out: string[] = [];
  if (process.env.PG_BIN) out.push(process.env.PG_BIN);
  const r = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) out.push(r.stdout.trim());
  if (existsSync("/usr/lib/postgresql"))
    for (const v of readdirSync("/usr/lib/postgresql")) out.push(`/usr/lib/postgresql/${v}/bin`);
  out.push("/workspace/pg17/node_modules/@embedded-postgres/linux-x64/native/bin");
  return out;
}
const BIN = candidates().find((d) => existsSync(join(d, "initdb")) && existsSync(join(d, "pg_ctl")));
const DIR = mkdtempSync(join(tmpdir(), "rr-portal-vis-pg-"));
const PORT = String(56000 + Math.floor(Math.random() * 4000));
const PSQL = BIN && existsSync(join(BIN, "psql")) ? join(BIN, "psql") : "psql";

function run(bin: string, args: string[]) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed\n${r.stdout}\n${r.stderr}`);
}
function psql(sql: string) {
  const r = spawnSync(PSQL, ["-h", DIR, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q"], {
    input: sql,
    encoding: "utf8",
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: r.stderr ?? "" };
}
function must(sql: string) {
  const r = psql(sql);
  if (!r.ok) throw new Error(r.err);
  return r.out;
}
/** A signed-in browser session for this auth user. */
function as(uid: string, sql: string) {
  return must(`SET test.uid = '${uid}'; SET ROLE authenticated; ${sql}`);
}

const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APP1 = "11111111-1111-4111-8111-111111111111";
const APP2 = "22222222-2222-4222-8222-222222222222";

const STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA private; CREATE SCHEMA auth; CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA public, private, auth, storage TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.applications (id uuid PRIMARY KEY, user_id uuid);
CREATE TABLE public.documents (id text PRIMARY KEY, driver_id uuid, category text, kind text, visibility text[], storage_bucket text, storage_path text);
CREATE TABLE storage.objects (bucket_id text, name text);
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.applications, public.documents, storage.objects TO authenticated;
-- Pre-migration policy, as on production, so DROP/CREATE is exercised.
CREATE POLICY "Drivers view their own documents" ON public.documents FOR SELECT TO authenticated
  USING ('driver' = ANY (visibility) AND driver_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.applications a WHERE a.id = documents.driver_id AND a.user_id = auth.uid()));
`;

const DOCS: Array<[string, string, string, string, string[], string, string]> = [
  // id, app, category, kind, visibility, bucket, path
  ["ins-team", APP1, "insurance", "insurance", ["admin"], "driver-docs", `${APP1}/internal/insurance-1.pdf`],
  ["ins-shared", APP1, "insurance", "insurance", ["driver", "admin"], "driver-docs", `${APP1}/insurance-2.pdf`],
  ["lic-team", APP1, "license_front", "license_front", ["admin"], "license-uploads", `${APP1}/lic.jpg`],
  ["quote", APP1, "insurance_quote", "insurance_quote", ["admin"], "driver-docs", `${APP1}/internal/quote.pdf`],
  ["quote-shared", APP1, "insurance_quote", "insurance_quote", ["driver", "admin"], "driver-docs", `${APP1}/quote2.pdf`],
  ["screen", APP1, "screening", "screening", ["driver", "admin"], "driver-docs", `${APP1}/screen.pdf`],
  ["rec", APP1, "verification_recording", "verification_recording", ["driver", "admin"], "driver-docs", `${APP1}/internal/rec.m4a`],
  ["other-team", APP1, "other", "other", ["admin"], "driver-docs", `${APP1}/internal/other.pdf`],
  ["other-shared", APP1, "other", "other", ["driver", "admin"], "driver-docs", `${APP1}/other2.pdf`],
  ["b-ins", APP2, "insurance", "insurance", ["driver", "admin"], "driver-docs", `${APP2}/insurance.pdf`],
  ["b-lic", APP2, "license_front", "license_front", ["admin"], "driver-docs", `${APP2}/internal/lic.pdf`],
];

const skip = !BIN;
beforeAll(() => {
  if (skip) return;
  run(join(BIN!, "initdb"), ["-D", join(DIR, "data"), "-U", "postgres", "-A", "trust"]);
  run(join(BIN!, "pg_ctl"), ["-D", join(DIR, "data"), "-l", join(DIR, "pg.log"), "-o", `-k ${DIR} -p ${PORT} -c listen_addresses=''`, "-w", "start"]);
  must(STUBS);
  must(MIGRATION);
  must(MIGRATION); // re-runnable
  must(`INSERT INTO public.applications VALUES ('${APP1}', '${U1}'), ('${APP2}', '${U2}');`);
  for (const [id, app, cat, kind, vis, bucket, path] of DOCS) {
    must(`INSERT INTO public.documents VALUES ('${id}', '${app}', '${cat}', '${kind}', ARRAY[${vis.map((v) => `'${v}'`).join(",")}]::text[], '${bucket}', '${path}');
          INSERT INTO storage.objects VALUES ('${bucket}', '${path}');`);
  }
  // A file with no document row, in the renter's own folder.
  must(`INSERT INTO storage.objects VALUES ('driver-docs', '${APP1}/internal/stray.pdf');`);
});
afterAll(() => {
  if (skip) return;
  spawnSync(join(BIN!, "pg_ctl"), ["-D", join(DIR, "data"), "-m", "immediate", "stop"]);
  rmSync(DIR, { recursive: true, force: true });
});

describe.skipIf(skip)("driver portal RLS and storage policy in Postgres", () => {
  test("a renter reads their own records, including team-only insurance and licence files", () => {
    expect(as(U1, `SELECT string_agg(id, ',' ORDER BY id) FROM public.documents`)).toBe(
      "ins-shared,ins-team,lic-team,other-shared",
    );
  });
  test("a renter never reads another renter's documents", () => {
    expect(as(U1, `SELECT count(*) FROM public.documents WHERE driver_id = '${APP2}'`)).toBe("0");
    expect(as(U2, `SELECT string_agg(id, ',' ORDER BY id) FROM public.documents`)).toBe("b-ins,b-lic");
    expect(as(U2, `SELECT count(*) FROM public.documents WHERE driver_id = '${APP1}'`)).toBe("0");
  });
  test("internal categories stay hidden even when a row says driver", () => {
    expect(
      as(U1, `SELECT count(*) FROM public.documents WHERE category IN ('screening','insurance_quote','verification_recording')`),
    ).toBe("0");
    expect(as(U1, `SELECT count(*) FROM public.documents WHERE id = 'other-team'`)).toBe("0");
  });
  test("signed out sees nothing", () => {
    expect(must(`SET ROLE authenticated; SELECT count(*) FROM public.documents`)).toBe("0");
    expect(must(`SET ROLE authenticated; SELECT count(*) FROM storage.objects`)).toBe("0");
  });
  test("storage: only the files of the renter's own visible documents", () => {
    expect(as(U1, `SELECT string_agg(name, ',' ORDER BY name) FROM storage.objects`)).toBe(
      [`${APP1}/insurance-2.pdf`, `${APP1}/internal/insurance-1.pdf`, `${APP1}/lic.jpg`, `${APP1}/other2.pdf`].sort().join(","),
    );
    expect(as(U1, `SELECT count(*) FROM storage.objects WHERE name LIKE '${APP2}/%'`)).toBe("0");
    expect(as(U1, `SELECT count(*) FROM storage.objects WHERE name LIKE '%quote%' OR name LIKE '%screen%' OR name LIKE '%rec.m4a' OR name LIKE '%stray%'`)).toBe("0");
    expect(as(U2, `SELECT string_agg(name, ',' ORDER BY name) FROM storage.objects`)).toBe(
      [`${APP2}/insurance.pdf`, `${APP2}/internal/lic.pdf`].sort().join(","),
    );
  });
  test("a bucket outside the list is never opened by this policy", () => {
    must(`INSERT INTO public.documents VALUES ('veh', '${APP1}', 'insurance', 'insurance', ARRAY['driver']::text[], 'vehicle-docs', 'v/1.pdf');
          INSERT INTO storage.objects VALUES ('vehicle-docs', 'v/1.pdf');`);
    expect(as(U1, `SELECT count(*) FROM storage.objects WHERE bucket_id = 'vehicle-docs'`)).toBe("0");
  });
  test("renters cannot call the definer helper for someone else", () => {
    expect(as(U2, `SELECT private.driver_can_read_document_object('driver-docs', '${APP1}/insurance-2.pdf')`)).toBe("f");
    expect(as(U1, `SELECT private.driver_can_read_document_object('driver-docs', '${APP1}/insurance-2.pdf')`)).toBe("t");
    expect(must(`SELECT has_function_privilege('anon', 'private.driver_can_read_document_object(text,text)', 'EXECUTE')`)).toBe("f");
  });
});
