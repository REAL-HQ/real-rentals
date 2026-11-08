import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import assert from "node:assert/strict";

const OUT = ".vshare-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });
const write = (name, body) => writeFileSync(`${OUT}/stub/${name}.js`, body);

write("react-start", `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => (args) => fn({ ...args, data: api._v?.parse ? api._v.parse(args.data) : args.data }) };
  return api;
};
`);
write("auth", `export const requireSupabaseAuth = {};`);
write("router", `export const createFileRoute = () => (config) => config;`);
write("roles", `
export const requireManager = async (userId) => {
  const S = globalThis.__vshare;
  if (S.tier === 'coordinator') throw new Error('Forbidden');
  return { userId, tier: S.tier, role: S.tier === 'owner' ? 'admin' : 'team' };
};
`);
write("audit", `export const logAudit = async (actor, entry) => { globalThis.__vshare.audit.push(entry); };`);
write("server", `
export const getRequest = () => ({ url: 'http://localhost:8080/_serverFn/test' });
export const setResponseHeader = () => {};
`);
write("email", `export const sendEmail = async (args) => { globalThis.__vshare.emails.push(args); return { ok: true, id: 'email-test' }; };`);
write("sms", `
export const toE164 = (raw) => { const d = String(raw).replace(/\\D/g, ''); return d.length === 10 ? '+1' + d : d.length === 11 && d.startsWith('1') ? '+' + d : null; };
export const sendSms = async (args) => { globalThis.__vshare.sms.push(args); return { ok: true, id: 'sms-test' }; };
`);
write("client", `
const S = globalThis.__vshare;
function query(table) {
  const filters = [];
  const q = {
    select: () => q,
    eq: (column, value) => (filters.push((row) => row[column] === value), q),
    in: (column, values) => (filters.push((row) => values.includes(row[column])), q),
    order: () => q,
    maybeSingle: () => Promise.resolve({ data: rows().find(() => true) ?? null, error: null }),
    insert: (value) => { S.settings.push(value); return Promise.resolve({ error: null }); },
    then: (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
  };
  function rows() {
    const source = table === 'vehicles' ? [S.vehicle] : table === 'vehicle_media' ? S.media : S.settings;
    return source.filter((row) => filters.every((fn) => fn(row)));
  }
  return q;
}
export const supabaseAdmin = { from: query, storage: { from: (bucket) => ({ download: async (path) => { S.downloads.push({ bucket, path }); return { data: new Blob(['SYNTHETIC_IMAGE'], { type: 'image/jpeg' }), error: null }; } }) } };
`);

execFileSync("npx", ["esbuild", "src/lib/vehicle-share.functions.ts", "--bundle", "--platform=node", "--format=esm", "--alias:@=./src",
  `--alias:@tanstack/react-start=./${OUT}/stub/react-start.js`,
  `--alias:@tanstack/react-start/server=./${OUT}/stub/server.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub/auth.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/client.js`,
  `--alias:@/lib/roles.server=./${OUT}/stub/roles.js`,
  `--alias:@/lib/audit=./${OUT}/stub/audit.js`,
  `--alias:@/lib/email.server=./${OUT}/stub/email.js`,
  `--alias:@/lib/sms.server=./${OUT}/stub/sms.js`,
  `--outfile=${OUT}/share.mjs`, "--log-level=warning"], { stdio: "inherit" });
execFileSync("npx", ["esbuild", "src/routes/share/vehicle-photo/$token/$mediaId.ts", "--bundle", "--platform=node", "--format=esm", "--alias:@=./src",
  `--alias:@tanstack/react-router=./${OUT}/stub/router.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/client.js`,
  `--outfile=${OUT}/media-route.mjs`, "--log-level=warning"], { stdio: "inherit" });

