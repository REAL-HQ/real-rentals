/**
 * Staff identity verification calls preview_approval_identity and then
 * verify_approval_identity on the manager JWT.
 *
 * false: the review screen renders nothing, and the server function throws
 * before a role lookup, a table read, or an RPC. No environment variable
 * opens this. A rebuild that changes this constant is the release.
 */
export const IDENTITY_VERIFICATION_ENABLED = true;

export const IDENTITY_VERIFICATION_HOLD =
  "Identity verification awaits release approval.";
