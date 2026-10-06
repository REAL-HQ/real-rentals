# Roadmap

## Phase 0 — foundation repairs (in progress)
- [ ] Payments: statuses/types match code; charge persists before collection; failed ≠ revenue; retries reuse the row; duplicate webhooks idempotent; refunds recorded
- [ ] Atomic rental activation + end (one DB transaction), vehicle status guard
- [ ] Agreement readiness validator (vehicle, real VIN, licence, contact, rate, deposit) + send block + fix links
- [ ] Legacy signed agreement untouched; portal-success structural check
- [ ] Authorization + mutation tests; report

## Paused / later
- Driver portal invitation E2E test (test 2) — paused during Phase 0
- Phase 1+ per audit (ledger, ROI, dock/nav, documents, Fleet Inbox, View-As)