const mod = await import(`../${OUT}/share.mjs`);
const mediaRoute = (await import(`../${OUT}/media-route.mjs`)).Route.server.handlers.GET;
const V = "00000000-0000-4000-8000-000000000001";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const D = "00000000-0000-4000-8000-00000000000d";
const E = "00000000-0000-4000-8000-00000000000e";
const media = (id, values = {}) => ({ id, vehicle_id: V, kind: "original", storage_bucket: "vehicle-photos", storage_path: `${id}.jpg`, file_name: `${id}.jpg`, mime_type: "image/jpeg", published: false, is_primary: false, sort_order: 0, created_at: "2026-11-08T00:00:00.000Z", ...values });
const S = globalThis.__vshare = { tier: "owner", settings: [], media: [], audit: [], emails: [], sms: [], downloads: [], vehicle: null };
function reset() {
  S.tier = "owner"; S.settings = []; S.audit = []; S.emails = []; S.sms = []; S.downloads = [];
  S.vehicle = { id: V, unit_number: "RR-001", year: 2026, make: "Toyota", model: "Camry", trim: null, color: "White", vin: "1HGCM82633A004352", license_plate: "ABC123", plate_state: "FL", plate_expires_on: null, registration_number: "REG-9", registration_state: "FL", registration_expires_on: "2027-10-11" };
  S.media = [
    media(A, { published: true, is_primary: true, sort_order: 1 }),
    media(B, { published: true, sort_order: 2 }),
    media(C, { sort_order: 0 }),
    media(D, { kind: "ai_enhanced", review_status: "approved", derived_from_id: A }),
    media(E, { kind: "ai_enhanced", review_status: "pending", published: true }),
  ];
}
const context = { userId: "manager-1" };
let checks = 0;
const ok = (condition, label) => { assert.equal(condition, true, label); checks++; console.log("PASS", label); };

reset();
const options = await mod.getVehicleShareOptions({ data: { vehicleId: V }, context });
ok(options.enhancedPhotoIds.join(",") === D, "the first package selects only approved AI enhancements");
ok(options.insurancePhotoIds.join(",") === `${A},${B}`, "automatic package selects only lead and published listing photos");
ok(options.photos.length === 4 && !options.photos.some((p) => p.id === E), "manual choices include originals and approved retouches but exclude pending derivatives");

const insurance = await mod.createVehicleSharePackage({ data: { vehicleId: V, mode: "insurance", mediaIds: [E] }, context });
ok(insurance.ok, "Owner creates the insurance package");
const created = insurance.package;
ok(created.photoCount === 2 && created.includeDetails, "server ignores client ids and enforces the reviewed insurance selection/details");
ok(created.url.startsWith("https://drivereal.com/share/vehicle/") && !created.url.includes("localhost"), "packages created in Preview still receive a public recipient link");
ok(Date.parse(created.expiresAt) - Date.parse(S.settings[0].value.createdAt) === 72 * 60 * 60 * 1000, "the private link expires exactly 72 hours after creation");
ok(!JSON.stringify(S.settings[0].value).includes(created.token), "the raw share token is never stored");
ok(S.settings[0].value.details.sections.flatMap((s) => s.rows).some((r) => r.value === "1HGCM82633A004352"), "the package snapshots the real VIN");
ok(!JSON.stringify(S.settings[0].value).includes("weekly_rate"), "rates and finance are absent");

const custom = await mod.createVehicleSharePackage({ data: { vehicleId: V, mode: "custom", mediaIds: [C, D, D] }, context });
ok(custom.ok && custom.package.photoCount === 2 && !custom.package.includeDetails, "manual package deduplicates any originals/approved retouches and contains no insurance details");
const refused = await mod.createVehicleSharePackage({ data: { vehicleId: V, mode: "custom", mediaIds: [E] }, context });
ok(!refused.ok, "an unapproved retouch cannot be shared manually");
const enhanced = await mod.createVehicleSharePackage({ data: { vehicleId: V, mode: "enhanced", mediaIds: [A, B, E] }, context });
ok(enhanced.ok && enhanced.package.photoCount === 1 && !enhanced.package.includeDetails, "one-click AI package ignores client ids and contains only approved enhancements without vehicle details");
ok(S.settings[2].value.mediaIds.join(",") === D && S.settings[2].value.details === null, "the stored AI package excludes originals, pending enhancements and insurance data");
const approved = S.media;
S.media = S.media.filter((row) => row.id !== D);
const noEnhanced = await mod.createVehicleSharePackage({ data: { vehicleId: V, mode: "enhanced", mediaIds: [A] }, context });
ok(!noEnhanced.ok && S.settings.length === 3, "the AI package fails closed when no approved enhancement exists");
S.media = approved;

