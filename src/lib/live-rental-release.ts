// Release holds are code-owned, not browser storage or role substitutes.
// Every mutation endpoint must authorize independently before checking its hold.
export const LIVE_RENTAL_RELEASE = Object.freeze({
  paperAgreements: false,
  approveOnly: false,
  invitations: false,
  recordRental: false,
  subscriptionLinkage: false,
  historicalPayments: false,
});

export const APPROVAL_RELEASE_HOLD =
  "Approval is disabled until verified identity, database protection and audit safeguards are approved.";

/** Invalidates stale asynchronous completions on edits, close and context changes. */
export function createRequestGate() {
  let revision = 0;
  return {
    begin: () => ++revision,
    invalidate: () => { revision++; },
    isCurrent: (request: number) => request === revision,
  };
}