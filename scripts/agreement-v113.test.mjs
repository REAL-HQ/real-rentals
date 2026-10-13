/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   v1.13 IS A NEW VERSION OF THE no_insurance FAMILY. v1.10 AND v1.10.2 ARE
 *   BYTE-IDENTICAL TO WHAT THEY WERE.
 *   THE MINIMUM TERM IS ONE STAFF-CHOSEN NUMBER, AND EVERY PLACE THE CONTRACT
 *   STATES IT SAYS THE SAME THING — INCLUDING THE END DATE IT COMPUTES.
 *   THE MARKETING PANEL IS NOT IN THE AGREEMENT.
 *   CHANGING A TERM CHANGES THE FINGERPRINT.
 *   v1.13 CANNOT BE SENT.
 *
 * The failure mode this is built against. v1.13's PDF hardcodes "four (4)
 * consecutive weeks" and prints the term in six places — the Key Rental Terms
 * band, the Rental & Vehicle Information row, Section 1, the Early Return
 * rule, the Fee Schedule row and an acknowledgment — and computes a
 * minimum-term end date from it. Six independently-typed strings would drift,
 * and a contract that says "four (4)" in Section 1 and "6-week minimum" in
 * the Fee Schedule is ambiguous on its single most important number. So all
 * six read ONE template term, and these tests assert they move together.
 *
 * The other half is the money. Changing the term changes what an early return
 * costs, so the term has to be inside the preview fingerprint: a Send
 * approved against a 4-week preview must be refused once somebody makes it 6.
 *
 * Pure functions and real modules. No database, no network, nothing sent.
 *
 * Run: node scripts/agreement-v113.test.mjs   (npm run test:v113)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".v113-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const build = (entry, out) =>
  execFileSync("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=esm",
    `--outfile=${OUT}/${out}`, "--alias:@=./src"], { stdio: ["ignore", "ignore", "inherit"] });

build("src/lib/agreement-library.ts", "lib.mjs");
build("src/lib/agreement-builder.ts", "builder.mjs");
build("src/lib/agreement-prep.ts", "prep.mjs");
build("src/lib/agreement-layout.ts", "layout.mjs");
build("src/lib/agreement-merge.ts", "merge.mjs");
build("src/lib/agreement-dates.ts", "dates.mjs");
// agreements.functions.ts is a server-function module; these stand in for the
// framework and the client so its exported pure parts can be driven directly.
writeFileSync(`${OUT}/stub-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};
`);
writeFileSync(`${OUT}/stub-start-server.js`, `
export const getRequest = () => ({ headers: new Map() });
export const getRequestHeader = () => null;
`);
writeFileSync(`${OUT}/stub-auth.js`, `export const requireSupabaseAuth = {};`);
writeFileSync(`${OUT}/stub-sb.js`, `
export const supabaseAdmin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) };
export const supabase = supabaseAdmin;
export default supabaseAdmin;
`);
execFileSync("npx", ["esbuild", "src/lib/agreements.functions.ts", "--bundle", "--platform=node",
  "--format=esm", `--outfile=${OUT}/fns.mjs`, "--alias:@=./src",
  `--alias:@tanstack/react-start/server=./${OUT}/stub-start-server.js`,
  `--alias:@tanstack/react-start=./${OUT}/stub-start.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub-auth.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub-sb.js`,
], { stdio: ["ignore", "ignore", "inherit"] });

const L = await import(`../${OUT}/lib.mjs`);
const B = await import(`../${OUT}/builder.mjs`);
const P = await import(`../${OUT}/prep.mjs`);
const LAY = await import(`../${OUT}/layout.mjs`);
const M = await import(`../${OUT}/merge.mjs`);
const D = await import(`../${OUT}/dates.mjs`);

const sha = async (s) => {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
};