const publicView = await mod.getSharedVehiclePackage({ data: { token: created.token } });
ok(publicView?.photoIds.join(",") === `${A},${B}` && publicView.details.sections.length === 2, "a valid token returns only its reviewed photos and insurance snapshot");
ok(await mod.getSharedVehiclePackage({ data: { token: "x".repeat(43) } }) === null, "an unknown token returns no vehicle data");

const sentEmail = await mod.sendVehicleSharePackage({ data: { packageId: created.id, token: created.token, channel: "email", recipient: "renter@example.com", message: "For your insurance" }, context });
ok(sentEmail.ok && S.emails.length === 1 && S.emails[0].track.workflow === "vehicle_share", "email uses the canonical sender and the reviewed package");
ok(S.emails[0].html.includes(created.url) && S.emails[0].html.includes("For your insurance"), "the email contains the secure link and staff note");
ok(!S.emails[0].html.includes("localhost"), "an email sent from Preview never contains a localhost recipient link");
const sentSms = await mod.sendVehicleSharePackage({ data: { packageId: created.id, token: created.token, channel: "sms", recipient: "(555) 555-1234" }, context });
ok(sentSms.ok && S.sms.length === 1 && S.sms[0].requireConsent === false && S.sms[0].vehicleId === V, "transactional text uses the canonical sender, vehicle attribution and opt-out enforcement");
ok(S.sms[0].body.includes(created.url) && S.sms[0].body.includes("STOP"), "the text contains the private link and opt-out wording");
const beforeWrong = S.emails.length + S.sms.length;
const wrong = await mod.sendVehicleSharePackage({ data: { packageId: created.id, token: "x".repeat(43), channel: "email", recipient: "renter@example.com" }, context });
ok(!wrong.ok && S.emails.length + S.sms.length === beforeWrong, "a token/package mismatch cannot trigger a provider send");
ok(!JSON.stringify(S.audit).includes("renter@example.com") && JSON.stringify(S.audit).includes("r•••@example.com"), "audit attribution masks recipient contact details");

S.settings[0].value.expiresAt = "2026-01-01T00:00:00.000Z";
ok(await mod.getSharedVehiclePackage({ data: { token: created.token } }) === null, "expiry immediately closes recipient access");

reset(); S.tier = "coordinator";
let forbidden = false;
try { await mod.getVehicleShareOptions({ data: { vehicleId: V }, context }); } catch (error) { forbidden = error.message === "Forbidden"; }
ok(forbidden && S.settings.length === 0 && S.emails.length === 0 && S.sms.length === 0, "Coordinators are refused server-side without packages or sends");

reset();
const routePackage = await mod.createVehicleSharePackage({ data: { vehicleId: V, mode: "insurance", mediaIds: [] }, context });
const routeToken = routePackage.package.token;
const validImage = await mediaRoute({ params: { token: routeToken, mediaId: A } });
ok(validImage.status === 200 && validImage.headers.get("Cache-Control") === "private, no-store" && await validImage.text() === "SYNTHETIC_IMAGE", "a valid token streams only a selected private image without caching");
const beforeUnselected = S.downloads.length;
const unselected = await mediaRoute({ params: { token: routeToken, mediaId: C } });
ok(unselected.status === 404 && S.downloads.length === beforeUnselected, "an unselected vehicle photo is never downloaded");
S.settings[0].value.mediaIds = [E];
const pendingImage = await mediaRoute({ params: { token: routeToken, mediaId: E } });
ok(pendingImage.status === 404 && S.downloads.length === beforeUnselected, "an unapproved derivative is refused even with a valid package token");
S.settings[0].value.mediaIds = [A]; S.media.find((row) => row.id === A).vehicle_id = "00000000-0000-4000-8000-000000000099";
const crossVehicle = await mediaRoute({ params: { token: routeToken, mediaId: A } });
ok(crossVehicle.status === 404 && S.downloads.length === beforeUnselected, "package membership cannot bypass the same-vehicle check");
S.media.find((row) => row.id === A).vehicle_id = V; S.settings[0].value.expiresAt = "2026-01-01T00:00:00.000Z";
const expiredImage = await mediaRoute({ params: { token: routeToken, mediaId: A } });
ok(expiredImage.status === 404 && S.downloads.length === beforeUnselected, "expired tokens cannot retrieve private photo bytes");

rmSync(OUT, { recursive: true, force: true });
console.log(`${checks} vehicle share function checks passed`);
