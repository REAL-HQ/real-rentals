# RC diff 7e3e6eb61a65..c46354b0eae6

From `7e3e6eb61a65aac641a000aa2335a3f3169158f7` to `c46354b0eae62db234ea4801756b391fe7a6e353`.

## Files

| Status | Path | Source branches / commits |
| --- | --- | --- |
| M | bun.lock | 3f8d0b0404a9 Fix the maintenance-log missing-relation check and the RC guard. (3f8d0b0404a9) |
| M | package.json | 3f8d0b0404a9 Fix the maintenance-log missing-relation check and the RC guard. (3f8d0b0404a9) |
| A | proposed/incident-board-v1.sql | b29d011243f2 Add a dark Incident Board for open incidents. (b29d011243f2) |
| A | proposed/jv-splits-v1.sql | bd18221173c7 Add a dark per-vehicle profitability and JV report. (bd18221173c7) |
| A | proposed/maintenance-due-v1.sql | d31c15adea2e Add a dark Maintenance Due view on Vehicles. (d31c15adea2e) |
| A | proposed/maintenance-log-v1.sql | e3d40e01d0ae Add a dark maintenance log and service reminders. (e3d40e01d0ae) |
| A | proposed/return-checklist-v1.sql | 313708b226db Add a manager return checklist that stays off. (313708b226db) |
| A | scripts/accountant-export.test.ts | 2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b)<br>b63548ffd3a6 Load Stripe fees into the accountant year export. (b63548ffd3a6) |
| A | scripts/accountant-export.vitest.config.ts | 2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b) |
| A | scripts/active-rentals.test.ts | c3d84cfe5d05 Add a read-only Active Rentals board for managers. (c3d84cfe5d05) |
| M | scripts/admin-reads-access.test.mjs | a6df305cdfe8 Pin three baseline tests that fail outside the RC diffs. (a6df305cdfe8) |
| M | scripts/admin-shell-roles.test.ts | c3d84cfe5d05 Add a read-only Active Rentals board for managers. (c3d84cfe5d05) |
| A | scripts/applicant-funnel.test.ts | 4afab0e9022d Add a dark, read-only applicant funnel for managers. (4afab0e9022d) |
| A | scripts/application-quick-review.test.ts | 178071086339 Add a read-only application quick review behind a default-off flag. (178071086339)<br>cff56f56cae5 Refresh an expired quick-review document link through the vault list. (cff56f56cae5) |
| A | scripts/application-status-tracker.test.ts | ddba201e27a9 Add a dark, read-only application status tracker. (ddba201e27a9) |
| A | scripts/application-timeline.test.ts | fce19f7dd18c Add a gated application status timeline for applicants. (fce19f7dd18c) |
| A | scripts/apply-progress.test.ts | 66e8666cbd7a Add a flag-off progress indicator for the apply flow. (66e8666cbd7a)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126) |
| A | scripts/apply-token-redirect.test.ts | c61c81fc3d65 Send /apply resume links to /thank-you before the token is stripped. (c61c81fc3d65)<br>e2d63191bef6 Cover an invalid apply token in the thank-you redirect test. (e2d63191bef6)<br>00d7e6382d0b Keep the invalid-token recovery check on the new thank-you wording. (00d7e6382d0b) |
| A | scripts/apply-vehicle-prefill.test.ts | ea7bcb109ba5 Add a flag-gated preferred vehicle on apply. (ea7bcb109ba5)<br>4239ccd2c653 Import the RC12 feature flags from their lib modules. (4239ccd2c653) |
| A | scripts/billing-health.test.ts | 325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50) |
| A | scripts/billing-health.vitest.config.ts | 325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50) |
| A | scripts/booking-funnel.test.ts | e25ec28b7344 Add an Approved, Not Yet Renting funnel for managers. (e25ec28b7344) |
| M | scripts/ci/record-rental/guard.mjs | a6df305cdfe8 Pin three baseline tests that fail outside the RC diffs. (a6df305cdfe8)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126)<br>8c7b0ca7d71c Close the RC13 review gaps and add an opt-in guard mode. (8c7b0ca7d71c)<br>3f8d0b0404a9 Fix the maintenance-log missing-relation check and the RC guard. (3f8d0b0404a9)<br>573142241a4e Pin locked files and contract importers in the RC guard. (origin/cursor/rc14-guard-lockfile-8871, origin/cursor/rc14-guard-pins-8871)<br>c46354b0eae6 Treat the pinned lockfiles as allowed record-rental paths. (origin/cursor/rc14-guard-lockfile-8871) |
| M | scripts/ci/record-rental/guard.test.mjs | a6df305cdfe8 Pin three baseline tests that fail outside the RC diffs. (a6df305cdfe8)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126)<br>8c7b0ca7d71c Close the RC13 review gaps and add an opt-in guard mode. (8c7b0ca7d71c)<br>3f8d0b0404a9 Fix the maintenance-log missing-relation check and the RC guard. (3f8d0b0404a9)<br>573142241a4e Pin locked files and contract importers in the RC guard. (origin/cursor/rc14-guard-lockfile-8871, origin/cursor/rc14-guard-pins-8871)<br>c46354b0eae6 Treat the pinned lockfiles as allowed record-rental paths. (origin/cursor/rc14-guard-lockfile-8871) |
| M | scripts/ci/record-rental/manifest.json | a6df305cdfe8 Pin three baseline tests that fail outside the RC diffs. (a6df305cdfe8)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126)<br>3f8d0b0404a9 Fix the maintenance-log missing-relation check and the RC guard. (3f8d0b0404a9) |
| A | scripts/closeout-summary.test.ts | f99968fcc8d0 Add a dark Closeout Summary on an open rental. (f99968fcc8d0) |
| A | scripts/collections-watch.test.ts | bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | scripts/collections-watch.vitest.config.ts | bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb) |
| A | scripts/deposit-ledger-stripe.test.ts | 921824c4bc1d Add an optional Stripe cross-check to Deposit Ledger. (921824c4bc1d) |
| A | scripts/deposit-ledger.test.ts | 6d22063e6b9e Add a read-only Deposit Ledger that stays off. (origin/cursor/deposit-ledger-12af)<br>921824c4bc1d Add an optional Stripe cross-check to Deposit Ledger. (921824c4bc1d) |
| A | scripts/deposit-ledger.vitest.config.ts | 6d22063e6b9e Add a read-only Deposit Ledger that stays off. (origin/cursor/deposit-ledger-12af)<br>921824c4bc1d Add an optional Stripe cross-check to Deposit Ledger. (921824c4bc1d) |
| A | scripts/deposits-ledger.test.ts | d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | scripts/deposits-ledger.vitest.config.ts | d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1) |
| A | scripts/document-expiry.test.ts | 0ebddd0f86cd Show managers which active renters have documents expiring. (0ebddd0f86cd)<br>673484011784 Include approved drivers when no rental row exists. (673484011784)<br>6f01aefe34e9 Turn document expiry notices into a hard-false constant. (origin/cursor/hard-false-flags-12af) |
| A | scripts/driver-agreement-view.test.ts | 2828d7f9f996 Add a flag-off My Agreement card for the driver portal. (2828d7f9f996)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126) |
| A | scripts/driver-doc-expiry.test.ts | ed27010222f0 Add a flag-off My Documents expiry card for drivers. (ed27010222f0)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126) |
| A | scripts/driver-help.test.ts | dcc1ce627f8b Add a dark, static driver help page. (dcc1ce627f8b) |
| M | scripts/driver-issues-access.test.ts | b42326c6d1f5 Add urgent roadside help from the driver portal. (b42326c6d1f5)<br>8b79616a4774 Turn roadside staff SMS into a hard-false constant. (origin/cursor/hard-false-flags-12af) |
| A | scripts/driver-payment-history.test.ts | f0426f9c686b Add a flag-gated driver payment history card. (f0426f9c686b) |
| A | scripts/driver-receipts.test.ts | 7b57f8ad35d3 Add a dark, read-only payment history and receipt for drivers. (7b57f8ad35d3)<br>2b3eb2d83737 Use the site brand on driver receipts. (2b3eb2d83737) |
| A | scripts/driver-roadside.test.ts | 29e21c7cc920 Add a static Roadside Help page behind a hard-off flag. (29e21c7cc920) |
| A | scripts/driver-statement.test.ts | 8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | scripts/driver-statement.vitest.config.ts | 8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d) |
| A | scripts/enabled-flags-no-env.test.mjs | e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af)<br>6f01aefe34e9 Turn document expiry notices into a hard-false constant. (origin/cursor/hard-false-flags-12af)<br>8b79616a4774 Turn roadside staff SMS into a hard-false constant. (origin/cursor/hard-false-flags-12af) |
| A | scripts/expense-categories.test.ts | c81647dc95bb Add a dark expense category summary. (c81647dc95bb) |
| A | scripts/expense-categories.vitest.config.ts | c81647dc95bb Add a dark expense category summary. (c81647dc95bb) |
| A | scripts/finance-data-quality.test.ts | cb519fa8f8ee Add a read-only Finance Data Quality report that stays off. (cb519fa8f8ee) |
| A | scripts/finance-data-quality.vitest.config.ts | cb519fa8f8ee Add a read-only Finance Data Quality report that stays off. (cb519fa8f8ee) |
| A | scripts/finance-deposit-ledger.test.ts | 3dd0cf93fb40 Add a read-only Deposit Ledger report that stays off. (3dd0cf93fb40) |
| A | scripts/finance-deposit-ledger.vitest.config.ts | 3dd0cf93fb40 Add a read-only Deposit Ledger report that stays off. (3dd0cf93fb40) |
| A | scripts/flag-single-source.test.mjs | c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126)<br>bcbdc8561ec7 Parse *_ENABLED declarations with the TypeScript compiler. (origin/cursor/rc13-flag-scanner-12af)<br>d4881934431e Count every *_ENABLED binding once under src/. (origin/cursor/rc13-flag-scanner-12af)<br>a15f366f8c59 Warn on hidden false gates and count parameter defaults. (origin/cursor/rc13-flag-scanner-12af)<br>4da5b4cf0813 Fail the flag scanner unless a declaration is literal false. (origin/cursor/rc13-flag-scanner-12af)<br>445432ee1747 Allow the two live driver-issue alert flags to stay env-gated. (origin/cursor/rc13-flag-scanner-12af)<br>31d207023411 Reject flag reassignment and share the live env allowlist. (origin/cursor/rc13-flag-scanner-12af)<br>5d11270343e1 Stop treating roadside SMS as a live env flag. (origin/cursor/rc13-flag-scanner-12af) |
| A | scripts/fleet-availability.test.ts | 4b96bb255e99 Add a dark Fleet Availability board. (4b96bb255e99)<br>573142241a4e Pin locked files and contract importers in the RC guard. (origin/cursor/rc14-guard-lockfile-8871, origin/cursor/rc14-guard-pins-8871) |
| A | scripts/fleet-calendar.test.ts | f6439e5315ae Add a dark Fleet Calendar for managers. (f6439e5315ae)<br>e54597eaa6a5 Stop Fleet Calendar from interpolating PostgREST filters. (e54597eaa6a5)<br>573142241a4e Pin locked files and contract importers in the RC guard. (origin/cursor/rc14-guard-lockfile-8871, origin/cursor/rc14-guard-pins-8871) |
| A | scripts/fleet-filters.test.ts | a575a6484b8a Add flag-gated filters and sorting on the public fleet page. (a575a6484b8a)<br>8c7b0ca7d71c Close the RC13 review gaps and add an opt-in guard mode. (8c7b0ca7d71c) |
| M | scripts/fleet-inbox.test.ts | 573142241a4e Pin locked files and contract importers in the RC guard. (origin/cursor/rc14-guard-lockfile-8871, origin/cursor/rc14-guard-pins-8871) |
| A | scripts/incident-board.test.ts | b29d011243f2 Add a dark Incident Board for open incidents. (b29d011243f2) |
| A | scripts/lead-followups.test.mjs | f28586671f62 Add a dark staff draft for due Lead Priorities follow-ups. (origin/cursor/lead-followups-029f)<br>97377cf840c8 Refuse lead follow-up drafts before auth and the role check. (origin/cursor/lead-followups-029f) |
| A | scripts/live-enabled-flags.mjs | 31d207023411 Reject flag reassignment and share the live env allowlist. (origin/cursor/rc13-flag-scanner-12af)<br>5d11270343e1 Stop treating roadside SMS as a live env flag. (origin/cursor/rc13-flag-scanner-12af)<br>6f01aefe34e9 Turn document expiry notices into a hard-false constant. (origin/cursor/hard-false-flags-12af)<br>8b79616a4774 Turn roadside staff SMS into a hard-false constant. (origin/cursor/hard-false-flags-12af) |
| A | scripts/maintenance-due.test.ts | d31c15adea2e Add a dark Maintenance Due view on Vehicles. (d31c15adea2e) |
| A | scripts/maintenance-log.test.ts | e3d40e01d0ae Add a dark maintenance log and service reminders. (e3d40e01d0ae)<br>8c7b0ca7d71c Close the RC13 review gaps and add an opt-in guard mode. (8c7b0ca7d71c)<br>3f8d0b0404a9 Fix the maintenance-log missing-relation check and the RC guard. (3f8d0b0404a9) |
| A | scripts/my-car-card.test.ts | 29e21c7cc920 Add a static Roadside Help page behind a hard-off flag. (29e21c7cc920) |
| A | scripts/next-steps.test.ts | 3c3af9d1b07c Add a gated Your Next Steps card and fix a bare thank-you page. (3c3af9d1b07c)<br>aaf5712e8e6e Use the business phone for the pickup line. (aaf5712e8e6e) |
| A | scripts/owner-expense-entry.test.ts | 7ab92c99ad77 Add owner expense entry behind a default-off constant. (7ab92c99ad77) |
| A | scripts/owner-expense-entry.vitest.config.ts | 7ab92c99ad77 Add owner expense entry behind a default-off constant. (7ab92c99ad77) |
| A | scripts/owner-finance-snapshot.test.ts | 37a0990eb634 Add a read-only Owner Weekly Finance Snapshot that stays off. (37a0990eb634)<br>f23e02954e16 Wire the weekly snapshot tiles to the RC9 readers. (f23e02954e16) |
| A | scripts/owner-finance-snapshot.vitest.config.ts | 37a0990eb634 Add a read-only Owner Weekly Finance Snapshot that stays off. (37a0990eb634) |
| A | scripts/owner-pnl-agreement.test.ts | 1e30e448476c Keep Monthly Owner P&L as the only P&L screen. (1e30e448476c)<br>423aebb4b114 Count recorded cash and app payments on Monthly Owner P&L. (423aebb4b114) |
| A | scripts/owner-pnl-agreement.vitest.config.ts | 1e30e448476c Keep Monthly Owner P&L as the only P&L screen. (1e30e448476c) |
| A | scripts/owner-pnl-fees.test.ts | 132bab5108e7 Subtract Stripe processing fees on Monthly Owner P&L. (132bab5108e7)<br>b63548ffd3a6 Load Stripe fees into the accountant year export. (b63548ffd3a6) |
| A | scripts/owner-pnl.test.ts | 00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9)<br>132bab5108e7 Subtract Stripe processing fees on Monthly Owner P&L. (132bab5108e7) |
| A | scripts/owner-pnl.vitest.config.ts | 00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9)<br>132bab5108e7 Subtract Stripe processing fees on Monthly Owner P&L. (132bab5108e7) |
| A | scripts/partner-statement.test.ts | f77549b510f1 Add a read-only Partner Statement behind a default-off flag. (f77549b510f1)<br>095c2a8c4d22 Route partner statement charges through the read-only Stripe client. (095c2a8c4d22) |
| A | scripts/partner-statement.vitest.config.ts | f77549b510f1 Add a read-only Partner Statement behind a default-off flag. (f77549b510f1) |
| A | scripts/payout-breakdown.test.ts | 05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c) |
| A | scripts/payout-breakdown.vitest.config.ts | 05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c) |
| A | scripts/pickup-checklist.test.ts | 5968c9fbc3cc Add a pickup readiness checklist behind a hard-false flag. (5968c9fbc3cc) |
| A | scripts/portal-document-update.test.ts | 3626f35761a2 Add a gated portal card for an expiring or missing license or insurance. (3626f35761a2) |
| A | scripts/portal-my-rental.test.ts | ac133bc7d964 Add a gated read-only My Rental card on the driver dashboard. (ac133bc7d964) |
| A | scripts/portal-notices.test.ts | ead4c08364a3 Add a dark, read-only Notices list to the driver portal. (ead4c08364a3) |
| A | scripts/portal-payment-history.test.ts | 694a2150dd4c Add a gated read-only payment history card on the driver dashboard. (694a2150dd4c) |
| A | scripts/portal-pickup-checklist.test.ts | 4cd9b92e31a9 Add a read-only pickup checklist behind a default-off flag. (4cd9b92e31a9) |
| A | scripts/public-availability.test.ts | 8ecdae247788 Add public fleet availability badges behind a hard-off flag. (8ecdae247788) |
| A | scripts/receivables-aging.test.ts | 1e9b99def8d2 Add a read-only Receivables Aging screen that stays off. (1e9b99def8d2) |
| A | scripts/receivables-aging.vitest.config.ts | 1e9b99def8d2 Add a read-only Receivables Aging screen that stays off. (1e9b99def8d2) |
| A | scripts/renewals-due.test.ts | 7dfda150aacf Add a dark Renewal Due list for managers. (7dfda150aacf) |
| A | scripts/rent-aging.test.ts | ffe11653e5dc Add a read-only Rent Aging report that stays off. (ffe11653e5dc) |
| A | scripts/rent-aging.vitest.config.ts | ffe11653e5dc Add a read-only Rent Aging report that stays off. (ffe11653e5dc) |
| A | scripts/rent-reconciliation-stripe.test.ts | f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04) |
| A | scripts/rent-reconciliation.test.ts | f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04) |
| A | scripts/rent-reconciliation.vitest.config.ts | f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04) |
| A | scripts/renter-payment-banner.test.ts | 94ba4351d48a Add a read-only renter payment banner, off by default. (94ba4351d48a) |
| A | scripts/return-checklist.test.ts | 313708b226db Add a manager return checklist that stays off. (313708b226db) |
| A | scripts/revenue-forecast.test.ts | 8932feeb630a Add an owner-only 4-week revenue forecast behind a hard-off flag. (8932feeb630a) |
| A | scripts/revenue-forecast.vitest.config.ts | 8932feeb630a Add an owner-only 4-week revenue forecast behind a hard-off flag. (8932feeb630a) |
| A | scripts/roadside-help.test.ts | b42326c6d1f5 Add urgent roadside help from the driver portal. (b42326c6d1f5) |
| A | scripts/roadside-sms-flag.test.ts | 8b79616a4774 Turn roadside staff SMS into a hard-false constant. (origin/cursor/hard-false-flags-12af) |
| A | scripts/stalled-applications.test.ts | b175d63c7034 Add a manager-only Stalled Applications list, off by default. (b175d63c7034) |
| M | scripts/stripe-collections-server.test.ts | 2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8)<br>d60c69039edd Leave live Stripe Collections off the shared reader cache. (d60c69039edd) |
| A | scripts/stripe-match.test.ts | c99c63baafee Add a read-only Stripe to app match report. (c99c63baafee)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | scripts/stripe-match.vitest.config.ts | c99c63baafee Add a read-only Stripe to app match report. (c99c63baafee) |
| A | scripts/stripe-payout-recon.test.ts | d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0) |
| A | scripts/stripe-payout-recon.vitest.config.ts | d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0) |
| A | scripts/stripe-reader.test.ts | 2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8)<br>d60c69039edd Leave live Stripe Collections off the shared reader cache. (d60c69039edd)<br>095c2a8c4d22 Route partner statement charges through the read-only Stripe client. (095c2a8c4d22)<br>921824c4bc1d Add an optional Stripe cross-check to Deposit Ledger. (921824c4bc1d)<br>f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04)<br>a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9)<br>d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0)<br>132bab5108e7 Subtract Stripe processing fees on Monthly Owner P&L. (132bab5108e7)<br>8c7b0ca7d71c Close the RC13 review gaps and add an opt-in guard mode. (8c7b0ca7d71c)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | scripts/stripe-reader.vitest.config.ts | 2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8) |
| A | scripts/stripe-risk-monitor.test.ts | a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9) |
| A | scripts/stripe-risk-monitor.vitest.config.ts | a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9) |
| A | scripts/tax-export.test.ts | fa2fd5ad3c99 Add a read-only Tax Year Export that stays off. (fa2fd5ad3c99) |
| A | scripts/tax-export.vitest.config.ts | fa2fd5ad3c99 Add a read-only Tax Year Export that stays off. (fa2fd5ad3c99) |
| A | scripts/todays-ops.test.ts | fef7d2cada3f Add a dark Today's Ops board for managers. (fef7d2cada3f) |
| A | scripts/tolls-tickets-ledger.test.ts | 90d29bfbf5cb Add a dark Tolls And Tickets ledger. (90d29bfbf5cb) |
| M | scripts/unified-finance-live.test.ts | 94235dffb7a7 Verify operating expenses and keep compensation blank. (94235dffb7a7)<br>7dfda150aacf Add a dark Renewal Due list for managers. (7dfda150aacf) |
| A | scripts/unified-finance-operating.test.ts | 94235dffb7a7 Verify operating expenses and keep compensation blank. (94235dffb7a7) |
| A | scripts/upload-precheck.test.ts | b3a7b3523046 Add a flag-off upload quality pre-check on apply Documents. (b3a7b3523046)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126) |
| A | scripts/vehicle-detail.test.ts | 489b1b10e21e Add a flag-gated public vehicle detail page. (489b1b10e21e)<br>4239ccd2c653 Import the RC12 feature flags from their lib modules. (4239ccd2c653) |
| A | scripts/vehicle-profitability.test.ts | bd18221173c7 Add a dark per-vehicle profitability and JV report. (bd18221173c7)<br>b1a8ce126aaf Report vehicle profit from collected payments and keep it off. (b1a8ce126aaf) |
| A | scripts/vehicle-profitability.vitest.config.ts | bd18221173c7 Add a dark per-vehicle profitability and JV report. (bd18221173c7) |
| M | scripts/vehicle-readiness-phase1.test.mjs | a6792f19fbfe Allow the flag-gated Turnaround readiness caller in the phase-1 guard. (a6792f19fbfe) |
| M | scripts/vehicle-readiness.test.ts | a6df305cdfe8 Pin three baseline tests that fail outside the RC diffs. (a6df305cdfe8) |
| M | scripts/vehicle-swap.test.cjs | 49d4e234e67e Find local Postgres for the swap test without a versioned path. (origin/cursor/pg-bin-local-tests-8871) |
| A | scripts/vehicle-turnaround.test.ts | 73bc6ebb562f Add a dark Vehicle Turnaround board for managers. (73bc6ebb562f) |
| A | scripts/weekly-cash-flow.test.ts | ccb103b234b3 Add a read-only Weekly Cash Flow under Payments. (ccb103b234b3)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | scripts/weekly-cash-flow.vitest.config.ts | ccb103b234b3 Add a read-only Weekly Cash Flow under Payments. (ccb103b234b3) |
| A | src/components/admin/AccountantExportPanel.tsx | 2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b)<br>b63548ffd3a6 Load Stripe fees into the accountant year export. (b63548ffd3a6) |
| A | src/components/admin/ActiveRentalsPanel.tsx | c3d84cfe5d05 Add a read-only Active Rentals board for managers. (c3d84cfe5d05) |
| A | src/components/admin/ApplicantFunnelPanel.tsx | 4afab0e9022d Add a dark, read-only applicant funnel for managers. (4afab0e9022d) |
| A | src/components/admin/ApplicationQuickReview.tsx | 178071086339 Add a read-only application quick review behind a default-off flag. (178071086339)<br>cff56f56cae5 Refresh an expired quick-review document link through the vault list. (cff56f56cae5) |
| A | src/components/admin/ApprovedNotRenting.tsx | e25ec28b7344 Add an Approved, Not Yet Renting funnel for managers. (e25ec28b7344) |
| M | src/components/admin/AutomationsPanel.tsx | 0ebddd0f86cd Show managers which active renters have documents expiring. (0ebddd0f86cd) |
| A | src/components/admin/BillingHealthPanel.tsx | 325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50) |
| M | src/components/admin/BookingActions.tsx | 313708b226db Add a manager return checklist that stays off. (313708b226db) |
| M | src/components/admin/BookingDetails.tsx | f99968fcc8d0 Add a dark Closeout Summary on an open rental. (f99968fcc8d0) |
| A | src/components/admin/CloseoutSummary.tsx | f99968fcc8d0 Add a dark Closeout Summary on an open rental. (f99968fcc8d0) |
| A | src/components/admin/CollectionsWatchPanel.tsx | bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb) |
| M | src/components/admin/ContactStatusCell.tsx | e25ec28b7344 Add an Approved, Not Yet Renting funnel for managers. (e25ec28b7344)<br>b175d63c7034 Add a manager-only Stalled Applications list, off by default. (b175d63c7034) |
| A | src/components/admin/DepositLedgerPanel.tsx | 6d22063e6b9e Add a read-only Deposit Ledger that stays off. (origin/cursor/deposit-ledger-12af)<br>921824c4bc1d Add an optional Stripe cross-check to Deposit Ledger. (921824c4bc1d) |
| A | src/components/admin/DepositsLedgerPanel.tsx | d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1) |
| M | src/components/admin/DocumentVault.tsx | 4cd9b92e31a9 Add a read-only pickup checklist behind a default-off flag. (4cd9b92e31a9)<br>178071086339 Add a read-only application quick review behind a default-off flag. (178071086339)<br>ead4c08364a3 Add a dark, read-only Notices list to the driver portal. (ead4c08364a3) |
| A | src/components/admin/DocumentsExpiring.tsx | 0ebddd0f86cd Show managers which active renters have documents expiring. (0ebddd0f86cd)<br>673484011784 Include approved drivers when no rental row exists. (673484011784) |
| M | src/components/admin/DriverIssuesPanel.tsx | b42326c6d1f5 Add urgent roadside help from the driver portal. (b42326c6d1f5) |
| A | src/components/admin/DriverStatement.tsx | 8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d) |
| M | src/components/admin/DriversPanel.tsx | 0ebddd0f86cd Show managers which active renters have documents expiring. (0ebddd0f86cd)<br>673484011784 Include approved drivers when no rental row exists. (673484011784)<br>e25ec28b7344 Add an Approved, Not Yet Renting funnel for managers. (e25ec28b7344)<br>8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d)<br>b175d63c7034 Add a manager-only Stalled Applications list, off by default. (b175d63c7034)<br>178071086339 Add a read-only application quick review behind a default-off flag. (178071086339)<br>cff56f56cae5 Refresh an expired quick-review document link through the vault list. (cff56f56cae5) |
| A | src/components/admin/ExpenseCategoriesPanel.tsx | c81647dc95bb Add a dark expense category summary. (c81647dc95bb) |
| A | src/components/admin/FinanceDataQualityPanel.tsx | cb519fa8f8ee Add a read-only Finance Data Quality report that stays off. (cb519fa8f8ee) |
| A | src/components/admin/FinanceDepositLedgerPanel.tsx | 3dd0cf93fb40 Add a read-only Deposit Ledger report that stays off. (3dd0cf93fb40) |
| A | src/components/admin/FleetAvailability.tsx | 4b96bb255e99 Add a dark Fleet Availability board. (4b96bb255e99) |
| A | src/components/admin/FleetCalendar.tsx | f6439e5315ae Add a dark Fleet Calendar for managers. (f6439e5315ae) |
| A | src/components/admin/IncidentBoard.tsx | b29d011243f2 Add a dark Incident Board for open incidents. (b29d011243f2) |
| A | src/components/admin/LeadFollowUpDraft.tsx | f28586671f62 Add a dark staff draft for due Lead Priorities follow-ups. (origin/cursor/lead-followups-029f) |
| M | src/components/admin/LeadPriorities.tsx | f28586671f62 Add a dark staff draft for due Lead Priorities follow-ups. (origin/cursor/lead-followups-029f) |
| A | src/components/admin/MaintenanceDue.tsx | d31c15adea2e Add a dark Maintenance Due view on Vehicles. (d31c15adea2e) |
| A | src/components/admin/MaintenanceLog.tsx | e3d40e01d0ae Add a dark maintenance log and service reminders. (e3d40e01d0ae) |
| M | src/components/admin/OverviewPanel.tsx | 0ebddd0f86cd Show managers which active renters have documents expiring. (0ebddd0f86cd)<br>fef7d2cada3f Add a dark Today's Ops board for managers. (fef7d2cada3f)<br>e3d40e01d0ae Add a dark maintenance log and service reminders. (e3d40e01d0ae) |
| A | src/components/admin/OwnerExpenseEntryPanel.tsx | 7ab92c99ad77 Add owner expense entry behind a default-off constant. (7ab92c99ad77) |
| A | src/components/admin/OwnerFinanceSnapshotPanel.tsx | 37a0990eb634 Add a read-only Owner Weekly Finance Snapshot that stays off. (37a0990eb634)<br>f23e02954e16 Wire the weekly snapshot tiles to the RC9 readers. (f23e02954e16) |
| A | src/components/admin/OwnerPnlPanel.tsx | 00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9)<br>1e30e448476c Keep Monthly Owner P&L as the only P&L screen. (1e30e448476c)<br>423aebb4b114 Count recorded cash and app payments on Monthly Owner P&L. (423aebb4b114)<br>132bab5108e7 Subtract Stripe processing fees on Monthly Owner P&L. (132bab5108e7) |
| A | src/components/admin/PartnerStatementPanel.tsx | f77549b510f1 Add a read-only Partner Statement behind a default-off flag. (f77549b510f1) |
| M | src/components/admin/PaymentsPanel.tsx | fef7d2cada3f Add a dark Today's Ops board for managers. (fef7d2cada3f) |
| A | src/components/admin/PayoutBreakdownPanel.tsx | 05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c) |
| A | src/components/admin/ReceivablesAgingPanel.tsx | 1e9b99def8d2 Add a read-only Receivables Aging screen that stays off. (1e9b99def8d2) |
| A | src/components/admin/RenewalsDue.tsx | 7dfda150aacf Add a dark Renewal Due list for managers. (7dfda150aacf) |
| A | src/components/admin/RentAgingPanel.tsx | ffe11653e5dc Add a read-only Rent Aging report that stays off. (ffe11653e5dc) |
| A | src/components/admin/RentReconciliationPanel.tsx | f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04) |
| A | src/components/admin/ReturnCloseoutFields.tsx | 313708b226db Add a manager return checklist that stays off. (313708b226db) |
| A | src/components/admin/RevenueForecastPanel.tsx | 8932feeb630a Add an owner-only 4-week revenue forecast behind a hard-off flag. (8932feeb630a) |
| A | src/components/admin/StalledApplications.tsx | b175d63c7034 Add a manager-only Stalled Applications list, off by default. (b175d63c7034) |
| A | src/components/admin/StripeMatchPanel.tsx | c99c63baafee Add a read-only Stripe to app match report. (c99c63baafee) |
| A | src/components/admin/StripePayoutReconPanel.tsx | d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0) |
| A | src/components/admin/StripeRiskMonitorPanel.tsx | a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9) |
| A | src/components/admin/TaxExportPanel.tsx | fa2fd5ad3c99 Add a read-only Tax Year Export that stays off. (fa2fd5ad3c99) |
| A | src/components/admin/TodaysOps.tsx | fef7d2cada3f Add a dark Today's Ops board for managers. (fef7d2cada3f) |
| A | src/components/admin/TollsTickets.tsx | 90d29bfbf5cb Add a dark Tolls And Tickets ledger. (90d29bfbf5cb) |
| M | src/components/admin/UnifiedFinancePanel.tsx | 94235dffb7a7 Verify operating expenses and keep compensation blank. (94235dffb7a7) |
| M | src/components/admin/VehicleProfile.tsx | e3d40e01d0ae Add a dark maintenance log and service reminders. (e3d40e01d0ae) |
| A | src/components/admin/VehicleProfitPanel.tsx | bd18221173c7 Add a dark per-vehicle profitability and JV report. (bd18221173c7)<br>b1a8ce126aaf Report vehicle profit from collected payments and keep it off. (b1a8ce126aaf) |
| A | src/components/admin/VehicleTurnaround.tsx | 73bc6ebb562f Add a dark Vehicle Turnaround board for managers. (73bc6ebb562f) |
| M | src/components/admin/VehiclesPanel.tsx | d31c15adea2e Add a dark Maintenance Due view on Vehicles. (d31c15adea2e)<br>e3d40e01d0ae Add a dark maintenance log and service reminders. (e3d40e01d0ae)<br>47b5b93ffbf5 Keep the fleet empty state and the maintenance due prop on RC13. (47b5b93ffbf5) |
| A | src/components/admin/WeeklyCashFlowPanel.tsx | ccb103b234b3 Add a read-only Weekly Cash Flow under Payments. (ccb103b234b3) |
| M | src/components/admin/nav-config.ts | c3d84cfe5d05 Add a read-only Active Rentals board for managers. (c3d84cfe5d05)<br>c99c63baafee Add a read-only Stripe to app match report. (c99c63baafee)<br>bd18221173c7 Add a dark per-vehicle profitability and JV report. (bd18221173c7)<br>bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb)<br>d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1)<br>b29d011243f2 Add a dark Incident Board for open incidents. (b29d011243f2)<br>ccb103b234b3 Add a read-only Weekly Cash Flow under Payments. (ccb103b234b3)<br>4b96bb255e99 Add a dark Fleet Availability board. (4b96bb255e99)<br>f77549b510f1 Add a read-only Partner Statement behind a default-off flag. (f77549b510f1)<br>00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9)<br>7ab92c99ad77 Add owner expense entry behind a default-off constant. (7ab92c99ad77)<br>2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b)<br>05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c)<br>325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50)<br>4afab0e9022d Add a dark, read-only applicant funnel for managers. (4afab0e9022d)<br>fef7d2cada3f Add a dark Today's Ops board for managers. (fef7d2cada3f)<br>8932feeb630a Add an owner-only 4-week revenue forecast behind a hard-off flag. (8932feeb630a)<br>f6439e5315ae Add a dark Fleet Calendar for managers. (f6439e5315ae)<br>1e9b99def8d2 Add a read-only Receivables Aging screen that stays off. (1e9b99def8d2)<br>6d22063e6b9e Add a read-only Deposit Ledger that stays off. (origin/cursor/deposit-ledger-12af)<br>73bc6ebb562f Add a dark Vehicle Turnaround board for managers. (73bc6ebb562f)<br>f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04)<br>37a0990eb634 Add a read-only Owner Weekly Finance Snapshot that stays off. (37a0990eb634)<br>a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9)<br>7dfda150aacf Add a dark Renewal Due list for managers. (7dfda150aacf)<br>d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0)<br>b1a8ce126aaf Report vehicle profit from collected payments and keep it off. (b1a8ce126aaf)<br>fa2fd5ad3c99 Add a read-only Tax Year Export that stays off. (fa2fd5ad3c99)<br>cb519fa8f8ee Add a read-only Finance Data Quality report that stays off. (cb519fa8f8ee)<br>ffe11653e5dc Add a read-only Rent Aging report that stays off. (ffe11653e5dc)<br>3dd0cf93fb40 Add a read-only Deposit Ledger report that stays off. (3dd0cf93fb40)<br>90d29bfbf5cb Add a dark Tolls And Tickets ledger. (90d29bfbf5cb)<br>c81647dc95bb Add a dark expense category summary. (c81647dc95bb) |
| M | src/components/portal/ApplicantHome.tsx | fce19f7dd18c Add a gated application status timeline for applicants. (fce19f7dd18c)<br>ddba201e27a9 Add a dark, read-only application status tracker. (ddba201e27a9) |
| A | src/components/portal/ApplicationStatusTracker.tsx | ddba201e27a9 Add a dark, read-only application status tracker. (ddba201e27a9) |
| A | src/components/portal/ApplicationTimeline.tsx | fce19f7dd18c Add a gated application status timeline for applicants. (fce19f7dd18c) |
| A | src/components/portal/DocumentUpdateCard.tsx | 3626f35761a2 Add a gated portal card for an expiring or missing license or insurance. (3626f35761a2) |
| A | src/components/portal/DriverAgreementCard.tsx | 2828d7f9f996 Add a flag-off My Agreement card for the driver portal. (2828d7f9f996) |
| A | src/components/portal/DriverDocExpiryCard.tsx | ed27010222f0 Add a flag-off My Documents expiry card for drivers. (ed27010222f0) |
| A | src/components/portal/DriverHelp.tsx | dcc1ce627f8b Add a dark, static driver help page. (dcc1ce627f8b) |
| A | src/components/portal/DriverPaymentHistoryCard.tsx | f0426f9c686b Add a flag-gated driver payment history card. (f0426f9c686b) |
| A | src/components/portal/DriverReceipts.tsx | 7b57f8ad35d3 Add a dark, read-only payment history and receipt for drivers. (7b57f8ad35d3) |
| A | src/components/portal/DriverRoadside.tsx | 29e21c7cc920 Add a static Roadside Help page behind a hard-off flag. (29e21c7cc920) |
| A | src/components/portal/MyCarCard.tsx | 29e21c7cc920 Add a static Roadside Help page behind a hard-off flag. (29e21c7cc920) |
| A | src/components/portal/MyRentalCard.tsx | ac133bc7d964 Add a gated read-only My Rental card on the driver dashboard. (ac133bc7d964) |
| A | src/components/portal/NextStepsCard.tsx | 3c3af9d1b07c Add a gated Your Next Steps card and fix a bare thank-you page. (3c3af9d1b07c)<br>aaf5712e8e6e Use the business phone for the pickup line. (aaf5712e8e6e) |
| A | src/components/portal/PaymentHistoryCard.tsx | 694a2150dd4c Add a gated read-only payment history card on the driver dashboard. (694a2150dd4c) |
| A | src/components/portal/PickupChecklistCard.tsx | 4cd9b92e31a9 Add a read-only pickup checklist behind a default-off flag. (4cd9b92e31a9)<br>5968c9fbc3cc Add a pickup readiness checklist behind a hard-false flag. (5968c9fbc3cc) |
| A | src/components/portal/PickupReadinessCard.tsx |  |
| A | src/components/portal/PortalNotices.tsx | ead4c08364a3 Add a dark, read-only Notices list to the driver portal. (ead4c08364a3) |
| A | src/components/portal/RenterPaymentBanner.tsx | 94ba4351d48a Add a read-only renter payment banner, off by default. (94ba4351d48a) |
| M | src/components/site/ApplicationWizard.tsx | 0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b)<br>66e8666cbd7a Add a flag-off progress indicator for the apply flow. (66e8666cbd7a)<br>b3a7b3523046 Add a flag-off upload quality pre-check on apply Documents. (b3a7b3523046)<br>ea7bcb109ba5 Add a flag-gated preferred vehicle on apply. (ea7bcb109ba5)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126)<br>4239ccd2c653 Import the RC12 feature flags from their lib modules. (4239ccd2c653) |
| A | src/components/site/ApplyProgress.tsx | 66e8666cbd7a Add a flag-off progress indicator for the apply flow. (66e8666cbd7a) |
| A | src/components/site/ApplyVehiclePrefill.tsx | ea7bcb109ba5 Add a flag-gated preferred vehicle on apply. (ea7bcb109ba5) |
| M | src/components/site/DocumentCapture.tsx | b3a7b3523046 Add a flag-off upload quality pre-check on apply Documents. (b3a7b3523046)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126) |
| A | src/components/site/FleetFiltersBar.tsx | a575a6484b8a Add flag-gated filters and sorting on the public fleet page. (a575a6484b8a) |
| M | src/components/site/Footer.tsx | 0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b) |
| M | src/components/site/HeroQuoteBar.tsx | 0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b) |
| M | src/components/site/Nav.tsx | 0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b) |
| A | src/components/site/PublicAvailability.tsx | 8ecdae247788 Add public fleet availability badges behind a hard-off flag. (8ecdae247788) |
| M | src/components/site/SmsConsentField.tsx | 0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b) |
| M | src/components/site/StickyCallBar.tsx | 0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b) |
| A | src/components/site/UploadPrecheckNotice.tsx | b3a7b3523046 Add a flag-off upload quality pre-check on apply Documents. (b3a7b3523046) |
| M | src/components/site/VehicleCard.tsx | 489b1b10e21e Add a flag-gated public vehicle detail page. (489b1b10e21e)<br>4239ccd2c653 Import the RC12 feature flags from their lib modules. (4239ccd2c653) |
| A | src/components/site/VehicleDetailView.tsx | 489b1b10e21e Add a flag-gated public vehicle detail page. (489b1b10e21e) |
| M | src/components/site/WelcomeBack.tsx | 3c3af9d1b07c Add a gated Your Next Steps card and fix a bare thank-you page. (3c3af9d1b07c)<br>0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b) |
| M | src/lib/AGENTS.md | 94235dffb7a7 Verify operating expenses and keep compensation blank. (94235dffb7a7)<br>c99c63baafee Add a read-only Stripe to app match report. (c99c63baafee)<br>bd18221173c7 Add a dark per-vehicle profitability and JV report. (bd18221173c7)<br>bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb)<br>d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1)<br>8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d)<br>ccb103b234b3 Add a read-only Weekly Cash Flow under Payments. (ccb103b234b3)<br>2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8)<br>d60c69039edd Leave live Stripe Collections off the shared reader cache. (d60c69039edd)<br>f77549b510f1 Add a read-only Partner Statement behind a default-off flag. (f77549b510f1)<br>00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9)<br>7ab92c99ad77 Add owner expense entry behind a default-off constant. (7ab92c99ad77)<br>2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b)<br>05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c)<br>325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50)<br>8932feeb630a Add an owner-only 4-week revenue forecast behind a hard-off flag. (8932feeb630a)<br>095c2a8c4d22 Route partner statement charges through the read-only Stripe client. (095c2a8c4d22)<br>1e9b99def8d2 Add a read-only Receivables Aging screen that stays off. (1e9b99def8d2)<br>6d22063e6b9e Add a read-only Deposit Ledger that stays off. (origin/cursor/deposit-ledger-12af)<br>921824c4bc1d Add an optional Stripe cross-check to Deposit Ledger. (921824c4bc1d)<br>f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04)<br>37a0990eb634 Add a read-only Owner Weekly Finance Snapshot that stays off. (37a0990eb634)<br>a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9)<br>f23e02954e16 Wire the weekly snapshot tiles to the RC9 readers. (f23e02954e16)<br>d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0)<br>b1a8ce126aaf Report vehicle profit from collected payments and keep it off. (b1a8ce126aaf)<br>fa2fd5ad3c99 Add a read-only Tax Year Export that stays off. (fa2fd5ad3c99)<br>cb519fa8f8ee Add a read-only Finance Data Quality report that stays off. (cb519fa8f8ee)<br>ffe11653e5dc Add a read-only Rent Aging report that stays off. (ffe11653e5dc)<br>3dd0cf93fb40 Add a read-only Deposit Ledger report that stays off. (3dd0cf93fb40)<br>1e30e448476c Keep Monthly Owner P&L as the only P&L screen. (1e30e448476c)<br>423aebb4b114 Count recorded cash and app payments on Monthly Owner P&L. (423aebb4b114)<br>132bab5108e7 Subtract Stripe processing fees on Monthly Owner P&L. (132bab5108e7)<br>b63548ffd3a6 Load Stripe fees into the accountant year export. (b63548ffd3a6)<br>c81647dc95bb Add a dark expense category summary. (c81647dc95bb)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/accountant-export-flag.ts | 2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b) |
| A | src/lib/accountant-export.functions.ts | 2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b)<br>b63548ffd3a6 Load Stripe fees into the accountant year export. (b63548ffd3a6) |
| A | src/lib/accountant-export.server.ts | 2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b)<br>423aebb4b114 Count recorded cash and app payments on Monthly Owner P&L. (423aebb4b114)<br>b63548ffd3a6 Load Stripe fees into the accountant year export. (b63548ffd3a6) |
| A | src/lib/accountant-export.ts | 2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b)<br>b63548ffd3a6 Load Stripe fees into the accountant year export. (b63548ffd3a6) |
| A | src/lib/active-rentals.functions.ts | c3d84cfe5d05 Add a read-only Active Rentals board for managers. (c3d84cfe5d05) |
| A | src/lib/active-rentals.ts | c3d84cfe5d05 Add a read-only Active Rentals board for managers. (c3d84cfe5d05) |
| A | src/lib/applicant-funnel.functions.ts | 4afab0e9022d Add a dark, read-only applicant funnel for managers. (4afab0e9022d) |
| A | src/lib/applicant-funnel.ts | 4afab0e9022d Add a dark, read-only applicant funnel for managers. (4afab0e9022d) |
| A | src/lib/application-quick-review.functions.ts | 178071086339 Add a read-only application quick review behind a default-off flag. (178071086339) |
| A | src/lib/application-quick-review.ts | 178071086339 Add a read-only application quick review behind a default-off flag. (178071086339) |
| A | src/lib/application-status-tracker.functions.ts | ddba201e27a9 Add a dark, read-only application status tracker. (ddba201e27a9) |
| A | src/lib/application-status-tracker.ts | ddba201e27a9 Add a dark, read-only application status tracker. (ddba201e27a9) |
| A | src/lib/application-timeline.functions.ts | fce19f7dd18c Add a gated application status timeline for applicants. (fce19f7dd18c) |
| A | src/lib/application-timeline.ts | fce19f7dd18c Add a gated application status timeline for applicants. (fce19f7dd18c) |
| A | src/lib/apply-progress.ts | 66e8666cbd7a Add a flag-off progress indicator for the apply flow. (66e8666cbd7a)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126) |
| A | src/lib/apply-vehicle-prefill.ts | ea7bcb109ba5 Add a flag-gated preferred vehicle on apply. (ea7bcb109ba5)<br>4239ccd2c653 Import the RC12 feature flags from their lib modules. (4239ccd2c653) |
| M | src/lib/automations.server.ts | 0ebddd0f86cd Show managers which active renters have documents expiring. (0ebddd0f86cd) |
| A | src/lib/billing-health-flag.ts | 325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50) |
| A | src/lib/billing-health-read.server.ts | 325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50) |
| A | src/lib/billing-health.functions.ts | 325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50) |
| A | src/lib/billing-health.server.ts | 325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50) |
| A | src/lib/billing-health.ts | 325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50) |
| A | src/lib/booking-funnel.functions.ts | e25ec28b7344 Add an Approved, Not Yet Renting funnel for managers. (e25ec28b7344) |
| A | src/lib/booking-funnel.ts | e25ec28b7344 Add an Approved, Not Yet Renting funnel for managers. (e25ec28b7344) |
| A | src/lib/closeout-summary.functions.ts | f99968fcc8d0 Add a dark Closeout Summary on an open rental. (f99968fcc8d0) |
| A | src/lib/closeout-summary.ts | f99968fcc8d0 Add a dark Closeout Summary on an open rental. (f99968fcc8d0) |
| A | src/lib/collections-watch-flag.ts | bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/collections-watch-read.server.ts | bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb)<br>2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8)<br>d60c69039edd Leave live Stripe Collections off the shared reader cache. (d60c69039edd) |
| A | src/lib/collections-watch.functions.ts | bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/collections-watch.server.ts | bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb) |
| A | src/lib/collections-watch.ts | bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb)<br>fef7d2cada3f Add a dark Today's Ops board for managers. (fef7d2cada3f) |
| A | src/lib/deposit-ledger-flag.ts | 6d22063e6b9e Add a read-only Deposit Ledger that stays off. (origin/cursor/deposit-ledger-12af) |
| A | src/lib/deposit-ledger-stripe.server.ts | 921824c4bc1d Add an optional Stripe cross-check to Deposit Ledger. (921824c4bc1d) |
| A | src/lib/deposit-ledger.functions.ts | 6d22063e6b9e Add a read-only Deposit Ledger that stays off. (origin/cursor/deposit-ledger-12af)<br>921824c4bc1d Add an optional Stripe cross-check to Deposit Ledger. (921824c4bc1d) |
| A | src/lib/deposit-ledger.server.ts | 6d22063e6b9e Add a read-only Deposit Ledger that stays off. (origin/cursor/deposit-ledger-12af)<br>921824c4bc1d Add an optional Stripe cross-check to Deposit Ledger. (921824c4bc1d) |
| A | src/lib/deposit-ledger.ts | 6d22063e6b9e Add a read-only Deposit Ledger that stays off. (origin/cursor/deposit-ledger-12af)<br>921824c4bc1d Add an optional Stripe cross-check to Deposit Ledger. (921824c4bc1d) |
| A | src/lib/deposits-ledger-flag.ts | d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/deposits-ledger-read.server.ts | d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1)<br>2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8)<br>d60c69039edd Leave live Stripe Collections off the shared reader cache. (d60c69039edd) |
| A | src/lib/deposits-ledger.functions.ts | d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/deposits-ledger.server.ts | d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1) |
| A | src/lib/deposits-ledger.ts | d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1) |
| A | src/lib/document-expiry-flag.ts | 6f01aefe34e9 Turn document expiry notices into a hard-false constant. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/document-expiry.functions.ts | 0ebddd0f86cd Show managers which active renters have documents expiring. (0ebddd0f86cd)<br>673484011784 Include approved drivers when no rental row exists. (673484011784) |
| A | src/lib/document-expiry.server.ts | 0ebddd0f86cd Show managers which active renters have documents expiring. (0ebddd0f86cd)<br>673484011784 Include approved drivers when no rental row exists. (673484011784)<br>6f01aefe34e9 Turn document expiry notices into a hard-false constant. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/document-expiry.ts | 0ebddd0f86cd Show managers which active renters have documents expiring. (0ebddd0f86cd)<br>673484011784 Include approved drivers when no rental row exists. (673484011784)<br>4cd9b92e31a9 Add a read-only pickup checklist behind a default-off flag. (4cd9b92e31a9)<br>178071086339 Add a read-only application quick review behind a default-off flag. (178071086339)<br>ead4c08364a3 Add a dark, read-only Notices list to the driver portal. (ead4c08364a3) |
| A | src/lib/driver-agreement-view.functions.ts | 2828d7f9f996 Add a flag-off My Agreement card for the driver portal. (2828d7f9f996) |
| A | src/lib/driver-agreement-view.ts | 2828d7f9f996 Add a flag-off My Agreement card for the driver portal. (2828d7f9f996)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126) |
| A | src/lib/driver-doc-expiry.functions.ts | ed27010222f0 Add a flag-off My Documents expiry card for drivers. (ed27010222f0) |
| A | src/lib/driver-doc-expiry.ts | ed27010222f0 Add a flag-off My Documents expiry card for drivers. (ed27010222f0)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126) |
| A | src/lib/driver-help.ts | dcc1ce627f8b Add a dark, static driver help page. (dcc1ce627f8b) |
| M | src/lib/driver-issue-alert.server.ts | b42326c6d1f5 Add urgent roadside help from the driver portal. (b42326c6d1f5)<br>8b79616a4774 Turn roadside staff SMS into a hard-false constant. (origin/cursor/hard-false-flags-12af) |
| M | src/lib/driver-issues.functions.ts | b42326c6d1f5 Add urgent roadside help from the driver portal. (b42326c6d1f5) |
| M | src/lib/driver-issues.ts | b42326c6d1f5 Add urgent roadside help from the driver portal. (b42326c6d1f5) |
| A | src/lib/driver-payment-history.functions.ts | f0426f9c686b Add a flag-gated driver payment history card. (f0426f9c686b) |
| A | src/lib/driver-payment-history.ts | f0426f9c686b Add a flag-gated driver payment history card. (f0426f9c686b)<br>4239ccd2c653 Import the RC12 feature flags from their lib modules. (4239ccd2c653) |
| A | src/lib/driver-receipts.functions.ts | 7b57f8ad35d3 Add a dark, read-only payment history and receipt for drivers. (7b57f8ad35d3)<br>2b3eb2d83737 Use the site brand on driver receipts. (2b3eb2d83737) |
| A | src/lib/driver-receipts.ts | 7b57f8ad35d3 Add a dark, read-only payment history and receipt for drivers. (7b57f8ad35d3)<br>2b3eb2d83737 Use the site brand on driver receipts. (2b3eb2d83737) |
| A | src/lib/driver-roadside.ts | 29e21c7cc920 Add a static Roadside Help page behind a hard-off flag. (29e21c7cc920) |
| A | src/lib/driver-statement-flag.ts | 8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/driver-statement-read.server.ts | 8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d)<br>2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8)<br>d60c69039edd Leave live Stripe Collections off the shared reader cache. (d60c69039edd) |
| A | src/lib/driver-statement.functions.ts | 8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/driver-statement.server.ts | 8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d) |
| A | src/lib/driver-statement.ts | 8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d) |
| A | src/lib/expense-categories-flag.ts | c81647dc95bb Add a dark expense category summary. (c81647dc95bb) |
| A | src/lib/expense-categories.functions.ts | c81647dc95bb Add a dark expense category summary. (c81647dc95bb) |
| A | src/lib/expense-categories.server.ts | c81647dc95bb Add a dark expense category summary. (c81647dc95bb) |
| A | src/lib/expense-categories.ts | c81647dc95bb Add a dark expense category summary. (c81647dc95bb) |
| A | src/lib/finance-data-quality-flag.ts | cb519fa8f8ee Add a read-only Finance Data Quality report that stays off. (cb519fa8f8ee) |
| A | src/lib/finance-data-quality.functions.ts | cb519fa8f8ee Add a read-only Finance Data Quality report that stays off. (cb519fa8f8ee) |
| A | src/lib/finance-data-quality.server.ts | cb519fa8f8ee Add a read-only Finance Data Quality report that stays off. (cb519fa8f8ee) |
| A | src/lib/finance-data-quality.ts | cb519fa8f8ee Add a read-only Finance Data Quality report that stays off. (cb519fa8f8ee) |
| A | src/lib/finance-deposit-ledger-flag.ts | 3dd0cf93fb40 Add a read-only Deposit Ledger report that stays off. (3dd0cf93fb40) |
| A | src/lib/finance-deposit-ledger.functions.ts | 3dd0cf93fb40 Add a read-only Deposit Ledger report that stays off. (3dd0cf93fb40) |
| A | src/lib/finance-deposit-ledger.server.ts | 3dd0cf93fb40 Add a read-only Deposit Ledger report that stays off. (3dd0cf93fb40) |
| A | src/lib/finance-deposit-ledger.ts | 3dd0cf93fb40 Add a read-only Deposit Ledger report that stays off. (3dd0cf93fb40) |
| A | src/lib/finance-monthly-pl.ts | 1e30e448476c Keep Monthly Owner P&L as the only P&L screen. (1e30e448476c) |
| A | src/lib/fleet-availability.functions.ts | 4b96bb255e99 Add a dark Fleet Availability board. (4b96bb255e99) |
| A | src/lib/fleet-availability.ts | 4b96bb255e99 Add a dark Fleet Availability board. (4b96bb255e99) |
| A | src/lib/fleet-calendar-flag.ts | f6439e5315ae Add a dark Fleet Calendar for managers. (f6439e5315ae) |
| A | src/lib/fleet-calendar.functions.ts | f6439e5315ae Add a dark Fleet Calendar for managers. (f6439e5315ae)<br>e54597eaa6a5 Stop Fleet Calendar from interpolating PostgREST filters. (e54597eaa6a5) |
| A | src/lib/fleet-calendar.ts | f6439e5315ae Add a dark Fleet Calendar for managers. (f6439e5315ae) |
| A | src/lib/fleet-filters.ts | a575a6484b8a Add flag-gated filters and sorting on the public fleet page. (a575a6484b8a) |
| A | src/lib/incident-board.functions.ts | b29d011243f2 Add a dark Incident Board for open incidents. (b29d011243f2) |
| A | src/lib/incident-board.ts | b29d011243f2 Add a dark Incident Board for open incidents. (b29d011243f2) |
| A | src/lib/lead-followups.functions.ts | f28586671f62 Add a dark staff draft for due Lead Priorities follow-ups. (origin/cursor/lead-followups-029f)<br>97377cf840c8 Refuse lead follow-up drafts before auth and the role check. (origin/cursor/lead-followups-029f) |
| A | src/lib/lead-followups.ts | f28586671f62 Add a dark staff draft for due Lead Priorities follow-ups. (origin/cursor/lead-followups-029f)<br>97377cf840c8 Refuse lead follow-up drafts before auth and the role check. (origin/cursor/lead-followups-029f) |
| A | src/lib/maintenance-due.functions.ts | d31c15adea2e Add a dark Maintenance Due view on Vehicles. (d31c15adea2e) |
| A | src/lib/maintenance-due.ts | d31c15adea2e Add a dark Maintenance Due view on Vehicles. (d31c15adea2e) |
| A | src/lib/maintenance-log-flag.ts | e3d40e01d0ae Add a dark maintenance log and service reminders. (e3d40e01d0ae) |
| A | src/lib/maintenance-log.functions.ts | e3d40e01d0ae Add a dark maintenance log and service reminders. (e3d40e01d0ae)<br>8c7b0ca7d71c Close the RC13 review gaps and add an opt-in guard mode. (8c7b0ca7d71c)<br>3f8d0b0404a9 Fix the maintenance-log missing-relation check and the RC guard. (3f8d0b0404a9) |
| A | src/lib/maintenance-log.ts | e3d40e01d0ae Add a dark maintenance log and service reminders. (e3d40e01d0ae)<br>3f8d0b0404a9 Fix the maintenance-log missing-relation check and the RC guard. (3f8d0b0404a9) |
| A | src/lib/my-car-card.functions.ts | 29e21c7cc920 Add a static Roadside Help page behind a hard-off flag. (29e21c7cc920) |
| A | src/lib/my-car-card.ts | 29e21c7cc920 Add a static Roadside Help page behind a hard-off flag. (29e21c7cc920) |
| A | src/lib/next-steps.functions.ts | 3c3af9d1b07c Add a gated Your Next Steps card and fix a bare thank-you page. (3c3af9d1b07c) |
| A | src/lib/next-steps.ts | 3c3af9d1b07c Add a gated Your Next Steps card and fix a bare thank-you page. (3c3af9d1b07c)<br>aaf5712e8e6e Use the business phone for the pickup line. (aaf5712e8e6e) |
| A | src/lib/owner-expense-entry-flag.ts | 7ab92c99ad77 Add owner expense entry behind a default-off constant. (7ab92c99ad77) |
| A | src/lib/owner-expense-entry.functions.ts | 7ab92c99ad77 Add owner expense entry behind a default-off constant. (7ab92c99ad77) |
| A | src/lib/owner-expense-entry.server.ts | 7ab92c99ad77 Add owner expense entry behind a default-off constant. (7ab92c99ad77) |
| A | src/lib/owner-expense-entry.ts | 7ab92c99ad77 Add owner expense entry behind a default-off constant. (7ab92c99ad77) |
| A | src/lib/owner-finance-snapshot-flag.ts | 37a0990eb634 Add a read-only Owner Weekly Finance Snapshot that stays off. (37a0990eb634) |
| A | src/lib/owner-finance-snapshot.functions.ts | 37a0990eb634 Add a read-only Owner Weekly Finance Snapshot that stays off. (37a0990eb634)<br>f23e02954e16 Wire the weekly snapshot tiles to the RC9 readers. (f23e02954e16) |
| A | src/lib/owner-finance-snapshot.server.ts | 37a0990eb634 Add a read-only Owner Weekly Finance Snapshot that stays off. (37a0990eb634)<br>f23e02954e16 Wire the weekly snapshot tiles to the RC9 readers. (f23e02954e16) |
| A | src/lib/owner-finance-snapshot.ts | 37a0990eb634 Add a read-only Owner Weekly Finance Snapshot that stays off. (37a0990eb634)<br>f23e02954e16 Wire the weekly snapshot tiles to the RC9 readers. (f23e02954e16) |
| A | src/lib/owner-pnl-fees-read.server.ts | 132bab5108e7 Subtract Stripe processing fees on Monthly Owner P&L. (132bab5108e7) |
| A | src/lib/owner-pnl-fees.ts | 132bab5108e7 Subtract Stripe processing fees on Monthly Owner P&L. (132bab5108e7) |
| A | src/lib/owner-pnl-flag.ts | 00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9) |
| A | src/lib/owner-pnl.functions.ts | 00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9)<br>132bab5108e7 Subtract Stripe processing fees on Monthly Owner P&L. (132bab5108e7) |
| A | src/lib/owner-pnl.server.ts | 00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9)<br>2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b)<br>423aebb4b114 Count recorded cash and app payments on Monthly Owner P&L. (423aebb4b114)<br>132bab5108e7 Subtract Stripe processing fees on Monthly Owner P&L. (132bab5108e7) |
| A | src/lib/owner-pnl.ts | 00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9)<br>423aebb4b114 Count recorded cash and app payments on Monthly Owner P&L. (423aebb4b114)<br>132bab5108e7 Subtract Stripe processing fees on Monthly Owner P&L. (132bab5108e7) |
| A | src/lib/partner-statement-flag.ts | f77549b510f1 Add a read-only Partner Statement behind a default-off flag. (f77549b510f1) |
| A | src/lib/partner-statement-read.server.ts | f77549b510f1 Add a read-only Partner Statement behind a default-off flag. (f77549b510f1)<br>00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9)<br>2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b)<br>095c2a8c4d22 Route partner statement charges through the read-only Stripe client. (095c2a8c4d22)<br>423aebb4b114 Count recorded cash and app payments on Monthly Owner P&L. (423aebb4b114) |
| A | src/lib/partner-statement.functions.ts | f77549b510f1 Add a read-only Partner Statement behind a default-off flag. (f77549b510f1) |
| A | src/lib/partner-statement.server.ts | f77549b510f1 Add a read-only Partner Statement behind a default-off flag. (f77549b510f1) |
| A | src/lib/partner-statement.ts | f77549b510f1 Add a read-only Partner Statement behind a default-off flag. (f77549b510f1)<br>00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9)<br>423aebb4b114 Count recorded cash and app payments on Monthly Owner P&L. (423aebb4b114) |
| A | src/lib/payout-breakdown-flag.ts | 05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c) |
| A | src/lib/payout-breakdown-read.server.ts | 05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c) |
| A | src/lib/payout-breakdown.functions.ts | 05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c) |
| A | src/lib/payout-breakdown.server.ts | 05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c) |
| A | src/lib/payout-breakdown.ts | 05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c) |
| A | src/lib/pickup-checklist-client.ts | 5968c9fbc3cc Add a pickup readiness checklist behind a hard-false flag. (5968c9fbc3cc) |
| A | src/lib/pickup-checklist.ts | 5968c9fbc3cc Add a pickup readiness checklist behind a hard-false flag. (5968c9fbc3cc) |
| A | src/lib/portal-document-update.functions.ts | 3626f35761a2 Add a gated portal card for an expiring or missing license or insurance. (3626f35761a2) |
| A | src/lib/portal-document-update.ts | 3626f35761a2 Add a gated portal card for an expiring or missing license or insurance. (3626f35761a2) |
| A | src/lib/portal-my-rental.functions.ts | ac133bc7d964 Add a gated read-only My Rental card on the driver dashboard. (ac133bc7d964) |
| A | src/lib/portal-my-rental.ts | ac133bc7d964 Add a gated read-only My Rental card on the driver dashboard. (ac133bc7d964) |
| A | src/lib/portal-notices.functions.ts | ead4c08364a3 Add a dark, read-only Notices list to the driver portal. (ead4c08364a3) |
| A | src/lib/portal-notices.ts | ead4c08364a3 Add a dark, read-only Notices list to the driver portal. (ead4c08364a3) |
| A | src/lib/portal-payment-history.functions.ts | 694a2150dd4c Add a gated read-only payment history card on the driver dashboard. (694a2150dd4c) |
| A | src/lib/portal-payment-history.ts | 694a2150dd4c Add a gated read-only payment history card on the driver dashboard. (694a2150dd4c) |
| A | src/lib/portal-pickup-checklist.functions.ts | 4cd9b92e31a9 Add a read-only pickup checklist behind a default-off flag. (4cd9b92e31a9) |
| A | src/lib/portal-pickup-checklist.ts | 4cd9b92e31a9 Add a read-only pickup checklist behind a default-off flag. (4cd9b92e31a9) |
| M | src/lib/portal.functions.ts | b42326c6d1f5 Add urgent roadside help from the driver portal. (b42326c6d1f5)<br>94ba4351d48a Add a read-only renter payment banner, off by default. (94ba4351d48a) |
| A | src/lib/public-availability.ts | 8ecdae247788 Add public fleet availability badges behind a hard-off flag. (8ecdae247788) |
| A | src/lib/receivables-aging-flag.ts | 1e9b99def8d2 Add a read-only Receivables Aging screen that stays off. (1e9b99def8d2) |
| A | src/lib/receivables-aging.functions.ts | 1e9b99def8d2 Add a read-only Receivables Aging screen that stays off. (1e9b99def8d2) |
| A | src/lib/receivables-aging.server.ts | 1e9b99def8d2 Add a read-only Receivables Aging screen that stays off. (1e9b99def8d2) |
| A | src/lib/receivables-aging.ts | 1e9b99def8d2 Add a read-only Receivables Aging screen that stays off. (1e9b99def8d2) |
| A | src/lib/renewals-due-flag.ts | 7dfda150aacf Add a dark Renewal Due list for managers. (7dfda150aacf) |
| A | src/lib/renewals-due.functions.ts | 7dfda150aacf Add a dark Renewal Due list for managers. (7dfda150aacf) |
| A | src/lib/renewals-due.ts | 7dfda150aacf Add a dark Renewal Due list for managers. (7dfda150aacf) |
| A | src/lib/rent-aging-flag.ts | ffe11653e5dc Add a read-only Rent Aging report that stays off. (ffe11653e5dc) |
| A | src/lib/rent-aging.functions.ts | ffe11653e5dc Add a read-only Rent Aging report that stays off. (ffe11653e5dc) |
| A | src/lib/rent-aging.server.ts | ffe11653e5dc Add a read-only Rent Aging report that stays off. (ffe11653e5dc) |
| A | src/lib/rent-aging.ts | ffe11653e5dc Add a read-only Rent Aging report that stays off. (ffe11653e5dc) |
| A | src/lib/rent-reconciliation-flag.ts | f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04) |
| A | src/lib/rent-reconciliation-stripe.server.ts | f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04) |
| A | src/lib/rent-reconciliation.functions.ts | f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04) |
| A | src/lib/rent-reconciliation.server.ts | f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04) |
| A | src/lib/rent-reconciliation.ts | f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04) |
| A | src/lib/renter-payment-banner.ts | 94ba4351d48a Add a read-only renter payment banner, off by default. (94ba4351d48a) |
| M | src/lib/resume-token.ts | c61c81fc3d65 Send /apply resume links to /thank-you before the token is stripped. (c61c81fc3d65) |
| A | src/lib/return-checklist.functions.ts | 313708b226db Add a manager return checklist that stays off. (313708b226db) |
| A | src/lib/return-checklist.ts | 313708b226db Add a manager return checklist that stays off. (313708b226db) |
| A | src/lib/revenue-forecast-flag.ts | 8932feeb630a Add an owner-only 4-week revenue forecast behind a hard-off flag. (8932feeb630a) |
| A | src/lib/revenue-forecast.functions.ts | 8932feeb630a Add an owner-only 4-week revenue forecast behind a hard-off flag. (8932feeb630a) |
| A | src/lib/revenue-forecast.server.ts | 8932feeb630a Add an owner-only 4-week revenue forecast behind a hard-off flag. (8932feeb630a) |
| A | src/lib/revenue-forecast.ts | 8932feeb630a Add an owner-only 4-week revenue forecast behind a hard-off flag. (8932feeb630a) |
| A | src/lib/roadside-sms-flag.ts | 8b79616a4774 Turn roadside staff SMS into a hard-false constant. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/secure-link-copy.ts | 3c3af9d1b07c Add a gated Your Next Steps card and fix a bare thank-you page. (3c3af9d1b07c) |
| A | src/lib/stalled-applications.functions.ts | b175d63c7034 Add a manager-only Stalled Applications list, off by default. (b175d63c7034) |
| A | src/lib/stalled-applications.ts | b175d63c7034 Add a manager-only Stalled Applications list, off by default. (b175d63c7034) |
| M | src/lib/stripe-collections.server.ts | 2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8)<br>d60c69039edd Leave live Stripe Collections off the shared reader cache. (d60c69039edd) |
| M | src/lib/stripe-collections.ts | 2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8) |
| A | src/lib/stripe-driver-match.ts | bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb)<br>d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1)<br>8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d) |
| A | src/lib/stripe-match-flag.ts | c99c63baafee Add a read-only Stripe to app match report. (c99c63baafee)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/stripe-match-read.server.ts | c99c63baafee Add a read-only Stripe to app match report. (c99c63baafee)<br>2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8)<br>d60c69039edd Leave live Stripe Collections off the shared reader cache. (d60c69039edd) |
| A | src/lib/stripe-match.functions.ts | c99c63baafee Add a read-only Stripe to app match report. (c99c63baafee)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/stripe-match.server.ts | c99c63baafee Add a read-only Stripe to app match report. (c99c63baafee)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/stripe-match.ts | c99c63baafee Add a read-only Stripe to app match report. (c99c63baafee) |
| A | src/lib/stripe-payout-recon-flag.ts | d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0) |
| A | src/lib/stripe-payout-recon-read.server.ts | d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0) |
| A | src/lib/stripe-payout-recon.functions.ts | d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0) |
| A | src/lib/stripe-payout-recon.server.ts | d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0) |
| A | src/lib/stripe-payout-recon.ts | d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0) |
| A | src/lib/stripe-reader.server.ts | 2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8)<br>d60c69039edd Leave live Stripe Collections off the shared reader cache. (d60c69039edd)<br>c00fb23c79b6 Annotate the shared Stripe reader callback so tsc accepts it. (c00fb23c79b6)<br>05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c)<br>325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50) |
| A | src/lib/stripe-reader.ts | 2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8) |
| A | src/lib/stripe-risk-monitor-flag.ts | a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9) |
| A | src/lib/stripe-risk-monitor-read.server.ts | a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9) |
| A | src/lib/stripe-risk-monitor.functions.ts | a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9) |
| A | src/lib/stripe-risk-monitor.server.ts | a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9) |
| A | src/lib/stripe-risk-monitor.ts | a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9) |
| M | src/lib/stripe.server.ts | 2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8) |
| A | src/lib/tax-export-flag.ts | fa2fd5ad3c99 Add a read-only Tax Year Export that stays off. (fa2fd5ad3c99) |
| A | src/lib/tax-export.functions.ts | fa2fd5ad3c99 Add a read-only Tax Year Export that stays off. (fa2fd5ad3c99) |
| A | src/lib/tax-export.server.ts | fa2fd5ad3c99 Add a read-only Tax Year Export that stays off. (fa2fd5ad3c99) |
| A | src/lib/tax-export.ts | fa2fd5ad3c99 Add a read-only Tax Year Export that stays off. (fa2fd5ad3c99) |
| A | src/lib/todays-ops-flag.ts | fef7d2cada3f Add a dark Today's Ops board for managers. (fef7d2cada3f) |
| A | src/lib/todays-ops.functions.ts | fef7d2cada3f Add a dark Today's Ops board for managers. (fef7d2cada3f) |
| A | src/lib/todays-ops.ts | fef7d2cada3f Add a dark Today's Ops board for managers. (fef7d2cada3f) |
| A | src/lib/tolls-tickets-flag.ts | 90d29bfbf5cb Add a dark Tolls And Tickets ledger. (90d29bfbf5cb) |
| A | src/lib/tolls-tickets.functions.ts | 90d29bfbf5cb Add a dark Tolls And Tickets ledger. (90d29bfbf5cb) |
| A | src/lib/tolls-tickets.ts | 90d29bfbf5cb Add a dark Tolls And Tickets ledger. (90d29bfbf5cb) |
| M | src/lib/unified-finance-contract.ts | 94235dffb7a7 Verify operating expenses and keep compensation blank. (94235dffb7a7) |
| M | src/lib/unified-finance-live.server.ts | 94235dffb7a7 Verify operating expenses and keep compensation blank. (94235dffb7a7) |
| A | src/lib/unified-finance-operating.ts | 94235dffb7a7 Verify operating expenses and keep compensation blank. (94235dffb7a7) |
| M | src/lib/unified-finance-verified.ts | 94235dffb7a7 Verify operating expenses and keep compensation blank. (94235dffb7a7) |
| A | src/lib/upload-precheck.ts | b3a7b3523046 Add a flag-off upload quality pre-check on apply Documents. (b3a7b3523046)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126) |
| A | src/lib/vault-signed-url.ts | cff56f56cae5 Refresh an expired quick-review document link through the vault list. (cff56f56cae5) |
| A | src/lib/vehicle-detail.ts | 489b1b10e21e Add a flag-gated public vehicle detail page. (489b1b10e21e)<br>4239ccd2c653 Import the RC12 feature flags from their lib modules. (4239ccd2c653) |
| M | src/lib/vehicle-docs.functions.ts | fef7d2cada3f Add a dark Today's Ops board for managers. (fef7d2cada3f) |
| A | src/lib/vehicle-profitability-flag.ts | bd18221173c7 Add a dark per-vehicle profitability and JV report. (bd18221173c7)<br>b1a8ce126aaf Report vehicle profit from collected payments and keep it off. (b1a8ce126aaf) |
| A | src/lib/vehicle-profitability.functions.ts | bd18221173c7 Add a dark per-vehicle profitability and JV report. (bd18221173c7)<br>b1a8ce126aaf Report vehicle profit from collected payments and keep it off. (b1a8ce126aaf) |
| A | src/lib/vehicle-profitability.server.ts | bd18221173c7 Add a dark per-vehicle profitability and JV report. (bd18221173c7)<br>b1a8ce126aaf Report vehicle profit from collected payments and keep it off. (b1a8ce126aaf) |
| A | src/lib/vehicle-profitability.ts | bd18221173c7 Add a dark per-vehicle profitability and JV report. (bd18221173c7)<br>b1a8ce126aaf Report vehicle profit from collected payments and keep it off. (b1a8ce126aaf) |
| A | src/lib/vehicle-turnaround-flag.ts | 73bc6ebb562f Add a dark Vehicle Turnaround board for managers. (73bc6ebb562f) |
| A | src/lib/vehicle-turnaround.functions.ts | 73bc6ebb562f Add a dark Vehicle Turnaround board for managers. (73bc6ebb562f) |
| A | src/lib/vehicle-turnaround.ts | 73bc6ebb562f Add a dark Vehicle Turnaround board for managers. (73bc6ebb562f) |
| A | src/lib/weekly-cash-flow-flag.ts | ccb103b234b3 Add a read-only Weekly Cash Flow under Payments. (ccb103b234b3)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/weekly-cash-flow-read.server.ts | ccb103b234b3 Add a read-only Weekly Cash Flow under Payments. (ccb103b234b3)<br>2b45b8aad9f8 Route Stripe readers through one list and retrieve client. (2b45b8aad9f8)<br>d60c69039edd Leave live Stripe Collections off the shared reader cache. (d60c69039edd) |
| A | src/lib/weekly-cash-flow.functions.ts | ccb103b234b3 Add a read-only Weekly Cash Flow under Payments. (ccb103b234b3)<br>e99a529d2ea1 Make dark finance screens hard-false so an environment variable cannot turn them on. (origin/cursor/hard-false-flags-12af) |
| A | src/lib/weekly-cash-flow.server.ts | ccb103b234b3 Add a read-only Weekly Cash Flow under Payments. (ccb103b234b3) |
| A | src/lib/weekly-cash-flow.ts | ccb103b234b3 Add a read-only Weekly Cash Flow under Payments. (ccb103b234b3) |
| M | src/routeTree.gen.ts | dcc1ce627f8b Add a dark, static driver help page. (dcc1ce627f8b)<br>29e21c7cc920 Add a static Roadside Help page behind a hard-off flag. (29e21c7cc920)<br>489b1b10e21e Add a flag-gated public vehicle detail page. (489b1b10e21e) |
| M | src/routes/__root.tsx | 0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b) |
| M | src/routes/admin.tsx | c3d84cfe5d05 Add a read-only Active Rentals board for managers. (c3d84cfe5d05)<br>c99c63baafee Add a read-only Stripe to app match report. (c99c63baafee)<br>bd18221173c7 Add a dark per-vehicle profitability and JV report. (bd18221173c7)<br>bf242d5b44fb Add a read-only Collections Watch under Payments. (bf242d5b44fb)<br>d542246983a1 Add a read-only Deposits & Refunds Ledger under Payments. (d542246983a1)<br>d31c15adea2e Add a dark Maintenance Due view on Vehicles. (d31c15adea2e)<br>8ef7f8c5892d Add a read-only Driver Statement on the driver Payments tab. (8ef7f8c5892d)<br>b29d011243f2 Add a dark Incident Board for open incidents. (b29d011243f2)<br>ccb103b234b3 Add a read-only Weekly Cash Flow under Payments. (ccb103b234b3)<br>4b96bb255e99 Add a dark Fleet Availability board. (4b96bb255e99)<br>f77549b510f1 Add a read-only Partner Statement behind a default-off flag. (f77549b510f1)<br>00d86fac7fe9 Add a read-only Monthly Owner P&L behind a default-off flag. (00d86fac7fe9)<br>7ab92c99ad77 Add owner expense entry behind a default-off constant. (7ab92c99ad77)<br>2fff864d1d3b Add a read-only accountant year export behind a default-off flag. (2fff864d1d3b)<br>178071086339 Add a read-only application quick review behind a default-off flag. (178071086339)<br>05372f34076c Add a read-only Stripe payout breakdown behind a default-off flag. (05372f34076c)<br>325a05691c50 Add owner-only Billing Health behind a hard-off flag. (325a05691c50)<br>4afab0e9022d Add a dark, read-only applicant funnel for managers. (4afab0e9022d)<br>fef7d2cada3f Add a dark Today's Ops board for managers. (fef7d2cada3f)<br>8932feeb630a Add an owner-only 4-week revenue forecast behind a hard-off flag. (8932feeb630a)<br>f6439e5315ae Add a dark Fleet Calendar for managers. (f6439e5315ae)<br>1e9b99def8d2 Add a read-only Receivables Aging screen that stays off. (1e9b99def8d2)<br>6d22063e6b9e Add a read-only Deposit Ledger that stays off. (origin/cursor/deposit-ledger-12af)<br>73bc6ebb562f Add a dark Vehicle Turnaround board for managers. (73bc6ebb562f)<br>f86efa4ffe04 Add a read-only Rent Payment Reconciliation that stays off. (f86efa4ffe04)<br>37a0990eb634 Add a read-only Owner Weekly Finance Snapshot that stays off. (37a0990eb634)<br>a2cddd9b1dc9 Add a read-only Stripe Disputes & Failed-Payment Monitor that stays off. (a2cddd9b1dc9)<br>7dfda150aacf Add a dark Renewal Due list for managers. (7dfda150aacf)<br>d2c2b17b67f0 Add a read-only Stripe Payout Reconciliation that stays off. (d2c2b17b67f0)<br>fa2fd5ad3c99 Add a read-only Tax Year Export that stays off. (fa2fd5ad3c99)<br>cb519fa8f8ee Add a read-only Finance Data Quality report that stays off. (cb519fa8f8ee)<br>ffe11653e5dc Add a read-only Rent Aging report that stays off. (ffe11653e5dc)<br>3dd0cf93fb40 Add a read-only Deposit Ledger report that stays off. (3dd0cf93fb40)<br>90d29bfbf5cb Add a dark Tolls And Tickets ledger. (90d29bfbf5cb)<br>c81647dc95bb Add a dark expense category summary. (c81647dc95bb) |
| M | src/routes/api/public/cron/automations.ts | 0ebddd0f86cd Show managers which active renters have documents expiring. (0ebddd0f86cd)<br>6f01aefe34e9 Turn document expiry notices into a hard-false constant. (origin/cursor/hard-false-flags-12af) |
| M | src/routes/apply.tsx | c61c81fc3d65 Send /apply resume links to /thank-you before the token is stripped. (c61c81fc3d65)<br>0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b)<br>66e8666cbd7a Add a flag-off progress indicator for the apply flow. (66e8666cbd7a)<br>ea7bcb109ba5 Add a flag-gated preferred vehicle on apply. (ea7bcb109ba5)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126)<br>4239ccd2c653 Import the RC12 feature flags from their lib modules. (4239ccd2c653) |
| M | src/routes/fleet.$id.tsx | 8ecdae247788 Add public fleet availability badges behind a hard-off flag. (8ecdae247788) |
| M | src/routes/fleet.index.tsx | 8ecdae247788 Add public fleet availability badges behind a hard-off flag. (8ecdae247788)<br>a575a6484b8a Add flag-gated filters and sorting on the public fleet page. (a575a6484b8a)<br>47b5b93ffbf5 Keep the fleet empty state and the maintenance due prop on RC13. (47b5b93ffbf5)<br>8c7b0ca7d71c Close the RC13 review gaps and add an opt-in guard mode. (8c7b0ca7d71c) |
| M | src/routes/login.tsx | 0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b) |
| M | src/routes/portal.tsx | b42326c6d1f5 Add urgent roadside help from the driver portal. (b42326c6d1f5)<br>3c3af9d1b07c Add a gated Your Next Steps card and fix a bare thank-you page. (3c3af9d1b07c)<br>fce19f7dd18c Add a gated application status timeline for applicants. (fce19f7dd18c)<br>94ba4351d48a Add a read-only renter payment banner, off by default. (94ba4351d48a)<br>0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b)<br>3626f35761a2 Add a gated portal card for an expiring or missing license or insurance. (3626f35761a2)<br>ac133bc7d964 Add a gated read-only My Rental card on the driver dashboard. (ac133bc7d964)<br>694a2150dd4c Add a gated read-only payment history card on the driver dashboard. (694a2150dd4c)<br>4cd9b92e31a9 Add a read-only pickup checklist behind a default-off flag. (4cd9b92e31a9)<br>ead4c08364a3 Add a dark, read-only Notices list to the driver portal. (ead4c08364a3)<br>7b57f8ad35d3 Add a dark, read-only payment history and receipt for drivers. (7b57f8ad35d3)<br>dcc1ce627f8b Add a dark, static driver help page. (dcc1ce627f8b)<br>29e21c7cc920 Add a static Roadside Help page behind a hard-off flag. (29e21c7cc920)<br>ed27010222f0 Add a flag-off My Documents expiry card for drivers. (ed27010222f0)<br>2828d7f9f996 Add a flag-off My Agreement card for the driver portal. (2828d7f9f996)<br>f0426f9c686b Add a flag-gated driver payment history card. (f0426f9c686b)<br>c9afb1a06796 Give each feature flag one declaration and pin the current DriversPanel hash. (#126)<br>5968c9fbc3cc Add a pickup readiness checklist behind a hard-false flag. (5968c9fbc3cc) |
| A | src/routes/portal_.help.tsx | dcc1ce627f8b Add a dark, static driver help page. (dcc1ce627f8b) |
| A | src/routes/portal_.roadside.tsx | 29e21c7cc920 Add a static Roadside Help page behind a hard-off flag. (29e21c7cc920) |
| M | src/routes/thank-you.tsx | 3c3af9d1b07c Add a gated Your Next Steps card and fix a bare thank-you page. (3c3af9d1b07c) |
| A | src/routes/vehicles.$id.tsx | 489b1b10e21e Add a flag-gated public vehicle detail page. (489b1b10e21e)<br>4239ccd2c653 Import the RC12 feature flags from their lib modules. (4239ccd2c653) |
| M | src/styles.css | 0038e97f155b Make apply and the portal usable on a phone. (0038e97f155b) |

## Flags whose value changed

| Flag | From | To | Declarations |
| --- | --- | --- | --- |
| ACCOUNTANT_EXPORT_ENABLED | absent | false | src/lib/accountant-export-flag.ts: false |
| APPLICANT_FUNNEL_ENABLED | absent | false | src/lib/applicant-funnel.ts: false |
| APPLICATION_QUICK_REVIEW_ENABLED | absent | false | src/lib/application-quick-review.ts: false |
| APPLICATION_STATUS_TRACKER_ENABLED | absent | false | src/lib/application-status-tracker.ts: false |
| APPLICATION_TIMELINE_ENABLED | absent | false | src/lib/application-timeline.ts: false |
| APPLY_PROGRESS_ENABLED | absent | false | src/lib/apply-progress.ts: false |
| APPLY_VEHICLE_PREFILL_ENABLED | absent | false | src/lib/apply-vehicle-prefill.ts: false as boolean |
| BILLING_HEALTH_ENABLED | absent | false | src/lib/billing-health-flag.ts: false |
| CLOSEOUT_SUMMARY_ENABLED | absent | false | src/lib/closeout-summary.ts: false |
| COLLECTIONS_WATCH_ENABLED | absent | false | src/lib/collections-watch-flag.ts: false |
| DEPOSITS_LEDGER_ENABLED | absent | false | src/lib/deposits-ledger-flag.ts: false |
| DEPOSIT_LEDGER_ENABLED | absent | false | src/lib/deposit-ledger-flag.ts: false |
| DOCUMENT_EXPIRY_NOTICES_ENABLED | absent | false | src/lib/document-expiry-flag.ts: false |
| DRIVER_AGREEMENT_VIEW_ENABLED | absent | false | src/lib/driver-agreement-view.ts: false |
| DRIVER_DOC_EXPIRY_CARD_ENABLED | absent | false | src/lib/driver-doc-expiry.ts: false |
| DRIVER_HELP_ENABLED | absent | false | src/lib/driver-help.ts: false |
| DRIVER_PAYMENT_HISTORY_ENABLED | absent | false | src/lib/driver-payment-history.ts: false as boolean |
| DRIVER_RECEIPTS_ENABLED | absent | false | src/lib/driver-receipts.ts: false |
| DRIVER_ROADSIDE_ENABLED | absent | false | src/lib/driver-roadside.ts: false |
| DRIVER_STATEMENT_ENABLED | absent | false | src/lib/driver-statement-flag.ts: false |
| FINANCE_AR_AGING_ENABLED | absent | false | src/lib/rent-aging-flag.ts: false |
| FINANCE_DATA_QUALITY_ENABLED | absent | false | src/lib/finance-data-quality-flag.ts: false |
| FINANCE_DEPOSIT_LEDGER_ENABLED | absent | false | src/lib/finance-deposit-ledger-flag.ts: false |
| FINANCE_EXPENSE_CATEGORIES_ENABLED | absent | false | src/lib/expense-categories-flag.ts: false |
| FLEET_AVAILABILITY_ENABLED | absent | false | src/lib/fleet-availability.ts: false |
| FLEET_CALENDAR_ENABLED | absent | false | src/lib/fleet-calendar-flag.ts: false |
| FLEET_FILTERS_ENABLED | absent | false | src/lib/fleet-filters.ts: false as boolean |
| INCIDENT_BOARD_ENABLED | absent | false | src/lib/incident-board.ts: false |
| LEAD_FOLLOWUPS_ENABLED | absent | false | src/lib/lead-followups.ts: false |
| MAINTENANCE_DUE_ENABLED | absent | false | src/lib/maintenance-due.ts: false |
| MAINTENANCE_LOG_ENABLED | absent | false | src/lib/maintenance-log-flag.ts: false |
| MY_CAR_CARD_ENABLED | absent | false | src/lib/my-car-card.ts: false |
| NEXT_STEPS_CARD_ENABLED | absent | false | src/lib/next-steps.ts: false |
| OWNER_EXPENSE_ENTRY_ENABLED | absent | false | src/lib/owner-expense-entry-flag.ts: false |
| OWNER_FINANCE_SNAPSHOT_ENABLED | absent | false | src/lib/owner-finance-snapshot-flag.ts: false |
| OWNER_PNL_ENABLED | absent | false | src/lib/owner-pnl-flag.ts: false |
| PARTNER_STATEMENT_ENABLED | absent | false | src/lib/partner-statement-flag.ts: false |
| PAYOUT_BREAKDOWN_ENABLED | absent | false | src/lib/payout-breakdown-flag.ts: false |
| PICKUP_CHECKLIST_ENABLED | absent | false | src/lib/pickup-checklist.ts: false as boolean |
| PORTAL_DOCUMENT_UPDATE_ENABLED | absent | false | src/lib/portal-document-update.ts: false |
| PORTAL_MY_RENTAL_ENABLED | absent | false | src/lib/portal-my-rental.ts: false |
| PORTAL_NOTICES_ENABLED | absent | false | src/lib/portal-notices.ts: false |
| PORTAL_PAYMENT_HISTORY_ENABLED | absent | false | src/lib/portal-payment-history.ts: false |
| PORTAL_PICKUP_CHECKLIST_ENABLED | absent | false | src/lib/portal-pickup-checklist.ts: false |
| PUBLIC_AVAILABILITY_ENABLED | absent | false | src/lib/public-availability.ts: false |
| RECEIVABLES_AGING_ENABLED | absent | false | src/lib/receivables-aging-flag.ts: false |
| RENEWALS_DUE_ENABLED | absent | false | src/lib/renewals-due-flag.ts: false |
| RENTER_PAYMENT_BANNER_ENABLED | absent | false | src/lib/renter-payment-banner.ts: false |
| RENT_RECONCILIATION_ENABLED | absent | false | src/lib/rent-reconciliation-flag.ts: false |
| RETURN_CHECKLIST_ENABLED | absent | false | src/lib/return-checklist.ts: false |
| REVENUE_FORECAST_ENABLED | absent | false | src/lib/revenue-forecast-flag.ts: false |
| ROADSIDE_SMS_ALERTS_ENABLED | absent | false | src/lib/roadside-sms-flag.ts: false |
| STALLED_APPLICATIONS_ENABLED | absent | false | src/lib/stalled-applications.ts: false |
| STRIPE_MATCH_REPORT_ENABLED | absent | false | src/lib/stripe-match-flag.ts: false |
| STRIPE_PAYOUT_RECON_ENABLED | absent | false | src/lib/stripe-payout-recon-flag.ts: false |
| STRIPE_RISK_MONITOR_ENABLED | absent | false | src/lib/stripe-risk-monitor-flag.ts: false |
| TAX_EXPORT_ENABLED | absent | false | src/lib/tax-export-flag.ts: false |
| TODAYS_OPS_ENABLED | absent | false | src/lib/todays-ops-flag.ts: false |
| TOLLS_TICKETS_LEDGER_ENABLED | absent | false | src/lib/tolls-tickets-flag.ts: false |
| UPLOAD_PRECHECK_ENABLED | absent | false | src/lib/upload-precheck.ts: false |
| VEHICLE_DETAIL_PAGE_ENABLED | absent | false | src/lib/vehicle-detail.ts: false as boolean |
| VEHICLE_PROFITABILITY_ENABLED | absent | false | src/lib/vehicle-profitability-flag.ts: false |
| VEHICLE_TURNAROUND_ENABLED | absent | false | src/lib/vehicle-turnaround-flag.ts: false |
| WEEKLY_CASH_FLOW_ENABLED | absent | false | src/lib/weekly-cash-flow-flag.ts: false |

## All flags

Env reads are first. A name is an env read at a ref when one of its declarations there reads `process.env`.

Env reads at from: APPLICATION_RESUME_ATOMIC_ENABLED, DRIVER_ISSUE_ALERTS_ENABLED, RENTER_LIFECYCLE_NOTICES_ENABLED, STRIPE_RECONCILIATION_ENABLED.
Env reads at to: APPLICATION_RESUME_ATOMIC_ENABLED, DRIVER_ISSUE_ALERTS_ENABLED, RENTER_LIFECYCLE_NOTICES_ENABLED, STRIPE_RECONCILIATION_ENABLED.

### Env reads

| Flag | From | To | Declarations |
| --- | --- | --- | --- |
| APPLICATION_RESUME_ATOMIC_ENABLED | env | env | src/lib/application-recovery.server.ts: process.env.APPLICATION_RESUME_ATOMIC_ENABLED === "true"<br>src/lib/application-recovery.server.ts: process.env.APPLICATION_RESUME_ATOMIC_ENABLED === "true" |
| DRIVER_ISSUE_ALERTS_ENABLED | env | env | src/lib/driver-issue-alert.server.ts: process.env.DRIVER_ISSUE_ALERTS_ENABLED === "true"<br>src/lib/driver-issue-alert.server.ts: process.env.DRIVER_ISSUE_ALERTS_ENABLED === "true" |
| RENTER_LIFECYCLE_NOTICES_ENABLED | env | env | src/lib/incidents.functions.ts: process.env.RENTER_LIFECYCLE_NOTICES_ENABLED === "true"<br>src/lib/rentals.functions.ts: process.env.RENTER_LIFECYCLE_NOTICES_ENABLED === "true"<br>src/lib/renter-lifecycle-notices.server.ts: process.env.RENTER_LIFECYCLE_NOTICES_ENABLED === "true"<br>src/lib/incidents.functions.ts: process.env.RENTER_LIFECYCLE_NOTICES_ENABLED === "true"<br>src/lib/rentals.functions.ts: process.env.RENTER_LIFECYCLE_NOTICES_ENABLED === "true"<br>src/lib/renter-lifecycle-notices.server.ts: process.env.RENTER_LIFECYCLE_NOTICES_ENABLED === "true" |
| STRIPE_RECONCILIATION_ENABLED | env | env | src/lib/stripe-reconciliation.server.ts: process.env.STRIPE_RECONCILIATION_ENABLED !== 'true'<br>src/lib/stripe-reconciliation.server.ts: process.env.STRIPE_RECONCILIATION_ENABLED !== 'true' |

### Other *_ENABLED flags

| Flag | From | To | Declarations |
| --- | --- | --- | --- |
| ACCOUNTANT_EXPORT_ENABLED | absent | false | src/lib/accountant-export-flag.ts: false |
| APPLICANT_FUNNEL_ENABLED | absent | false | src/lib/applicant-funnel.ts: false |
| APPLICATION_QUICK_REVIEW_ENABLED | absent | false | src/lib/application-quick-review.ts: false |
| APPLICATION_STATUS_TRACKER_ENABLED | absent | false | src/lib/application-status-tracker.ts: false |
| APPLICATION_TIMELINE_ENABLED | absent | false | src/lib/application-timeline.ts: false |
| APPLY_PROGRESS_ENABLED | absent | false | src/lib/apply-progress.ts: false |
| APPLY_VEHICLE_PREFILL_ENABLED | absent | false | src/lib/apply-vehicle-prefill.ts: false as boolean |
| ARCHIVE_DELETION_GUARD_ENABLED | false | false | src/lib/record-rental-live-path.ts: false<br>src/lib/record-rental-live-path.ts: false |
| BILLING_HEALTH_ENABLED | absent | false | src/lib/billing-health-flag.ts: false |
| CLOSEOUT_SUMMARY_ENABLED | absent | false | src/lib/closeout-summary.ts: false |
| COLLECTIONS_WATCH_ENABLED | absent | false | src/lib/collections-watch-flag.ts: false |
| DEPOSIT_LEDGER_ENABLED | absent | false | src/lib/deposit-ledger-flag.ts: false |
| DEPOSITS_LEDGER_ENABLED | absent | false | src/lib/deposits-ledger-flag.ts: false |
| DOCUMENT_EXPIRY_NOTICES_ENABLED | absent | false | src/lib/document-expiry-flag.ts: false |
| DRIVER_AGREEMENT_VIEW_ENABLED | absent | false | src/lib/driver-agreement-view.ts: false |
| DRIVER_DOC_EXPIRY_CARD_ENABLED | absent | false | src/lib/driver-doc-expiry.ts: false |
| DRIVER_HELP_ENABLED | absent | false | src/lib/driver-help.ts: false |
| DRIVER_ISSUE_NOTES_ENABLED | false | false | src/lib/driver-issues.ts: false<br>src/lib/driver-issues.ts: false |
| DRIVER_PAYMENT_HISTORY_ENABLED | absent | false | src/lib/driver-payment-history.ts: false as boolean |
| DRIVER_RECEIPTS_ENABLED | absent | false | src/lib/driver-receipts.ts: false |
| DRIVER_ROADSIDE_ENABLED | absent | false | src/lib/driver-roadside.ts: false |
| DRIVER_STATEMENT_ENABLED | absent | false | src/lib/driver-statement-flag.ts: false |
| END_RENTAL_SAFE_V1_ENABLED | false | false | src/lib/record-rental-live-path.ts: false<br>src/lib/record-rental-live-path.ts: false |
| FINANCE_AR_AGING_ENABLED | absent | false | src/lib/rent-aging-flag.ts: false |
| FINANCE_DATA_QUALITY_ENABLED | absent | false | src/lib/finance-data-quality-flag.ts: false |
| FINANCE_DEPOSIT_LEDGER_ENABLED | absent | false | src/lib/finance-deposit-ledger-flag.ts: false |
| FINANCE_EXPENSE_CATEGORIES_ENABLED | absent | false | src/lib/expense-categories-flag.ts: false |
| FLEET_AVAILABILITY_ENABLED | absent | false | src/lib/fleet-availability.ts: false |
| FLEET_CALENDAR_ENABLED | absent | false | src/lib/fleet-calendar-flag.ts: false |
| FLEET_FILTERS_ENABLED | absent | false | src/lib/fleet-filters.ts: false as boolean |
| INCIDENT_BOARD_ENABLED | absent | false | src/lib/incident-board.ts: false |
| LEAD_FOLLOWUPS_ENABLED | absent | false | src/lib/lead-followups.ts: false |
| MAINTENANCE_DUE_ENABLED | absent | false | src/lib/maintenance-due.ts: false |
| MAINTENANCE_LOG_ENABLED | absent | false | src/lib/maintenance-log-flag.ts: false |
| MY_CAR_CARD_ENABLED | absent | false | src/lib/my-car-card.ts: false |
| NEXT_STEPS_CARD_ENABLED | absent | false | src/lib/next-steps.ts: false |
| OWNER_EXPENSE_ENTRY_ENABLED | absent | false | src/lib/owner-expense-entry-flag.ts: false |
| OWNER_FINANCE_SNAPSHOT_ENABLED | absent | false | src/lib/owner-finance-snapshot-flag.ts: false |
| OWNER_PNL_ENABLED | absent | false | src/lib/owner-pnl-flag.ts: false |
| PARTNER_STATEMENT_ENABLED | absent | false | src/lib/partner-statement-flag.ts: false |
| PAYOUT_BREAKDOWN_ENABLED | absent | false | src/lib/payout-breakdown-flag.ts: false |
| PICKUP_CHECKLIST_ENABLED | absent | false | src/lib/pickup-checklist.ts: false as boolean |
| PORTAL_DOCUMENT_UPDATE_ENABLED | absent | false | src/lib/portal-document-update.ts: false |
| PORTAL_MY_RENTAL_ENABLED | absent | false | src/lib/portal-my-rental.ts: false |
| PORTAL_NOTICES_ENABLED | absent | false | src/lib/portal-notices.ts: false |
| PORTAL_PAYMENT_HISTORY_ENABLED | absent | false | src/lib/portal-payment-history.ts: false |
| PORTAL_PICKUP_CHECKLIST_ENABLED | absent | false | src/lib/portal-pickup-checklist.ts: false |
| PUBLIC_AVAILABILITY_ENABLED | absent | false | src/lib/public-availability.ts: false |
| RECEIVABLES_AGING_ENABLED | absent | false | src/lib/receivables-aging-flag.ts: false |
| RECORD_RENTAL_CONTRACT_ENABLED | false | false | src/lib/record-rental-contract.ts: false<br>src/lib/record-rental-contract.ts: false |
| RENEWALS_DUE_ENABLED | absent | false | src/lib/renewals-due-flag.ts: false |
| RENT_RECONCILIATION_ENABLED | absent | false | src/lib/rent-reconciliation-flag.ts: false |
| RENTAL_SUBSCRIPTION_COORDINATION_ENABLED | false | false | src/lib/record-rental-live-path.ts: false<br>src/lib/record-rental-live-path.ts: false |
| RENTER_PAYMENT_BANNER_ENABLED | absent | false | src/lib/renter-payment-banner.ts: false |
| RETURN_CHECKLIST_ENABLED | absent | false | src/lib/return-checklist.ts: false |
| REVENUE_FORECAST_ENABLED | absent | false | src/lib/revenue-forecast-flag.ts: false |
| ROADSIDE_SMS_ALERTS_ENABLED | absent | false | src/lib/roadside-sms-flag.ts: false |
| SIGNED_ARCHIVE_V1_ENABLED | false | false | src/lib/record-rental-live-path.ts: false<br>src/lib/record-rental-live-path.ts: false |
| STALLED_APPLICATIONS_ENABLED | absent | false | src/lib/stalled-applications.ts: false |
| STRIPE_COLLECTIONS_ENABLED | true | true | src/lib/stripe-collections.ts: true<br>src/lib/stripe-collections.ts: true |
| STRIPE_MATCH_REPORT_ENABLED | absent | false | src/lib/stripe-match-flag.ts: false |
| STRIPE_PAYOUT_RECON_ENABLED | absent | false | src/lib/stripe-payout-recon-flag.ts: false |
| STRIPE_RISK_MONITOR_ENABLED | absent | false | src/lib/stripe-risk-monitor-flag.ts: false |
| STUDIO_ENABLED | false | false | src/lib/photo-enhance.browser.ts: false<br>src/lib/photo-enhance.browser.ts: false |
| SWAP_ENABLED | false | false | src/lib/record-numbers.ts: false<br>src/lib/record-numbers.ts: false |
| TAX_EXPORT_ENABLED | absent | false | src/lib/tax-export-flag.ts: false |
| TODAYS_OPS_ENABLED | absent | false | src/lib/todays-ops-flag.ts: false |
| TOLLS_TICKETS_LEDGER_ENABLED | absent | false | src/lib/tolls-tickets-flag.ts: false |
| UNIFIED_FINANCE_ENDPOINT_ENABLED | false | false | src/lib/unified-finance-flag.ts: false<br>src/lib/unified-finance-flag.ts: false |
| UPLOAD_PRECHECK_ENABLED | absent | false | src/lib/upload-precheck.ts: false |
| VEHICLE_DETAIL_PAGE_ENABLED | absent | false | src/lib/vehicle-detail.ts: false as boolean |
| VEHICLE_PROFITABILITY_ENABLED | absent | false | src/lib/vehicle-profitability-flag.ts: false |
| VEHICLE_TURNAROUND_ENABLED | absent | false | src/lib/vehicle-turnaround-flag.ts: false |
| WEEKLY_CASH_FLOW_ENABLED | absent | false | src/lib/weekly-cash-flow-flag.ts: false |

### Hard flags

Names that do not end in `_ENABLED`, declared as `true`, `false`, or an object of boolean literals.

| Flag | From | To | Declarations |
| --- | --- | --- | --- |
| MANUAL_PAYMENTS_LIVE | false | false | src/lib/manual-payments.ts: false<br>src/lib/manual-payments.ts: false |
| PAPER_RELEASE | false | false | src/lib/paper-release.ts: { visible: false, registration: false } as const<br>src/lib/paper-release.ts: { visible: false, registration: false } as const |
| STRIPE_COLLECTIONS_TEST_MODE | false | false | src/lib/stripe-collections.test-mode.ts: false<br>src/lib/stripe-collections.test-mode.ts: false |

## Server functions

### Added

- `getAccountantExport` in `src/lib/accountant-export.functions.ts`
- `listActiveRentals` in `src/lib/active-rentals.functions.ts`
- `getApplicantFunnel` in `src/lib/applicant-funnel.functions.ts`
- `getApplicationQuickReview` in `src/lib/application-quick-review.functions.ts`
- `getApplicationStatus` in `src/lib/application-status-tracker.functions.ts`
- `getMyApplicationTimeline` in `src/lib/application-timeline.functions.ts`
- `getBillingHealth` in `src/lib/billing-health.functions.ts`
- `listApprovedNotRenting` in `src/lib/booking-funnel.functions.ts`
- `getCloseoutSummary` in `src/lib/closeout-summary.functions.ts`
- `getCollectionsWatch` in `src/lib/collections-watch.functions.ts`
- `getDepositLedger` in `src/lib/deposit-ledger.functions.ts`
- `getDepositsLedger` in `src/lib/deposits-ledger.functions.ts`
- `listExpiringRenterDocuments` in `src/lib/document-expiry.functions.ts`
- `getDriverAgreementPdf` in `src/lib/driver-agreement-view.functions.ts`
- `getDriverAgreements` in `src/lib/driver-agreement-view.functions.ts`
- `getDriverDocExpiry` in `src/lib/driver-doc-expiry.functions.ts`
- `getDriverPaymentHistory` in `src/lib/driver-payment-history.functions.ts`
- `getDriverReceipts` in `src/lib/driver-receipts.functions.ts`
- `getDriverStatement` in `src/lib/driver-statement.functions.ts`
- `getExpenseCategories` in `src/lib/expense-categories.functions.ts`
- `getFinanceDataQuality` in `src/lib/finance-data-quality.functions.ts`
- `getFinanceDepositLedger` in `src/lib/finance-deposit-ledger.functions.ts`
- `listFleetAvailability` in `src/lib/fleet-availability.functions.ts`
- `getFleetCalendar` in `src/lib/fleet-calendar.functions.ts`
- `createIncidentBoard` in `src/lib/incident-board.functions.ts`
- `listIncidentBoard` in `src/lib/incident-board.functions.ts`
- `setIncidentBoardStatus` in `src/lib/incident-board.functions.ts`
- `prepareLeadFollowUp` in `src/lib/lead-followups.functions.ts`
- `listMaintenanceDue` in `src/lib/maintenance-due.functions.ts`
- `listMaintenanceLog` in `src/lib/maintenance-log.functions.ts`
- `getMyCar` in `src/lib/my-car-card.functions.ts`
- `getMyNextSteps` in `src/lib/next-steps.functions.ts`
- `createOwnerExpense` in `src/lib/owner-expense-entry.functions.ts`
- `listOwnerExpenseChoices` in `src/lib/owner-expense-entry.functions.ts`
- `getOwnerFinanceSnapshot` in `src/lib/owner-finance-snapshot.functions.ts`
- `getOwnerPnl` in `src/lib/owner-pnl.functions.ts`
- `getPartnerStatement` in `src/lib/partner-statement.functions.ts`
- `getPayoutBreakdown` in `src/lib/payout-breakdown.functions.ts`
- `getPortalDocumentUpdates` in `src/lib/portal-document-update.functions.ts`
- `getPortalMyRental` in `src/lib/portal-my-rental.functions.ts`
- `getPortalNotices` in `src/lib/portal-notices.functions.ts`
- `getPortalPaymentHistory` in `src/lib/portal-payment-history.functions.ts`
- `getPortalPickupChecklist` in `src/lib/portal-pickup-checklist.functions.ts`
- `getMyPaymentBanner` in `src/lib/portal.functions.ts`
- `getReceivablesAging` in `src/lib/receivables-aging.functions.ts`
- `getRenewalsDue` in `src/lib/renewals-due.functions.ts`
- `getRentAging` in `src/lib/rent-aging.functions.ts`
- `getRentReconciliation` in `src/lib/rent-reconciliation.functions.ts`
- `getReturnChecklist` in `src/lib/return-checklist.functions.ts`
- `saveReturnChecklist` in `src/lib/return-checklist.functions.ts`
- `getRevenueForecast` in `src/lib/revenue-forecast.functions.ts`
- `listStalledApplications` in `src/lib/stalled-applications.functions.ts`
- `getStripeMatchReport` in `src/lib/stripe-match.functions.ts`
- `getStripePayoutRecon` in `src/lib/stripe-payout-recon.functions.ts`
- `getStripeRiskMonitor` in `src/lib/stripe-risk-monitor.functions.ts`
- `getTaxExport` in `src/lib/tax-export.functions.ts`
- `getTodaysOps` in `src/lib/todays-ops.functions.ts`
- `getTollsTicketsLedger` in `src/lib/tolls-tickets.functions.ts`
- `getVehicleProfitReport` in `src/lib/vehicle-profitability.functions.ts`
- `getVehicleTurnaround` in `src/lib/vehicle-turnaround.functions.ts`
- `getWeeklyCashFlow` in `src/lib/weekly-cash-flow.functions.ts`

### Removed

None.

## New user-visible strings

Default mode keeps a string only when it has a space and an uppercase letter. Single-word JSX text and lowercase text are omitted. `--phrases loose` includes them.


Not compared. Pass `--bundle-from` and `--bundle-to`, or check out each ref in a worktree that already contains `.output/public`.