/** A rendered v1.13 body for a chosen minimum term, the way prepareAgreement composes it. */
function renderV113(weeks, startIso = "2026-10-11", extra = {}) {
  const fam = L.libraryTemplate("no_insurance");
  const v = L.libraryVersion("no_insurance", "1.13");
  const terms = B.readTerms(v.body);
  const r = P.applyPrep(
    { ...P.EMPTY_PREP, minTerm: weeks == null ? undefined : { weeks } },
    { startIso, depositClause: String(terms.deposit_clause ?? "") },
  );
  const line = fam.reservationStyle === "amount" ? "None" : r.reservationLine;
  const tplBody = B.writeTerms(B.stripTerms(v.body), { ...terms, ...r.termOverrides, reservation_line: line });
  const resolvedTerms = B.readTerms(tplBody);
  const endIso = D.minTermEndIso(startIso, D.minTermWeeks(resolvedTerms.min_term_weeks));
  const data = {
    driver_name: "Dana Rivers", driver_email: "dana@example.com", driver_phone: "8135550111",
    driver_address: "1 Bay St, Tampa FL", license_number: "D123", license_state: "FL",
    driver_dob: "01-02-1990", vehicle: "2019 Toyota Camry", vehicle_color: "Grey",
    vehicle_vin: "1HGCM82633A004352", license_plate: "ABC1234 / FL",
    weekly_rate: "$350.00", start_date: D.fmtContractDate(startIso),
    min_term_end: endIso ? D.fmtContractDate(endIso) : "",
    agreement_number: "RRA-000001", card_on_file: "Visa ****4242",
    company_name: "REAL RENTALS LLC", company_address: "Tampa, FL",
    company_phone: "(888) 833-8280", company_email: "team@drivereal.com",
    insurance_carrier: "None on file", insurance_policy: "None on file",
    ...r.merge, ...extra,
  };
  return { body: M.renderTemplate(tplBody, data), tplBody, blockers: r.blockers, endIso, terms: resolvedTerms };
}

// ============================================ the family, and what it preserves
console.log("\nv1.13 is a new version of no_insurance, not a third family");
ok(L.LIBRARY.length === 2, `two families, still (${L.LIBRARY.length})`);
ok(L.LIBRARY.map((t) => t.key).join(",") === "no_insurance,insurance_required", "the same two keys");
const ni = L.libraryTemplate("no_insurance");
ok(ni.versions.map((v) => v.displayVersion).join(",") === "1.10,1.13", `no_insurance has 1.10 then 1.13 (${ni.versions.map((v) => v.displayVersion).join(",")})`);
ok(ni.displayVersion === "1.13", "the family's current draft is v1.13");
ok(ni.insuranceRequired === false, "and it is still the no-insurance family");
const ir = L.libraryTemplate("insurance_required");
ok(ir.versions.length === 1 && ir.displayVersion === "1.10.2", "insurance_required is untouched at v1.10.2");

console.log("\nthe older versions are byte-identical to what they were");
// PINNED HASHES, not `source === V110_SOURCE`. That comparison reads the same
// constant on both sides, so it passes however the constant is edited — it
// proves the wiring and nothing about preservation. These are the SHA-256s of
// v1.10 and v1.10.2 as they stood when v1.13 was added; any edit to either
// source or its term defaults fails here, which is the whole point.
const PINNED = {
  "V110_SOURCE": "f6f18dfd14b09960076a2f0601e933aa77518900520a9fc20e14cfb7ac705a52",
  "V1102_INS_SOURCE": "530cbf03bc1f5bd8a7b46fecb0f2a48592f9fb77330362e4c8bd30cb1a82a18d",
  "no_insurance v1.10 body": "ec3c448babf25c5c01bfa82cddd6da15d724092c41629f4359cd9959ff42209a",
  "insurance_required v1.10.2 body": "54dc7abde999d883e7fd9520c24535dd773110605172a8e44aaefce6dc2c287c",
};
for (const [what, want] of Object.entries(PINNED)) {
  const text = what === "V110_SOURCE" ? L.V110_SOURCE
    : what === "V1102_INS_SOURCE" ? L.V1102_INS_SOURCE
    : what.startsWith("no_insurance") ? L.libraryVersion("no_insurance", "1.10").body
    : L.libraryVersion("insurance_required", "1.10.2").body;
  const got = await sha(text);
  ok(got === want, `${what} is unchanged (${got.slice(0, 12)})`);
}
ok(L.libraryVersion("no_insurance", "1.10").source === L.V110_SOURCE, "v1.10 is still wired to V110_SOURCE");
ok(L.libraryVersion("insurance_required", "1.10.2").source === L.V1102_INS_SOURCE, "v1.10.2 is still wired to V1102_INS_SOURCE");
ok(L.V110_SOURCE.includes("#- Vehicle Rental Agreement (v1.10)"), "v1.10 still titles itself v1.10");
ok(!L.V110_SOURCE.includes("v1.13") && !L.V1102_INS_SOURCE.includes("v1.13"), "neither older source mentions v1.13");
ok(L.V110_SOURCE.includes("| Service Area / Mileage Limit |"), "v1.10 keeps its Service Area / Mileage Limit row");
ok(L.V113_SOURCE.includes("#- Vehicle Rental Agreement (v1.13)"), "v1.13 titles itself v1.13");

