// src/lib/portal-agreement-state.ts
function portalAgreementState(a) {
  const status = String(a.status ?? "").toLowerCase();
  if (status === "signed" || a.signed_at && status !== "voided") return "signed";
  if (status === "voided") return "cancelled";
  if (status === "signing") return "signing";
  if (status === "sent" || status === "viewed") return "awaiting_signature";
  return "hidden";
}
function awaitsDriverSignature(a) {
  return portalAgreementState(a) === "awaiting_signature";
}
function portalAgreementStatusLabel(state) {
  switch (state) {
    case "awaiting_signature":
      return "Awaiting Your Signature";
    case "signing":
      return "Signature Being Recorded";
    case "signed":
      return "Signed";
    case "cancelled":
      return "Cancelled \xB7 No Action Needed";
    default:
      return "";
  }
}
export {
  awaitsDriverSignature,
  portalAgreementState,
  portalAgreementStatusLabel
};
