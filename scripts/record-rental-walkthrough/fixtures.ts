// Synthetic data only. No network, database, Stripe or storage access.
const scenario = new URLSearchParams(location.search).get("s") ?? "esign";
const APP = "10000000-0000-4000-8000-000000000002", CAR = "10000000-0000-4000-8000-000000000004";
const SHA = "3f6b2a9c41d07e5b8a1c2d3e4f5061728394a5b6c7d8e9f00112233445566778";
const base = {
  driver: { applicationId: APP, name: "Jordan Sample", portalLogin: true, archived: false },
  licence: { front: "verified", back: "verified", number: true, state: true, expiresOn: "2028-04-30" },
  agreements: [{ id: "10000000-0000-4000-8000-000000000006", vehicleId: CAR, status: "signed", signedAt: "2026-09-28T15:12:00Z",
    voided: false, archived: true, signedTerms: true, sha256: SHA }],
  historicalInstalled: true, historical: null as unknown,
};
const facts = structuredClone(base) as any;
if (scenario === "blocked") { facts.driver.portalLogin = false; facts.licence.front = "pending"; facts.agreements = [{ ...facts.agreements[0], status: "sent", signedAt: null, archived: false, signedTerms: false, sha256: null }]; }
if (scenario === "legacy") { facts.agreements[0].signedTerms = false; }
if (scenario === "historical") {
  facts.agreements = [{ ...facts.agreements[0], status: "voided", voided: true }];
  facts.historical = { id: "10000000-0000-4000-8000-000000000007", source: "paper", legacyAgreementId: null, vehicleId: CAR,
    documentId: "10000000-0000-4000-8000-000000000008", documentSha256: SHA, signedOn: "2026-08-01", legacySignedAt: null,
    rentalStart: "2026-08-02T10:00:00-04:00", weeklyCents: 32500, depositCents: 50000,
    termsSummary: "Weekly rent $325, $500 deposit, 4-week minimum, as written on the signed paper original.", registeredAt: "2026-10-20T14:03:00Z" };
}
const wait = <T,>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 120));
const refuse = () => Promise.reject(new Error("Walkthrough is read-only: nothing is saved."));
export const useServerFn = (f: unknown) => f;
export const supabase = { auth: { onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
  setTimeout(() => cb("INITIAL_SESSION", { user: { id: "10000000-0000-4000-8000-000000000001" } }), 0);
  return { data: { subscription: { unsubscribe() {} } } }; } } };
export const recordRentalStatus = () => wait(facts);
export const previewBillingLink = () => wait({ environment: "sandbox", customer: "cus_SyntheticSample", subscription: "sub_SyntheticSample",
  unitAmount: scenario === "historical" ? 32500 : 35000, currency: "usd", interval: "week", nextDue: "2026-10-29T15:00:00.000Z", observedAt: "2026-10-24T12:00:00.000Z" });
export const previewPositiveLicense = () => wait({ fingerprint: "a".repeat(64), archived: [],
  snapshot: { licenseNumber: "S•••••4821", state: "FL", expires: "2028-04-30", front: "verified", back: "verified" } });
export const verifyPositiveLicense = () => wait({ reviewId: "10000000-0000-4000-8000-0000000000aa" });
export const archiveSignedAgreement = refuse, registerHistoricalAgreement = refuse, registerLegacyEsignAgreement = refuse, voidHistoricalAgreement = refuse;
export const recordExistingRentalV3 = refuse;
export const listPaperAgreementOriginals = () => wait([{ id: "10000000-0000-4000-8000-000000000009", file_name: "signed-original.pdf",
  content_sha256: SHA, is_current: true, agreement_type: "original", signed_on: "2026-08-01", provenance: "Verified" }]);