// ================================================= the marketing panel
console.log("\nthe marketing panel is not in the agreement");
const MARKETING = ["What's Included in Your Rental", "Drive for Any Platform", "Repair Swaps",
  "Flexible Payments", "Maintenance Included", "Uber", "Lyft", "DoorDash", "Instacart"];
for (const phrase of MARKETING)
  ok(!L.V113_SOURCE.includes(phrase), `v1.13 source does not contain "${phrase}"`);
{
  const { body } = renderV113(4);
  for (const phrase of MARKETING) ok(!body.includes(phrase), `the rendered agreement does not contain "${phrase}"`);
  ok(!LAY.layoutToText(body).includes("Drive for Any Platform"), "nor does the signing page's text");
}
console.log("\nbut the content is preserved, unpublished");
{
  const md = readFileSync("docs/marketing/v113-whats-included.md", "utf8");
  ok(/NOT PUBLISHED/i.test(md), "the file says it is not published");
  for (const phrase of ["Unlimited Miles", "Maintenance Included", "No Security Deposit",
    "Drive for Any Platform", "Repair Swaps", "Flexible Payments"])
    ok(md.includes(phrase), `  it keeps the "${phrase}" card`);
  ok(/insurer/i.test(md) && /platform/i.test(md), "and records that the claims need insurer/platform verification");
}

// ================================================= the dynamic minimum term
console.log("\nthe default is four weeks");
{
  const { terms, body, endIso } = renderV113(undefined);
  ok(terms.min_term_weeks === "4", `the template's own term is 4 (${terms.min_term_weeks})`);
  ok(terms.min_term_words === "four (4)", `and its words are "four (4)" (${terms.min_term_words})`);
  ok(endIso === "2026-11-08", `2026-10-11 + 4w = ${endIso}`);
  ok(body.includes("minimum term of four (4) consecutive weeks"), "Section 1 says four (4) consecutive weeks");
  ok(P.EMPTY_PREP.minTerm.weeks === 4, "and the dialog's starting value is 4");
}

console.log("\nstaff can select another term, and every statement of it follows");
const WORDS = { 1: "one (1)", 4: "four (4)", 6: "six (6)", 13: "thirteen (13)", 26: "twenty-six (26)", 52: "fifty-two (52)" };
for (const weeks of [1, 4, 6, 13, 26, 52]) {
  const { body, endIso } = renderV113(weeks);
  const w = WORDS[weeks];
  ok(P.minTermWords(weeks) === w, `${weeks} -> "${w}"`);
  // 1. Section 1
  ok(body.includes(`minimum term of ${w} consecutive weeks`), `  ${weeks}w: Section 1`);
  // 2. Key Rental Terms band
  ok(body.includes(`End Date (${weeks}-Week Minimum)`), `  ${weeks}w: Key Rental Terms band`);
  // 3. Rental & Vehicle Information row
  ok(body.includes(`Minimum Term Ends (${weeks} Weeks)`), `  ${weeks}w: Rental & Vehicle Information row`);
  // 4. Fee Schedule
  ok(body.includes(`Early return (before ${weeks}-week minimum)`), `  ${weeks}w: Fee Schedule row`);
  // 5. Acknowledgment
  ok(body.includes(`My rental has a ${weeks}-week minimum term.`), `  ${weeks}w: acknowledgment`);
  // 6. The computed end date, printed MM-DD-YYYY
  const want = D.minTermEndIso("2026-10-11", weeks);
  ok(endIso === want, `  ${weeks}w: end date ${endIso}`);
  ok(body.includes(D.fmtContractDate(want)), `  ${weeks}w: the end date is printed as ${D.fmtContractDate(want)}`);
  // No other week-count may appear anywhere in the body.
  const strays = [...body.matchAll(/(\d+)-[Ww]eek minimum/g)].map((m) => Number(m[1])).filter((n) => n !== weeks);
  ok(strays.length === 0, `  ${weeks}w: no stray week count in the body (${strays.join(",") || "none"})`);
}

