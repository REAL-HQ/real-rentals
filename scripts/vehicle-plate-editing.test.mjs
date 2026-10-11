/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   A FIELD THE PROFILE SHOWS IS EDITABLE FROM THE DRAWER THAT CARD OPENS.
 *   ONE PLATE, ONE COLUMN, ONE WRITE PATH — TWO DOORS INTO IT, NOT TWO PLATES.
 *   A PLATE STATE IS CHOSEN FROM THE STATES, NEVER TYPED.
 *   A PLATE READ OFF PAPERWORK OR A PHOTO IS STILL CONFIRMED ONE FIELD AT A TIME.
 *
 * The report was concrete: RR-005 → Overview → Vehicle Details → Edit has no
 * place to type a plate, while the card right above it says "Plate: —". The
 * plate was never missing from the system — it lived in Registration & Title,
 * two tabs away — but a card that shows a value whose Edit button cannot reach
 * it is the same thing to the person onboarding the car.
 *
 * So the plate joins the identity whitelist and the Edit Details drawer, and
 * the tests below exist to stop that convenience from becoming a second,
 * weaker way into the column: the duplicate check, the uppercasing, the
 * Manager gate, the audit entry and the section whitelist all have to hold on
 * BOTH doors, and the extraction pipeline must still refuse to sweep a plate
 * in without someone looking at it.
 *
 * Real modules, fake Supabase, synthetic vehicles. No network, no paid call,
 * no real record.
 *
 * Run: node scripts/vehicle-plate-editing.test.mjs  (npm run test:plate)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".plate-build";
const V1 = "cccccccc-0000-4000-8000-000000000001";
const V2 = "cccccccc-0000-4000-8000-000000000002";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });
writeFileSync(`${OUT}/stub/supabase.js`, readFileSync("scripts/fake-supabase.src.mjs", "utf8"));
writeFileSync(`${OUT}/stub/react-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};
`);
// experience.server reads the chosen experience from a request header. There
// is no request here; an Owner in the Owner view is the default, which is the
// only tier that may write title identifiers.
writeFileSync(`${OUT}/stub/react-start-server.js`, `
export const getRequest = () => ({ headers: new Map() });
export const getRequestHeader = () => (globalThis.__experience ?? null);
`);
writeFileSync(`${OUT}/stub/auth-middleware.js`, `export const requireSupabaseAuth = {};`);
// Only the write is stubbed: @/lib/audit itself is the real module, so
// diffFields — which decides what the entry claims changed — is the real one.
writeFileSync(`${OUT}/stub/audit-server.js`, `
export const logAudit = async (actor, entry) => {
  (globalThis.__fakeSb.audit ??= []).push({ actor: actor?.role ?? null, ...entry });
};
export const diffFields = (b, p, keys) => { throw new Error("use the real diffFields"); };
`);

const alias = [
  "--alias:@=./src",
  `--alias:@tanstack/react-start/server=./${OUT}/stub/react-start-server.js`,
  `--alias:@tanstack/react-start=./${OUT}/stub/react-start.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub/auth-middleware.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/supabase.js`,
  `--alias:@/lib/audit.server=./${OUT}/stub/audit-server.js`,
];
const build = (entry, out) =>
  execFileSync("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${OUT}/${out}`, ...alias],
    { stdio: ["ignore", "ignore", "inherit"] });

build("src/lib/vehicles.functions.ts", "vehicles.mjs");
build("src/lib/us-states.ts", "states.mjs");

const { updateVehicleSection, createVehicle } = await import(`../${OUT}/vehicles.mjs`);
const { US_STATES, isUsStateCode, usStateOptions } = await import(`../${OUT}/states.mjs`);
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });

const call = (fn, data, userId = "mgr-1") =>
  fn({ data: fn._validate ? fn._validate(data) : data, context: { userId } });

/** One synthetic car under test, one to collide with. */
function seed({ plate = null, state = null, roles = { "mgr-1": "team", "own-1": "admin", "crd-1": "coordinator" } } = {}) {
  S.tables = {
    user_roles: Object.entries(roles).map(([user_id, role]) => ({ user_id, role })),
    vehicles: [
      { id: V1, unit_number: "SYN-1", year: 2013, make: "Ford", model: "Fusion", color: "Blue",
        license_plate: plate, plate_state: state, status: "onboarding", archived_at: null,
        registration_expires_on: null, title_on_file: false },
      { id: V2, unit_number: "SYN-2", year: 2016, make: "Toyota", model: "Camry",
        license_plate: "DUP1234", plate_state: "FL", status: "onboarding", archived_at: null },
    ],
    rentals: [], vehicle_titles: [], audit_log: [],
  };
  S.log = []; S.defaults = {}; S.audit = [];
}
const car = () => S.tables.vehicles.find((v) => v.id === V1);
/** What the drawer actually sends: the whole record, plus the operator's edits. */
const asDrawer = (edits) => ({ ...car(), ...edits });

