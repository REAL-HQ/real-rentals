/**
 * Signed agreement PDFs are served through our own server, never by sending
 * the browser to a storage URL (extensions block it, and it exposes paths).
 * Run: node scripts/agreement-pdf.test.mjs
 */
import { readFileSync } from "node:fs";
let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}`); };
const fn = readFileSync("src/lib/agreements.functions.ts", "utf8");
const body = fn.slice(fn.indexOf("export const getAgreementPdf"), fn.indexOf("// ----", fn.indexOf("export const getAgreementPdf")));
const card = readFileSync("src/components/admin/AgreementsCard.tsx", "utf8");
const portal = readFileSync("src/routes/portal.tsx", "utf8");
const dl = readFileSync("src/lib/agreement-download.ts", "utf8");

ok(/requireSupabaseAuth/.test(body), "unauthenticated callers are refused");
ok(/context\.supabase\s*\.from\("agreements"\)/.test(body), "access decided by the caller's own RLS (staff, or the owning driver)");
ok(/Agreement not found/.test(body), "unknown or someone else's id is not found");
ok(/hasn't been saved yet/.test(body), "no saved PDF gives a truthful error");
ok(!/createSignedUrl/.test(body), "no storage URL is handed to the browser");
ok(/\.download\(/.test(body) && /application\/pdf/.test(body), "bytes fetched server-side, typed application/pdf");
ok(/REAL-RENTALS-Rental-Agreement/.test(body), "friendly filename");
ok(/await import\("@\/integrations\/supabase\/client\.server"\)/.test(body), "service client loaded only inside the handler");
ok(!/client\.server/.test(card + portal + dl), "no service client in browser code");
ok(/saveAgreementPdf/.test(card) && /saveAgreementPdf/.test(portal), "staff card and driver portal share one download path");
ok(!/getAgreementPdfUrl/.test(card + portal + fn), "old storage-URL function is gone");
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
