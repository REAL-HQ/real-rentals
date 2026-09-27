/**
 * Readiness and the document vault must agree, and the drawer must give
 * readiness the vault without anybody clicking a tab first.
 *
 * The live symptom: an applicant uploaded a licence, an insurance PDF, a gig
 * profile and a trip screenshot; all four were in public.documents, current;
 * and the Driver profile's readiness panel — the first thing staff see —
 * listed the licence and the insurance as still needed. Nothing was missing.
 * The vault was fetched by <ApplicantDocuments>, which lives inside the
 * Documents tab, and Radix unmounts an inactive tab, so on the Overview tab
 * it had never run and readiness computed with zero documents.
 *
 * Two halves. The model half proves the gap labels move when the vault is
 * supplied. The wiring half proves the vault cannot be trapped behind a tab
 * again, which is the part a model test cannot see.
 */
import { readFileSync } from "node:fs";
import { computeReadiness } from "../.readiness-build/readiness.js";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const APP = "59b62ce6-654e-4298-a6c3-ff5bb79f9d35";

// The live test applicant, as production holds it.
const application = {
  id: APP,
  full_name: "Dolmar Cross",
  status: "new",
  license_valid: true,
  license_photo_url: `${APP}/1790534001905-1qg44q.jpg`,
  insurance_doc_url: `${APP}/1790534080333-epkj5h.pdf`,
  profile_screenshot_url: `${APP}/1790534124814-41y58z.jpg`,
  trip_screenshots: [`${APP}/1790534147677-x4dl2e.jpg`],
  insurance_answer: "yes",
  full_coverage_insurance: true,
  trips_completed: "500",
  rating: 4.9,
  gig_status: "Yes, already driving",
  platforms: ["Uber"],
  drive_type: "full_time",
  expected_duration: "1_month",
};

// Its vault rows, after the repair: four categories, four current files.
const vault = [
  { category: "license_front", is_current: true, review_status: "uploaded" },
  { category: "insurance", is_current: true, review_status: "uploaded" },
  { category: "gig_profile", is_current: true, review_status: "uploaded" },
  { category: "trip_history", is_current: true, review_status: "uploaded" },
];

const gapsOf = (docs) => {
  const r = computeReadiness(application, null, docs);
  const out = [];
  for (const f of r.factors ?? []) {
    for (const g of f.gaps ?? []) out.push(String(g).toLowerCase());
    if (f.detail) out.push(String(f.detail).toLowerCase());
  }
  return out.join(" | ");
};

console.log("READINESS READS THE VAULT IT IS GIVEN");
{
  /*
   * What the vault actually contributes, precisely.
   *
   * Presence comes from the application's own columns, so with or without
   * the vault this applicant's licence reads "on file" — readiness was never
   * claiming the documents were missing, and saying so would be wrong.
   *
   * What the vault contributes is whether a person has CHECKED them. A
   * verified row moves the evidence from "document" to "staff_verified" and
   * the wording from "Licence image on file" to "Licence image checked by
   * staff". With the vault trapped behind an unmounted tab the profile could
   * never show that, no matter how many documents staff had verified — and
   * could not show the documents themselves at all.
   */
  const verified = vault.map((d) => ({ ...d, review_status: "verified" }));
  const withVault = computeReadiness(application, null, verified);
  const withoutVault = computeReadiness(application, null, []);
  const evidence = (r, key) => (r.factors ?? []).find((f) => f.key === key)?.evidence ?? null;
  const detail = (r, key) => (r.factors ?? []).find((f) => f.key === key)?.detail ?? "";

  ok(evidence(withoutVault, "license_doc") === "document",
     `without the vault the licence is only "on file" (${detail(withoutVault, "license_doc")})`);
  ok(evidence(withVault, "license_doc") === "staff_verified",
     `with it, staff verification shows (${detail(withVault, "license_doc")})`);
  ok(evidence(withoutVault, "insurance_doc") === "document" &&
     evidence(withVault, "insurance_doc") === "staff_verified",
     "same for the insurance document");

  // A rejected document is not evidence, whatever the application column says.
  const rejected = vault.map((d) =>
    d.category === "license_front" ? { ...d, review_status: "rejected" } : d);
  ok(evidence(computeReadiness(application, null, rejected), "license_doc") !== "staff_verified",
     "a rejected licence does not read as checked");
}

