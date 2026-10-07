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
- [ ] Coordinator cost privacy: structured fields stripped; Tests A/B expose amounts in warnings/descriptions and Maintenance original access; repairs await approval
- [x] Pickup/return mileage via rental tx, inspection reuse, Miles Driven, validation
- [x] Same-date ordering, net service cost (warranty/vendor credit), Overview Service card
- [x] Test A real receipts → Fleet Inbox Review; stopped without Apply (REPAIRS REQUIRED: separate proposals, conflicting extraction, missing payment cross-check)
- [x] Test B five originals → independent Review; both tests compared (REPAIRS REQUIRED: grouping, header/date/mileage extraction, reconciliation, privacy); no Apply or publication
- [ ] Real Coordinator session E2E (no Coordinator account exists)

## Phase 2A Repair — multi-file service transactions (preview only; no Apply, no publish)
- [ ] Real Coordinator session E2E of the privacy repair (no Coordinator account exists)
- [x] Service transaction model (group pages/duplicates/payment; one tx → one expense, one mileage)
- [x] Semantic extraction (mileage in/out, plate vs tag, advisor, year normalization, unit never from docs)
- [x] Operations grouping, full text, summary rows excluded, financial + payment reconciliation
- [x] Coordinator privacy: operational vs financial payloads; mixed-evidence file access blocked server + storage
- [x] Reprocess Test A + Test B from originals; stop at Review; report
