/**
 * The hosted preflight refuses non-SELECT SQL before it connects, and every
 * absent object in proposed/m2-preflight.sql maps to the install step that
 * creates it.
 */
import { readFileSync } from "node:fs";
import {
  assertPreflightTarget,
  assertSelectOnly,
  checklistStops,
  formatChecklist,
  hostedInstallSteps,
  loadChecklistInputs,
  mapPreflightSteps,
  runChecklist,
  stepForCheck,
} from "./m2-hosted-preflight";

const root = new URL("..", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");

for (const sql of [
  "INSERT INTO public.applications DEFAULT VALUES",
  "UPDATE public.applications SET status = 'approved'",
  "DELETE FROM public.applications",
  "DROP TABLE public.applications",
  "CREATE TABLE public.kept (id int)",
  "SELECT 1; DROP TABLE public.applications",
  "WITH w AS (INSERT INTO public.applications DEFAULT VALUES RETURNING id) SELECT id FROM w",
]) {
  let refused = false;
  try {
    assertSelectOnly(sql);
  } catch (error) {
    refused = error instanceof Error && error.message.startsWith("Refusing to run:");
  }
  if (!refused) throw new Error(`non-SELECT was accepted: ${sql}`);
}

const loaded = loadChecklistInputs(read);
if (!loaded.mapped.get("public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)")) {
  throw new Error("content-sha function was not mapped");
}
const expectStep = (name: string, step: number) => {
  const actual = loaded.mapped.get(name);
  if (actual !== step) throw new Error(`${name} mapped to ${actual}, expected step ${step}`);
};
expectStep("public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)", 2);
expectStep("private.approval_validate(uuid)", 3);
expectStep("role rr_record_executor", 5);
expectStep("private.record_customer_number_seq", 5);
expectStep("trigger private.record_customers.record_immutable", 5);
expectStep("public.documents.integrity_v1", 8);
expectStep("private.storage_integrity_v1()", 21);
expectStep("private.swap_number_seq", 26);
expectStep("public.extend_rental_tx(uuid, uuid, date, date, text, uuid)", 27);
expectStep("public.return_checklists", 28);
expectStep("public.link_replacement_agreement_checked(uuid, uuid)", 24);

const steps = hostedInstallSteps(read("proposed/HOSTED-INSTALL.md"));
const created = steps.map((step) => ({ step: step.step, objects: { functions: new Set<string>(), relations: new Set<string>(), roles: new Set<string>(), policies: [], triggers: [], columns: new Set<string>(), indexes: new Set<string>() } }));
if (stepForCheck("storage.objects", created) !== 0) throw new Error("a prerequisite was given an install step");
mapPreflightSteps(read("proposed/m2-preflight.sql"), steps, read);

let connected = false;
const connect = async () => {
  connected = true;
  return [];
};
let dropRefused = false;
try {
  await runChecklist({
    url: "postgresql://postgres@127.0.0.1:1/nope?sslmode=disable",
    hosted: false,
    statements: ["DROP TABLE public.applications"],
    mapped: new Map(),
    connect,
  });
} catch (error) {
  dropRefused = error instanceof Error && error.message.startsWith("Refusing to run:");
}
if (!dropRefused || connected) throw new Error("DROP opened a connection or was not refused");

let hostedRefused = false;
try {
  assertPreflightTarget("postgresql://postgres@db.example:5432/postgres", false);
} catch (error) {
  hostedRefused = error instanceof Error && error.message.includes("--hosted");
}
if (!hostedRefused) throw new Error("a non-loopback host was accepted without --hosted");
assertPreflightTarget("postgresql://postgres@127.0.0.1:55442/m2?sslmode=disable", false);

const text = formatChecklist([
  { step: 2, check_name: "flag column public.documents.content_sha256", expected: "present", actual: "absent", ok: false },
  { step: 0, check_name: "server_version", expected: "report", actual: "16", ok: true },
]);
if (checklistStops(text) !== 1 || !text.includes("STOP step 2 flag column public.documents.content_sha256")) {
  throw new Error(`checklist did not stop: ${text}`);
}
if (!text.includes("PASS step 9 no separate object")) throw new Error("a replace-only step was omitted");

console.log("hosted preflight guard pass");