console.log("\nprepareAgreement is the one place that applies the chosen term");
{
  // renderV113 above composes the body the way prepareAgreement does, which
  // proves applyPrep and the template — but NOT that the server actually
  // wires them together. Without this, deleting the override from
  // agreements.functions.ts leaves every test above green.
  const fns = readFileSync("src/lib/agreements.functions.ts", "utf8");
  const calls = [...fns.matchAll(/writeTerms\(stripTerms\(tpl\.body\), \{([^}]*)\}\)/g)];
  ok(calls.length === 1, `exactly one place rewrites the template's terms (${calls.length})`);
  ok(/\.\.\.r\.termOverrides/.test(calls[0]?.[1] ?? ""), "and it spreads the staff term overrides into them");
  ok(/\.\.\.terms/.test(calls[0]?.[1] ?? ""), "on top of the template's own values");
  // And the end-date calculation reads the term from the body, so the
  // override reaches it. Driven through the real exported function.
  const T = await import(`../${OUT}/fns.mjs`);
  for (const weeks of [4, 6, 26]) {
    const body = renderV113(weeks).tplBody;
    const data = {}, blockers = [];
    T.templateFieldBlockers(body, data, blockers, null, null, "2026-10-11");
    const want = D.fmtContractDate(D.minTermEndIso("2026-10-11", weeks));
    ok(data.min_term_end === want, `  ${weeks}w: templateFieldBlockers computes ${data.min_term_end} (want ${want})`);
  }
}

console.log("\nthe minimum term and the payment period are different numbers");
{
  // "Monthly" means a four-week / 28-day payment period. Making it follow the
  // minimum term would silently change what a monthly payment buys.
  const { body } = renderV113(6);
  ok(body.includes("each 4-week period and cover four weeks of rent"), "monthly billing stays a 4-week period at a 6-week term");
  ok(body.includes("every 28 days for monthly"), "and Autopay stays 28 days");
  ok(body.includes("paid in advance weekly or every 4 weeks (monthly)"), "as does the Fee Schedule's Rent row");
}

console.log("\nthe early-return rule keeps its financial meaning at any term");
for (const weeks of [1, 4, 6, 26]) {
  const { body } = renderV113(weeks);
  ok(body.includes("you remain responsible for the weekly rate for the rest of the minimum term"),
    `  ${weeks}w: still the weekly rate for the rest of the term`);
  ok(body.includes("we will credit you for each week it is re-rented"), `  ${weeks}w: still credited when re-rented`);
  ok(body.includes("Remaining weeks of minimum term, charged weekly; credited for any week the vehicle is re-rented"),
    `  ${weeks}w: Fee Schedule states the same rule`);
}

console.log("\nan unusable term is refused, not rounded");
for (const weeks of [0, -1, 53, 4.5]) {
  const { blockers } = renderV113(weeks);
  ok(blockers.some((b) => b.field === "min_term_weeks"), `${weeks} weeks is a blocker`);
}
ok(P.minTermWords(0) === "" && P.minTermWords(53) === "", "and no words are produced for one");