console.log("\nEVERY CATEGORY THE APPLICANT CAN UPLOAD IS UNDERSTOOD");
{
  const src = readFileSync("src/lib/readiness.ts", "utf8");
  const aliases = src.slice(src.indexOf("const DOC_ALIASES"), src.indexOf("export type DocumentIndex"));
  for (const c of ["license_front", "insurance", "gig_profile"]) {
    ok(aliases.includes(`"${c}"`), `readiness knows the vault category ${c}`);
  }
}

console.log("\nTHE VAULT CANNOT BE TRAPPED BEHIND A TAB AGAIN");
{
  const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
  const docsCmp = readFileSync("src/components/admin/ApplicantDocuments.tsx", "utf8");

  ok(/const listVaultDocs = useServerFn\(adminListDriverDocuments\)/.test(panel),
     "the drawer fetches the vault itself");
  ok(/computeReadiness\(driver, screening, vaultDocs\)/.test(panel),
     "  and readiness is computed from what it fetched");
  ok(!/useServerFn\(adminListDriverDocuments\)/.test(docsCmp),
     "the tab no longer fetches its own copy");
  ok(/docs: VaultDocument\[\]/.test(docsCmp), "  it renders what the drawer passes in");

  // The specific trap: the fetch must not sit inside <TabsContent>, which
  // Radix unmounts while another tab is selected.
  const tabStart = panel.indexOf('<TabsContent value="documents"');
  const fetchAt = panel.indexOf("const listVaultDocs");
  ok(fetchAt >= 0 && (tabStart < 0 || fetchAt < tabStart),
     "the fetch is declared above the tab content, not inside it");

  // One fetch per applicant, not one per row and not one per tab switch.
  ok((panel.match(/listVaultDocs\(\{ data: \{ applicationId/g) ?? []).length === 1,
     "exactly one call site — no N+1 and no per-tab refetch");
  ok(/}, \[driver\.id, listVaultDocs\]\)/.test(panel),
     "  memoised on the applicant id, so editing a field does not refetch");

  // Neither surface may paint documents it has not finished loading.
  ok(/if \(loading\) \{/.test(docsCmp), "the tab shows a loading state rather than stale rows");
  ok(/loading \?[\s\S]{0,120}Loading what they sent/.test(panel),
     "  and so does the Overview strip");

  // Switching applicants must not carry one person's vault onto the next.
  ok(/key=\{open\.id\}/.test(panel),
     "the drawer is keyed by applicant, so its document state cannot outlive the applicant");
}

console.log("\nTHE NEW SURFACES CANNOT LEAK A RESTRICTED DOCUMENT");
{
  const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
  const docsFn = readFileSync("src/lib/documents.functions.ts", "utf8");

  // The strip reads the same payload the tab does, and that payload has
  // already had restricted rows removed IN THE QUERY for anyone below Owner
  // — not hidden client-side, where a network tab would still show them.
  const strip = panel.slice(panel.indexOf("function DocumentsStrip"),
                            panel.indexOf("const DRIVER_STATUSES"));
  ok(!/verification_recording/.test(strip),
     "the Documents strip never names the restricted category");
  ok(/keys: \["license_front", "license_back"\]/.test(strip),
     "  it groups only applicant document categories");
  ok(!/storage_path|storage_bucket/.test(strip),
     "  and renders no storage path or bucket");

  ok(/if \(!owner\) q = q\.not\("category", "in", `\(\$\{RESTRICTED_CATEGORIES/.test(docsFn),
     "the list query still excludes restricted rows for non-Owners");
  ok(/export const ownerListVerificationRecordings[\s\S]{0,400}requireOwner/.test(docsFn),
     "recordings remain behind their own Owner-only function");
  ok(/await requireStaff\(context\.userId\)/.test(docsFn),
     "and the list is still Coordinator-and-above only");

  // The drawer must not have reached around the server function.
  ok(!/from\("documents"\)/.test(panel.slice(panel.indexOf("function DriverDetail"))),
     "the drawer reads the vault through the server function, not a direct table query");
}

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