// ======================================= 1. the plate saves from Edit Details
console.log("\nEdit Details saves the plate the card above it shows");
seed();
let r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ license_plate: "abc1234", plate_state: "fl" }) });
ok(r?.ok === true, "the identity drawer's save is accepted");
ok(car().license_plate === "ABC1234", "  the plate is stored upper-cased, as the unique index expects");
ok(car().plate_state === "FL", "  and so is the state");
ok((S.audit ?? []).some((e) => e.action === "vehicle.identity.updated" && /plate/.test(e.summary)),
  "  the audit entry names the plate as the thing that changed");

console.log("\nthe plate still saves from Registration & Title — same column, two doors");
seed();
r = await call(updateVehicleSection, { id: V1, section: "dmv", values: asDrawer({ license_plate: "xyz9876", plate_state: "GA" }) });
ok(r?.ok === true && car().license_plate === "XYZ9876" && car().plate_state === "GA",
  "the DMV drawer writes the same two columns");

console.log("\nan existing plate can be corrected");
seed({ plate: "OLD1111", state: "GA" });
r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ license_plate: "NEW2222", plate_state: "FL" }) });
ok(r?.ok === true && car().license_plate === "NEW2222" && car().plate_state === "FL", "the new plate replaces the old one");
ok((S.audit ?? []).some((e) => JSON.stringify(e.metadata ?? {}).includes("OLD1111")),
  "  and the audit entry keeps what it was before");

console.log("\na plate can be surrendered");
seed({ plate: "GONE999", state: "FL" });
r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ license_plate: "" }) });
ok(r?.ok === true && car().license_plate === null, "clearing the field stores null, not an empty string");

// ======================================= 2. duplicates
console.log("\ntwo cars cannot wear one plate");
for (const [typed, how] of [["DUP1234", "exactly"], ["dup1234", "in lower case"], [" Dup1234 ", "with stray spaces"]]) {
  seed();
  r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ license_plate: typed }) });
  ok(r?.ok === false && r.field === "license_plate" && /SYN-2 already has that plate/.test(String(r.error)),
    `a plate already on SYN-2, typed ${how}, is refused by name`);
  ok(car().license_plate === null, `  and nothing was written`);
}

console.log("\nthe duplicate check guards the DMV drawer too");
seed();
r = await call(updateVehicleSection, { id: V1, section: "dmv", values: asDrawer({ license_plate: "DUP1234" }) });
ok(r?.ok === false && r.field === "license_plate", "the older door is no weaker than the new one");

console.log("\na car is not a duplicate of itself");
seed({ plate: "SAME777", state: "FL" });
r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ color: "Silver" }) });
ok(r?.ok === true && car().color === "Silver" && car().license_plate === "SAME777",
  "saving other details with the plate untouched is accepted");

// ======================================= 3. invalid values
console.log("\nwhat is never a plate is refused");
for (const [bad, why] of [
  ["A", "a single character"],
  ["AB!@#", "punctuation"],
  ["%", "a LIKE wildcard, which would otherwise match the whole fleet"],
  ["_______", "underscore wildcards"],
  ["ABCDEFGHIJKLMNOPQRSTUV", "22 characters"],
  ["<script>x</script>", "markup"],
]) {
  seed();
  r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ license_plate: bad }) });
  ok(r?.ok === false && r.field === "license_plate", `${why} is refused`);
  ok(car().license_plate === null, `  and nothing was written`);
}

console.log("\na real plate is not refused for looking unusual");
for (const good of ["ABC1234", "7ABC123", "TEMP 4455", "DLR-9", "AB 12 CD"]) {
  seed();
  r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ license_plate: good }) });
  ok(r?.ok === true && car().license_plate === good.toUpperCase(), `"${good}" is accepted`);
}

console.log("\na plate recorded before these rules does not lock the record");
seed({ plate: "TEMP TAG #4455", state: "FL" });
r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ color: "Grey" }) });
ok(r?.ok === true && car().color === "Grey", "the rest of the car is still editable");
ok(car().license_plate === "TEMP TAG #4455", "  and the odd plate is left exactly as it was");

console.log("\nthe plate state is one of the states or nothing at all");
for (const bad of ["ZZ", "Florida", "F", "XX"]) {
  seed();
  r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ plate_state: bad }) });
  ok(r?.ok === false && r.field === "plate_state" && /state that issued/.test(String(r.error)),
    `"${bad}" is refused, naming the field so the dropdown shows it`);
}
seed({ plate: "ABC1234", state: "FL" });
r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ plate_state: "" }) });
ok(r?.ok === true && car().plate_state === null, "an unknown state stays unknown rather than invented");

