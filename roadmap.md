# Roadmap

## Phase 0 — foundation repairs (verified; awaiting publish)
- [x] Payments: statuses/types match code; charge persists before collection; failed ≠ revenue; retries reuse the row; duplicate webhooks idempotent; refunds recorded
- [x] Atomic rental activation + end (one DB transaction), vehicle status guard
- [x] Agreement readiness validator (vehicle, real VIN, licence, contact, rate, deposit) + send block + fix links
- [x] Legacy signed agreement untouched; portal-success structural check
- [x] Authorization + mutation tests; report

## Backlog
- 12 pre-existing security linter warnings (classified; none critical)
- Agreement deposit falls back to the vehicle default when the renter has none set

## Paused / later
- Driver portal invitation E2E test (test 2) — paused during Phase 0
- Phase 1+ per audit (ledger, ROI, dock/nav, documents, Fleet Inbox, View-As)

## Phase 2A closure (preview only — not published)
- [x] Coordinator cost privacy (Fleet Inbox proposals/provenance, service, timeline)
- [x] Pickup/return mileage via rental tx, inspection reuse, Miles Driven, validation
- [x] Same-date ordering, net service cost (warranty/vendor credit), Overview Service card
- [ ] Real service receipt → Fleet Inbox Review (waiting on user's receipt)
- [ ] Real Coordinator session E2E (no Coordinator account exists)
