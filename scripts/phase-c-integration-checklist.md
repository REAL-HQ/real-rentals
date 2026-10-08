# Manual Payments (Phase C) — Integration Checklist

Status: accepted; NOT applied; scheduler NOT enabled; Practice Mode stays on.

## Saved artifacts
- DB proposal: scripts/phase-c-manual-payments.proposed.sql (number unassigned)
- SQL regressions (rolled back): scripts/manual-payments.test.sql, scripts/manual-payments-expiry.test.sql
- Rules: src/lib/manual-payments.ts; tests: scripts/manual-payments-ui.test.ts
- UI: src/components/admin/ManualPaymentsWorkspace.tsx (Practice Mode)

## Dependencies
1. Codex migration 0022 (Application Resume) released and applied through its own approval.
2. Journal reconciled after 0022; Manual Payments takes the next free number (expected 0023). Never reuse/rewrite 0001–0022.
3. Receipts via components/FileUploader.tsx into private documents storage; receipt_document_id required per method rules.
4. Live Owner/Manager/Coordinator/Driver role tests (Coordinator account still needed).
5. Entry points: Driver Profile and rental detail open the same workspace filtered by driver/charge.
6. Step C1: c1_transaction_id reserved only; no automatic posting.
7. payments.net_collected unchanged in Stage 1; new reporting later separates Verified Cash, Pending, Outstanding, Accrual, Refunded/Reversed.

## Deployment sequence (each step needs separate approval)
1. Confirm 0022 applied; rename proposal to next number.
2. Rerun both rolled-back SQL tests against current schema.
3. Apply migration; rerun tests; verify grants (no browser writes to payment_collections).
4. Enable cron: collection_expire_due() every 5 minutes; verify one sweep.
5. Wire uploader + server functions; switch Practice Mode off behind a flag in preview; live role tests.
6. Publish only on explicit approval.
7. Stage 2 (later approval): revoke browser UPDATE/DELETE on payments.