console.log("\nthe same rules apply when the car is first created");
seed();
r = await call(createVehicle, { year: 2013, make: "Ford", model: "Fusion", license_plate: "ABC!!!", plate_state: "FL" });
ok(r?.ok === false && r.field === "license_plate", "Add Vehicle refuses a plate that is not one");
seed();
r = await call(createVehicle, { year: 2013, make: "Ford", model: "Fusion", license_plate: "ABC1234", plate_state: "ZZ" });
ok(r?.ok === false && r.field === "plate_state", "Add Vehicle refuses a state that is not one");
seed();
r = await call(createVehicle, { year: 2013, make: "Ford", model: "Fusion", license_plate: "DUP1234" });
ok(r?.ok === false && r.field === "license_plate" && /already has that plate/.test(String(r.error)),
  "Add Vehicle still refuses a plate another car wears");

// ======================================= 4. who may do it
console.log("\nediting a plate is Manager-and-above, as it was");
seed();
let threw = null;
try { await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ license_plate: "ABC1234" }) }, "crd-1"); }
catch (e) { threw = e; }
ok(!!threw && /Forbidden/.test(String(threw.message)), "a Coordinator is refused");
ok(car().license_plate === null, "  and wrote nothing");

seed();
threw = null;
try { await call(updateVehicleSection, { id: V1, section: "dmv", values: asDrawer({ license_plate: "ABC1234" }) }, "crd-1"); }
catch (e) { threw = e; }
ok(!!threw && /Forbidden/.test(String(threw.message)), "a Coordinator is refused at the other door too");

seed();
r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ license_plate: "MGR1234" }) }, "mgr-1");
ok(r?.ok === true && car().license_plate === "MGR1234", "a Manager may record it");
seed();
r = await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ license_plate: "OWN1234" }) }, "own-1");
ok(r?.ok === true && car().license_plate === "OWN1234", "so may an Owner");

seed();
threw = null;
try { await call(updateVehicleSection, { id: V1, section: "identity", values: asDrawer({ license_plate: "ABC1234" }) }, "nobody"); }
catch (e) { threw = e; }
ok(!!threw && /Forbidden/.test(String(threw.message)), "a signed-in user with no staff role is refused");

// ======================================= 5. the whitelist still decides
console.log("\nthe section whitelist still decides what a drawer may write");
seed({ plate: "KEEP111", state: "FL" });
r = await call(updateVehicleSection, { id: V1, section: "keys", values: { key_count: 2, license_plate: "SNEAK99", plate_state: "GA" } });
ok(r?.ok === true, "the Keys drawer saves its own fields");
ok(car().license_plate === "KEEP111" && car().plate_state === "FL",
  "  and cannot change a plate, whatever the browser sends");
seed({ plate: "KEEP111" });
r = await call(updateVehicleSection, { id: V1, section: "gps", values: { gps_provider: "Bouncie", license_plate: "SNEAK99" } });
ok(car().license_plate === "KEEP111", "nor can the GPS drawer");

console.log("\nthe identity drawer gained the plate and nothing else");
const SRC = readFileSync("src/lib/vehicles.functions.ts", "utf8");
const identityList = SRC.split("export const VEHICLE_SECTIONS = {")[1].split("insurance: [")[0];
for (const f of ["license_plate", "plate_state"]) ok(identityList.includes(`"${f}"`), `identity may write ${f}`);
for (const f of ["vin", "registration_number", "registration_expires_on", "title_number", "title_status", "insurance_carrier"]) {
  ok(!identityList.includes(`"${f}"`), `identity still may not write ${f}`);
}

// ======================================= 6. the states themselves
console.log("\none list of states, used everywhere");
ok(US_STATES.length === 51, `51 entries — 50 states and DC (got ${US_STATES.length})`);
ok(US_STATES.every((s) => /^[A-Z]{2}$/.test(s.code) && s.name.length > 3), "every entry is a two-letter code with a name");
ok(new Set(US_STATES.map((s) => s.code)).size === US_STATES.length, "no code appears twice");
for (const c of ["FL", "GA", "NY", "CA", "DC"]) ok(isUsStateCode(c), `${c} is a state`);
for (const c of ["ZZ", "", "Florida", null, undefined, "F"]) ok(!isUsStateCode(c), `${JSON.stringify(c)} is not`);
ok(isUsStateCode("fl") && isUsStateCode(" fl "), "a typed code is read case- and space-insensitively");
const opts = usStateOptions();
ok(opts.length === 52 && opts[0].value === "" , "the dropdown offers a blank first — unknown is a real answer");
ok(opts.some((o) => o.value === "FL" && /Florida/.test(o.label)), "and names the state beside the code");

// ======================================= 7. the screens
console.log("\nthe drawers reflect it");
const PROFILE = readFileSync("src/components/admin/VehicleProfile.tsx", "utf8");
const EDITOR = readFileSync("src/components/admin/VehicleEditorDrawer.tsx", "utf8");
const ADD = readFileSync("src/components/admin/AddVehicleDialog.tsx", "utf8");

