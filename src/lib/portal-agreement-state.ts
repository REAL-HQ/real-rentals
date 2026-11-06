// What the driver portal shows for one rental agreement. Client-safe.
//
// The portal used to decide this inline from `signed_at` alone, so any row
// without a signature, including a VOIDED one staff had cancelled, read
// "Awaiting your signature" with a "Review & Sign" button. Signing a voided
// agreement is refused by the engine (esign_claim), but the driver was still
// asked to do it. A draft is not an issued agreement and is never shown.
//
// Only an issued, unsigned agreement (sent or viewed) asks for a signature.
// Everything else gets a neutral state and no signing call to action.

export type PortalAgreementState = "awaiting_signature" | "signing" | "signed" | "cancelled" | "hidden";

export type PortalAgreementLike = { status?: string | null; signed_at?: string | null };

export function portalAgreementState(a: PortalAgreementLike): PortalAgreementState {
  const status = String(a.status ?? "").toLowerCase();
  if (status === "signed" || (a.signed_at && status !== "voided")) return "signed";
  if (status === "voided") return "cancelled";
  if (status === "signing") return "signing";
  if (status === "sent" || status === "viewed") return "awaiting_signature";
  // draft, or anything unrecognised: not an agreement the driver can act on.
  return "hidden";
}

/** True only when the driver should be asked to sign this agreement. */
export function awaitsDriverSignature(a: PortalAgreementLike): boolean {
  return portalAgreementState(a) === "awaiting_signature";
}

/** The neutral line shown under the agreement title. Title Case in the string. */
export function portalAgreementStatusLabel(state: PortalAgreementState): string {
  switch (state) {
    case "awaiting_signature":
      return "Awaiting Your Signature";
    case "signing":
      return "Signature Being Recorded";
    case "signed":
      return "Signed";
    case "cancelled":
      return "Cancelled · No Action Needed";
    default:
      return "";
  }
}