// ================================================= dates
console.log("\ncontract dates stay MM-DD-YYYY, and do not shift by timezone");
{
  const { body } = renderV113(4, "2026-12-31");
  ok(body.includes("12-31-2026"), "the start date prints MM-DD-YYYY");
  ok(D.minTermEndIso("2026-12-31", 4) === "2027-01-28", "and the term crosses the year correctly");
  ok(body.includes("01-28-2027"), "the end date prints MM-DD-YYYY across the year boundary");
  const saved = process.env.TZ;
  for (const tz of ["UTC", "Pacific/Kiritimati", "Pacific/Midway"]) {
    process.env.TZ = tz;
    ok(D.minTermEndIso("2026-12-31", 4) === "2027-01-28" && D.fmtContractDate("2026-12-31") === "12-31-2026",
      `  stable in ${tz}`);
  }
  if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
}

// ================================================= fingerprint
console.log("\nchanging the term changes what would be signed");
{
  const four = renderV113(4), six = renderV113(6);
  ok(four.body !== six.body, "the rendered body differs");
  const f4 = await sha(four.body), f6 = await sha(six.body);
  ok(f4 !== f6, `the SHA-256 differs (${f4.slice(0, 12)} vs ${f6.slice(0, 12)})`);
  // The chosen term is inside the stored body's own terms, so it is covered
  // even before the merge step.
  ok(B.readTerms(four.tplBody).min_term_weeks === "4" && B.readTerms(six.tplBody).min_term_weeks === "6",
    "and the term is recorded in the body's %%BUILDER_TERMS%% line");
  ok(await sha(four.tplBody) !== await sha(six.tplBody), "so the template body's hash differs too");
  // Same inputs, same output — a fingerprint that moved on its own would make
  // every Send a coin toss.
  ok(await sha(renderV113(6).body) === f6, "rendering the same choice twice is identical");
}

// ================================================= layout
console.log("\nthe layout renders v1.13's structure");
{
  const { body } = renderV113(4);
  const blocks = LAY.parseLayout(body);
  const kinds = new Set(blocks.map((b) => b.k));
  const sum = blocks.filter((b) => b.k === "summary");
  ok(sum.length === 1, `one Key Rental Terms summary band (${sum.length})`);
  ok(sum[0]?.cols.length === 3, `with three columns (${sum[0]?.cols.length})`);
  ok(sum[0]?.cols[0].label === "Start Date" && sum[0]?.cols[2].label === "Weekly Rate",
    "labelled Start Date … Weekly Rate");
  ok(sum[0]?.cols.every((c) => c.value && c.value !== "__________"), "and every column carries a value");
  ok(kinds.has("sig"), "the signature block is placed");
  ok(blocks.filter((b) => b.k === "page").length === 2, "two page breaks (acknowledgments, signatures)");
  const acks = L.acknowledgmentsOf(body);
  ok(acks.length === 15, `fifteen acknowledgment rows (${acks.length})`);
  ok(acks.some((a) => /Autopay/.test(a)), "  including the Autopay authorization");
  ok(acks.some((a) => /replacement vehicle/i.test(a)), "  and the replacement-vehicle caveat");
  ok(acks.some((a) => /unlimited miles/i.test(a)), "  and unlimited miles");
  // The Fee Schedule is a headed table; the Condition Report is two sub-headed ones.
  const headed = blocks.filter((b) => b.k === "table" && b.header);
  ok(headed.length === 2, `two headed tables: Fee Schedule and Acknowledgments (${headed.length})`);
  ok(body.includes("### At Pickup") && body.includes("### At Return"), "the Vehicle Condition Report keeps both halves");
  ok(/Mechanical repair \(not caused by you\), no replacement available/.test(body), "the new Fee Schedule row is present");
  // The band must not have been swallowed by a table.
  ok(!blocks.some((b) => b.k === "table" && b.rows.some((r) => /Start Date \|/.test(r.cells[0] + r.cells[1]))),
    "the band is not parsed as a table row");
}

console.log("\nthe summary band survives the text rendering the signing page uses");
{
  const txt = LAY.layoutToText(renderV113(4).body);
  ok(/Start Date: 10-11-2026/.test(txt), "the band's values are readable as text");
  ok(/End Date \(4-Week Minimum\): 11-08-2026/.test(txt), "including the computed end date");
}