const identityBlock = PROFILE.split('{section === "identity" && (')[1].split('{section === "insurance" && (')[0];
ok(/label="License Plate"/.test(identityBlock), "Edit Details has a License Plate field");
ok(/set\("license_plate", v\)/.test(identityBlock), "  wired to the license_plate column");
ok(/error=\{err\("license_plate"\)\}/.test(identityBlock), "  showing the server's refusal on the field itself");
ok(/label="Plate State"/.test(identityBlock) && /usStateOptions\(\)/.test(identityBlock),
  "  and a Plate State dropdown of the states");
ok(!/label="VIN"/.test(identityBlock), "Edit Details does not duplicate the VIN field");
ok(!/registration_number|registration_expires_on/.test(identityBlock), "  nor the registration fields");

ok(/data-testid="identity-open-dmv"/.test(identityBlock), "Edit Details links out to the paperwork");
ok(/confirmLeaveIfUnsaved\(\)/.test(identityBlock) && /onOpenSection\("dmv"\)/.test(identityBlock),
  "  asking first when there are unsaved edits");
ok(/Registration Expiration/.test(identityBlock), "  and says the expiration date is through that door");

const dmvBlock = PROFILE.split('{section === "dmv" && (')[1].split('{section === "gps" && (')[0];
ok(/<DateInput\s+label="Registration Expires"/.test(dmvBlock), "Registration Expires is a date field a human can type");
ok(/usStateOptions\(\)/.test(dmvBlock), "the DMV drawer's Plate State is the same dropdown");

/**
 * Every editable "Plate State" must be a <Choice>. <Row> is the read-only
 * line on the DMV card and is allowed; a <Text> or a bare <input> is the
 * free-text box this work removed.
 */
function plateStateTags(src) {
  return [...src.matchAll(/label="Plate State"/g)].map((m) => {
    const open = src.lastIndexOf("<", m.index);
    return src.slice(open, src.indexOf(" ", open) + 1).trim();
  });
}
for (const [name, src] of [["the profile drawers", PROFILE], ["the whole-vehicle editor", EDITOR]]) {
  const tags = plateStateTags(src);
  ok(tags.includes("<Choice") && tags.every((t) => t === "<Choice" || t === "<Row"),
    `${name} edit plate state through a dropdown only (found ${tags.join(", ") || "none"})`);
}
ok(/<Choice[\s\S]{0,200}label="Plate State"[\s\S]{0,200}usStateOptions\(\)/.test(EDITOR),
  "the whole-vehicle editor uses the dropdown too");
ok(/usStateOptions\(\)/.test(ADD) && !/plate_state[^\n]*maxLength=\{2\}/.test(ADD),
  "so does Add Vehicle, in place of its two-character box");

ok(PROFILE.split("usStateOptions()").length - 1 === 2, "both profile drawers use the shared list, not a local copy");
for (const [name, src] of [["VehicleProfile", PROFILE], ["VehicleEditorDrawer", EDITOR], ["AddVehicleDialog", ADD]]) {
  ok(!/\bAL["']?,\s*["']?AK\b/.test(src), `${name} has no second state list of its own`);
}

console.log("\nthe profile re-reads the record after a save");
ok(/onSaved=\{afterSave\}/.test(PROFILE), "the section drawer reports back to afterSave");
ok(/async function afterSave\(\)\s*\{[\s\S]{0,160}await refresh\(\)/.test(PROFILE),
  "  which re-reads the vehicle, so the card shows the plate that was just saved");
ok(/key=\{editing\}/.test(PROFILE), "a drawer handed over to another section starts from the saved record");
ok(/getVehicleProfile/.test(PROFILE) && /license_plate/.test(readFileSync("src/lib/vehicle-readiness.ts", "utf8")),
  "and the readiness checklist is computed from the record it just re-read");

// ======================================= 8. extraction is unchanged
console.log("\nan extracted plate still needs a person");
const INBOX = readFileSync("src/lib/fleet-inbox.functions.ts", "utf8");
const safeExpr = INBOX.split("\n          safe: ")[1].split("evidence:")[0];
for (const f of ["license_plate", "plate_state", "vin", "current_odometer"]) {
  ok(safeExpr.includes(`"${f}"`), `${f} is never swept in by Approve Safe Fields`);
}
ok(/c\.kind === "fill"/.test(safeExpr), "and only a BLANK field is ever safe, so an existing plate is never overwritten");
ok(/\(c\.kind === "fill" \? suggestions : conflicts\)\.push\(row\)/.test(INBOX),
  "a plate that disagrees with the record is filed as a conflict for a human, not a suggestion");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} blocker(s)` : "\nall plate-editing checks pass");
process.exit(fail ? 1 : 0);
