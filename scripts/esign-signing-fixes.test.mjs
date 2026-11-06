/**
 * PR 3 — eSign signing fixes. Unit and wiring checks; the end-to-end proofs
 * (sign on a real PostgREST, metadata preserved through signing, initials
 * stored in capitals) run on the disposable harness in esign-engine.test.ts,
 * section 7. Contract dates and the midnight-UTC fingerprint are in
 * contract-date-format.test.mjs.
 *
 *   1. A voided or draft agreement never shows "Review & Sign" / "Awaiting
 *      Your Signature" in the driver portal.
 *   2. A signed (or otherwise dead) signing link shows one safe message that
 *      points to the portal, and the server answers it exactly as it answers
 *      a random token: no existence leak, no new credential.
 *   3. Initials are capitals in the VALUE, not in CSS, and the server
 *      normalises the mark where it accepts it.
 *   4. issueAgreement persists template evidence in agreements.metadata.
 *
 * Fake PostgREST, no database, no network.
 * Run: node scripts/esign-signing-fixes.test.mjs   (npm run test:esign-fixes)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".esign-fixes-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
globalThis.fetch = async (u) => { throw new Error(`esign-signing-fixes: network refused (${u})`); };
delete process.env.RESEND_API_KEY;

writeFileSync(`${OUT}/stub-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};
export const createMiddleware = () => ({ server: () => ({}), client: () => ({}) });
`);
writeFileSync(`${OUT}/stub-start-server.js`, `
export const getRequest = () => ({ headers: new Map() });
export const getRequestHeader = () => null;
`);
writeFileSync(`${OUT}/stub-auth.js`, `export const requireSupabaseAuth = {};`);
writeFileSync(`${OUT}/stub-sb.js`, `
export const supabaseAdmin = { from: (n) => globalThis.__fx.from(n) };
export const supabase = supabaseAdmin;
export default supabaseAdmin;
`);
writeFileSync(`${OUT}/stub-roles.js`, `
export const requireTier = async () => ({ tier: "owner", userId: "owner" });
export const requireStaff = requireTier;
export const requireManager = requireTier;
export const requireOwner = requireTier;
export const getActor = async () => null;
`);
writeFileSync(`${OUT}/stub-email.js`, `
export const sendAgreementEmail = async () => ({ ok: false, error: "capture-only" });
export const sendAgreementSignedEmail = async () => {};
export const sendAgreementSignedOpsEmail = async () => {};
`);
writeFileSync(`${OUT}/stub-sms.js`, `export const sendSms = async () => ({ ok: false, skipped: true, reason: "capture_only" });`);

const bundle = (src, out) => execFileSync("npx", [
  "esbuild", src, "--bundle", "--platform=node", "--format=esm",
  `--outfile=${OUT}/${out}`, "--alias:@=./src",
  `--alias:@tanstack/react-start=./${OUT}/stub-start.js`,
  `--alias:@tanstack/react-start/server=./${OUT}/stub-start-server.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub-auth.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub-sb.js`,
  `--alias:@/lib/roles.server=./${OUT}/stub-roles.js`,
  `--alias:@/lib/email.server=./${OUT}/stub-email.js`,
  `--alias:@/lib/sms.server=./${OUT}/stub-sms.js`,
], { stdio: ["ignore", "ignore", "inherit"] });

bundle("src/lib/portal-agreement-state.ts", "state.mjs");
bundle("src/lib/portal-notices.ts", "notices.mjs");
bundle("src/lib/portal-pickup-checklist.ts", "pickup.mjs");
bundle("src/lib/signature-adoption.ts", "adoption.mjs");
bundle("src/lib/agreements.functions.ts", "ag.mjs");
const S = await import(`../${OUT}/state.mjs`);
const N = await import(`../${OUT}/notices.mjs`);
const PK = await import(`../${OUT}/pickup.mjs`);
const AD = await import(`../${OUT}/adoption.mjs`);
const AG = await import(`../${OUT}/ag.mjs`);

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

function fakeDb(tables) {
  const inserted = [];
  const from = (name) => {
    const filters = [];
    let cap; let op = "select"; let payload = null;
    const rows = () => {
      const all = (tables[name] ?? []).filter((r) => filters.every((f) => f(r)));
      return cap == null ? all : all.slice(0, cap);
    };
    const result = () => {
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]).map((r, i) => ({ id: r.id ?? `00000000-0000-4000-8000-${String(inserted.length + i + 1).padStart(12, "0")}`, ...r }));
        (tables[name] ??= []).push(...list);
        inserted.push(...list.map((r) => ({ table: name, row: r })));
        return list;
      }
      if (op === "update") { const hit = rows(); for (const r of hit) Object.assign(r, payload); return hit; }
      return rows();
    };
    const api = {
      select: () => api,
      insert: (v) => ((op = "insert"), (payload = v), api),
      update: (v) => ((op = "update"), (payload = v), api),
      eq: (c, v) => (filters.push((r) => r[c] === v), api),
      neq: (c, v) => (filters.push((r) => r[c] !== v), api),
      in: (c, v) => (filters.push((r) => v.includes(r[c])), api),
      is: (c, v) => (filters.push((r) => (r[c] ?? null) === v), api),
      order: () => api,
      limit: (n) => ((cap = n), api),
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      single: async () => ({ data: result()[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve({ data: result(), error: null }).then(res, rej),
    };
    return api;
  };
  return { from, inserted, tables, rpc: async () => ({ data: null, error: null }) };
}

// ===================================================== 1. portal states
console.log("\n1. voided and draft agreements never ask the driver to sign");
const cases = [
  [{ status: "sent", signed_at: null }, "awaiting_signature"],
  [{ status: "viewed", signed_at: null }, "awaiting_signature"],
  [{ status: "signing", signed_at: null }, "signing"],
  [{ status: "signed", signed_at: "2026-10-01T00:00:00Z" }, "signed"],
  [{ status: "voided", signed_at: null }, "cancelled"],
  [{ status: "draft", signed_at: null }, "hidden"],
  [{ status: null, signed_at: null }, "hidden"],
  [{ status: "VOIDED", signed_at: null }, "cancelled"],
];
for (const [a, want] of cases) ok(S.portalAgreementState(a) === want, `${JSON.stringify(a.status)} -> ${S.portalAgreementState(a)} (want ${want})`);
ok(!S.awaitsDriverSignature({ status: "voided", signed_at: null }), "a voided agreement does not await a signature");
ok(!S.awaitsDriverSignature({ status: "draft", signed_at: null }), "a draft does not await a signature");
ok(S.portalAgreementStatusLabel("cancelled") === "Cancelled · No Action Needed", "voided rows get a neutral label");
ok(!/sign/i.test(S.portalAgreementStatusLabel("cancelled")), "  that asks for no signature");
for (const st of ["awaiting_signature", "signing", "signed", "cancelled"]) {
  const l = S.portalAgreementStatusLabel(st);
  ok(l.split(/\s+/).filter((w) => /^[a-z]/.test(w)).length === 0, `"${l}" is Title Case in the string`);
}

console.log("\n   the portal list is wired to it");
{
  const portal = readFileSync("src/routes/portal.tsx", "utf8");
  const view = portal.slice(portal.indexOf("function AgreementsView()"), portal.indexOf("function IssuesView()"));
  ok(view.length > 200, "found AgreementsView");
  ok(/portalAgreementState\(a\)/.test(view) && /\.filter\(\(a\) => a\.state !== "hidden"\)/.test(view), "rows are classified and drafts filtered out");
  ok(!/"Awaiting your signature"/.test(view), "the old signed_at-only label is gone");
  ok(/a\.state === "signed" \|\| a\.state === "awaiting_signature" \? \(\s*<button/.test(view), "the View / Review & Sign button renders only for signed or awaiting rows");
  ok(/\{a\.state === "awaiting_signature" \? \(\s*<div className="mt-4">\s*<SigningPanel/.test(view), "the SigningPanel mounts only for an awaiting row");
  ok(!/a\.status !== "signed"/.test(view), "nothing offers signing merely because a row is not signed");
}

console.log("\n   portal notices and the pickup checklist agree");
{
  const base = { application: null, applicationReadable: false, documents: null, rentals: null, payments: null };
  const has = (agreements) => N.buildPortalNotices({ ...base, agreements }, new Date("2026-10-20T12:00:00Z")).some((n) => n.id === "agreement-unsigned");
  ok(has([{ status: "sent", signed_at: null }]), "a sent agreement raises Awaiting your signature");
  ok(!has([{ status: "voided", signed_at: null }]), "a voided one does not");
  ok(!has([{ status: "draft", signed_at: null }]), "a draft does not");
  const pick = (agreements) => PK.pickupChecklist({ applicationStatus: "approved", hasActiveRental: false, documents: [], licensePhotoPath: null, licenseExpiration: null, insuranceDocPath: null, insuranceExpiresOn: null, agreements, rentals: [], payments: [], now: Date.parse("2026-10-20T12:00:00Z") }).items.some((i) => i.id === "agreement");
  ok(pick([{ status: "viewed", signedAt: null }]), "pickup checklist lists a viewed agreement");
  ok(!pick([{ status: "voided", signedAt: null }]) && !pick([{ status: "draft", signedAt: null }]), "  but not a voided or draft one");
}

// ============================================== 2. dead signing links
console.log("\n2. a signed link shows the safe message, and leaks nothing");
{
  const sha = (t) => createHash("sha256").update(t).digest("hex");
  const live = "a".repeat(64), voided = "b".repeat(64), signed = "c".repeat(64);
  const db = fakeDb({
    agreements: [
      { id: "ag-live", title: "Vehicle Rental Agreement", body: "BODY", status: "sent", token_hash: sha(live), token_expires_at: "2099-01-01T00:00:00Z", merge_data: {}, company_signer_name: "X", viewed_at: null },
      { id: "ag-void", title: "Vehicle Rental Agreement", body: "BODY", status: "voided", token_hash: sha(voided), token_expires_at: "2099-01-01T00:00:00Z", merge_data: {}, company_signer_name: "X" },
      // Signing clears token_hash (esign.server.ts); the row is still there.
      { id: "ag-signed", title: "Vehicle Rental Agreement", body: "BODY", status: "signed", token_hash: null, signed_at: "2026-10-01T00:00:00Z", merge_data: {}, company_signer_name: "X" },
    ],
    esign_recipients: [], audit_log: [],
  });
  globalThis.__fx = db;
  const view = (token) => AG.getAgreementByToken({ data: { token } });
  const signedView = await view(signed);
  const randomView = await view("d".repeat(64));
  const voidView = await view(voided);
  ok(signedView === null, "a signed agreement's old link resolves to null");
  ok(randomView === null && voidView === null, "  exactly like a random token and a voided link");
  ok(JSON.stringify(signedView) === JSON.stringify(randomView), "  so the anonymous caller cannot tell them apart");
  ok((await view(live))?.id === "ag-live", "a live link still opens its agreement");

  const fn = readFileSync("src/lib/agreements.functions.ts", "utf8");
  const handler = fn.slice(fn.indexOf("export const getAgreementByToken"), fn.indexOf("/** Server-side truth"));
  ok((handler.match(/\.eq\(/g) ?? []).length >= 1 && /\.eq\("token_hash", hash\)/.test(handler), "the token is looked up by its hash only");
  ok(!/signed_at\b[^\n]*\.eq\(|\.is\("token_hash"|\.eq\("id"[^\n]*data\.token/.test(handler.split("if (!ag) return null;")[0]),
    "  with no fallback lookup that could turn a cleared link back into a credential");

  const page = readFileSync("src/routes/sign.$token.tsx", "utf8");
  const nullBranch = page.slice(page.indexOf(") : !agreement ? ("), page.indexOf(") : agreement.expired && !done ? ("));
  ok(nullBranch.length > 100, "found the page's no-agreement state");
  ok(/This agreement has already been signed, or the link has expired or been replaced\./.test(nullBranch), "it says the agreement may already be signed or the link expired");
  ok(/sign in to your driver portal to view your signed copy/.test(nullBranch) && /href="\/portal"/.test(nullBranch), "  and points to the portal sign-in");
  ok(/>\s*Sign In to Your Portal\s*</.test(nullBranch) && />This Link Is No Longer Active</.test(nullBranch), "  with Title Case heading and button text");
  ok(!/Isn't Valid/.test(page), "the old \"Link Isn't Valid\" dead end is gone");
  ok(!/agreement\.|token/.test(strip(nullBranch).replace(") : !agreement ? (", "")), "  and the message uses no server detail, only the fact that nothing opened");
}

// =================================================== 3. initials
console.log("\n3. initials are capitals in the value, not in CSS");
{
  const typed = (text) => ({ method: "typed", text, style: "script1" });
  const parsed = AD.AdoptionSchema.parse({ signature: typed("Dana Reyes"), initials: typed("dr"), acks: [] });
  ok(parsed.initials.text === "DR", `typed "dr" is accepted as "DR" (${parsed.initials.text})`);
  ok(parsed.signature.text === "Dana Reyes", "the signature keeps its case");
  const mixed = AD.AdoptionSchema.parse({ signature: typed("Dana Reyes"), initials: typed("d.r-x"), acks: [] });
  ok(mixed.initials.text === "D.R-X", `punctuation is kept (${mixed.initials.text})`);
  const drawn = { method: "drawn", aspect: 1.5, strokes: [[[0.1, 0.1], [0.2, 0.2], [0.3, 0.3], [0.4, 0.4]]] };
  ok(isDeepStrictEqual(AD.AdoptionSchema.parse({ signature: typed("Dana Reyes"), initials: drawn, acks: [] }).initials, drawn), "a drawn mark is untouched");
  ok(AD.adoptionProblems("plain body", parsed, "Dana Reyes").length === 0, "the normalised adoption passes the existing validation");

  // The server functions validate with this schema, so the value they hand the
  // engine (and the engine hashes and stores) is the capitalised one.
  for (const [name, input] of [
    ["signAgreement", { token: "e".repeat(64), signerName: "Dana Reyes", agree: true, adoption: { signature: typed("Dana Reyes"), initials: typed("dr"), acks: [] } }],
    ["signMyAgreement", { agreementId: "11111111-1111-4111-8111-111111111111", signerName: "Dana Reyes", agree: true, adoption: { signature: typed("Dana Reyes"), initials: typed("dr"), acks: [] } }],
  ]) {
    const out = AG[name]._validate(input);
    ok(out.adoption.initials.text === "DR", `${name} accepts the mark as "DR" (${out.adoption.initials.text})`);
  }
  const panel = readFileSync("src/components/esign/SigningPanel.tsx", "utf8");
  const input = panel.slice(panel.indexOf("<input value={initialsText}"), panel.indexOf("<MarkPicker kind=\"initials\""));
  ok(/setInitialsText\(normalizeInitialsText\(/.test(input), "the initials field stores the capitalised value as it is typed");
  ok(!/\buppercase\b/.test(input) && !/text-transform/.test(input), "  with no CSS text-transform on it");
  ok(!/className="[^"]*\buppercase\b/.test(panel), "no uppercase class anywhere in the signing panel");
}

// ============================================ 4. template evidence
console.log("\n4. issueAgreement persists template evidence in agreements.metadata");
{
  const meta = { id: null, key: "insurance_required", name: "X", version: 3, approvalStatus: "approved", label: "Approved v3", effectiveDate: null, approvedAt: null, versioningActive: true, schemaReady: true };
  const ev = AG.templateEvidence(meta, "f".repeat(64), true);
  ok(JSON.stringify(Object.keys(ev).sort()) === JSON.stringify(["preview_fingerprint", "template_key", "template_label", "template_source", "template_version"]),
    `exactly the five evidence keys (${Object.keys(ev).join(", ")})`);
  ok(ev.template_key === "insurance_required" && ev.template_version === 3 && ev.template_label === "Approved v3" && ev.template_source === "library", "a library family records key, version, label and source");
  const legacy = AG.templateEvidence({ ...meta, key: undefined, id: null, version: 1, label: "Draft v1 — Legal Review Required" }, "f".repeat(64), false);
  ok(legacy.template_key === null && legacy.template_source === "built_in_default", "the in-code baseline records a null key and its source");
  ok(AG.templateEvidence({ ...meta, key: undefined, id: "t1" }, "f".repeat(64), false).template_source === "saved_template", "a saved agreement_templates row records saved_template");

  const APP_ID = "11111111-1111-4111-8111-111111111111", VEH = "22222222-2222-4222-8222-222222222222";
  const db = fakeDb({
    applications: [{ id: APP_ID, full_name: "Dana Reyes", email: "dana@example.invalid", phone: "813-555-0142", address: "1 A St", city: "Tampa", state: "FL", zip: "33602",
      license_number: "R1", license_state: "FL", license_expiration: "2030-04-30", vehicle_id: VEH, weekly_rent: 329, deposit_amount: 0, market_id: null, dob: "1991-07-02",
      contract_start_date: "2026-11-01", contract_end_date: "2027-04-11" }],
    vehicles: [{ id: VEH, year: 2023, make: "Toyota", model: "Camry", color: "Silver", vin: "1HGCM82633A004352", weekly_rate: 329, deposit: 0 }],
    rentals: [], markets: [], app_settings: [], agreement_templates: [], agreements: [], esign_recipients: [], audit_log: [],
  });
  globalThis.__fx = db;
  const p = await AG.previewAgreement({ data: { applicationId: APP_ID }, context: { userId: "owner" } });
  ok(p.canSend === true, "the built-in baseline previews as sendable");
  await AG.issueAgreement(db, APP_ID, { fingerprint: p.fingerprint, companyAck: true });
  const row = db.inserted.find((x) => x.table === "agreements")?.row;
  ok(row?.metadata && row.metadata.preview_fingerprint === p.fingerprint, "the inserted row carries the reviewed fingerprint");
  ok(row?.metadata?.template_label === p.template.label && row.metadata.template_version === p.template.version, `  and the label and version staff saw (${row?.metadata?.template_label} v${row?.metadata?.template_version})`);
  ok(row?.metadata?.template_source === "built_in_default" && row.metadata.template_key === null, "  and where the wording came from");
  ok(row?.template_id === null, "template_id stays as it was (null for the baseline)");
  ok(!("signature" in (row?.metadata ?? {})), "no signature evidence is invented at issue time");

  // Signing merges, never replaces: esign.server.ts (pinned) reads the current
  // metadata and spreads it under metadata.signature. Proved on the harness.
  const esign = readFileSync("src/lib/esign.server.ts", "utf8");
  ok(/metadata = \{ \.\.\.\(\(cur\?\.metadata as any\) \?\? \{\}\), signature:/.test(esign), "the engine's signing write spreads the existing metadata");
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall eSign signing-fix checks pass");
process.exit(fail ? 1 : 0);