// ================================================= unresolved and unsourced
console.log("\nunresolved bracketed terms are kept, not invented");
{
  const v = L.libraryVersion("no_insurance", "1.13");
  const t = B.readTerms(v.body);
  for (const [key, want] of [["notice_hours", "[48]"], ["reservation_cancel_hours", "[24]"],
    ["report_hours", "[24]"], ["unreachable_days", "[3]"], ["fee_citation_admin", "$[25]"],
    ["service_miles", "[5,000]"], ["fee_lockout", "$[75] per call"]]) {
    ok(t[key] === want, `${key} is still ${want} (${t[key]})`);
  }
  ok(B.unknownTermsIn(v.source).length === 0, `every [[term]] v1.13 uses is a known field (${B.unknownTermsIn(v.source).join(",") || "none"})`);
  // service_area has no approved value yet, so it must read as missing.
  ok(B.missingTerms(t, v.source).includes("service_area"), "service_area is reported missing, not filled in");
}

console.log("\nthe three new payment fields have no source, so they block");
{
  const fields = new Set(M.MERGE_FIELDS.map((f) => f.key));
  for (const k of ["payment_schedule", "payment_amount_each", "payment_method"])
    ok(fields.has(k), `${k} is a declared merge field`);
  const { body } = renderV113(4);
  // Rendered with no data, each becomes the blank marker — which is what the
  // "still contains blank fields" send refusal keys on.
  ok((body.match(/__________/g) ?? []).length >= 3, "all three render blank rather than guessed");
  const fns = readFileSync("src/lib/agreements.functions.ts", "utf8");
  for (const k of ["payment_schedule", "payment_amount_each", "payment_method"])
    ok(new RegExp(`${k}: \\{ label:`).test(fns), `  ${k} is in templateFieldBlockers' need map`);
  ok(/No record holds the renter's weekly-or-monthly election yet/.test(fns), "  and says why rather than defaulting");
}

// ================================================= the guards
console.log("\nv1.13 cannot be sent, and nothing here approves anything");
{
  const fns = readFileSync("src/lib/agreements.functions.ts", "utf8");
  ok(/approvalStatus: "draft"/.test(fns), "a library family is always a draft");
  ok(/meta\.key && meta\.approvalStatus !== "approved"/.test(fns), "and send is refused for an unapproved family");
  ok(L.DRAFT_STATUS_LABEL === "Draft — Legal Review Required", "the draft label is unchanged");
  const libSrc = readFileSync("src/lib/agreement-library.ts", "utf8");
  ok(!/approval_status|approved_at|is_active/.test(libSrc), "the library writes no approval state");
  ok(!/insert|upsert|update\(/.test(libSrc), "and performs no database write");
  // Preview and send both require Manager.
  ok((fns.match(/requireTierFor\(context\.userId, "manager"\)/g) ?? []).length >= 2,
    "preview and send both require Manager");
  // Phase A touches no migration and no insurance permission.
  for (const f of ["src/lib/agreement-library.ts", "src/lib/agreement-prep.ts", "src/lib/agreement-layout.ts"])
    ok(!/0023|0024|0031|storage\.objects|insurance_card/.test(readFileSync(f, "utf8")),
      `${f} touches no migration, storage policy or insurance card`);
}

console.log("\nthe insurance_required family is unchanged by this phase");
{
  const t = L.libraryTemplate("insurance_required");
  ok(t.body === B.writeTerms(L.V1102_INS_SOURCE, L.V1102_TERM_DEFAULTS), "its body still renders from its own source and terms");
  ok(t.insuranceRequired === true, "it is still insurance-required");
  ok(!t.source.includes("Unlimited Miles"), "and has none of v1.13's new wording");
  ok(L.acknowledgmentsOf(t.body).length === 15, `its acknowledgment count is unchanged (${L.acknowledgmentsOf(t.body).length})`);
}

console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall v1.13 Phase A checks pass");
process.exit(fail ? 1 : 0);
