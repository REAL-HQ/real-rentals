// Shared allowlist for scripts/flag-single-source.test.mjs and
// scripts/enabled-flags-no-env.test.mjs. Both tools import this file so the
// lists cannot drift.
//
// A name is here only when it exists on LIVE codex/revenue-publication
// 7e3e6eb and is owner-controlled. Do not add a name to silence a new flag.
//
// DOCUMENT_EXPIRY_NOTICES_ENABLED is not here. It does not exist on 7e3e6eb
// (dark on RC branches only) and is a hard-false constant, not an env read.

// Literal `true` under src/ on 7e3e6eb. The only `*_ENABLED = true`.
export const LIVE_TRUE_FLAGS = ["STRIPE_COLLECTIONS_ENABLED"];

// Env-gated on 7e3e6eb. Production may already have these set to "true".
export const LIVE_ENV_GATED_FLAGS = [
  {
    name: "DRIVER_ISSUE_ALERTS_ENABLED",
    reason: "staff email when a driver files an issue; env-gated on 7e3e6eb and may already send",
  },
  {
    name: "ROADSIDE_SMS_ALERTS_ENABLED",
    reason: "roadside SMS to staff; env-gated on 7e3e6eb and may already send",
  },
  {
    name: "STRIPE_RECONCILIATION_ENABLED",
    reason: "reconciliation activation pin; env-gated on 7e3e6eb (stripe-reconciliation.server.ts)",
  },
  {
    name: "APPLICATION_RESUME_ATOMIC_ENABLED",
    reason: "switches application resume onto the atomic SQL path; env-gated on 7e3e6eb (application-recovery.server.ts)",
  },
  {
    name: "RENTER_LIFECYCLE_NOTICES_ENABLED",
    reason: "enrolls renter lifecycle notices after a rental or incident write; env-gated on 7e3e6eb",
  },
];
