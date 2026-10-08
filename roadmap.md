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

## Email-to-Evidence Phase 1 (preview only; not published)
- [x] Inbound email record, signed intake endpoint, attachment store/dedupe into Fleet Inbox, email card in Review
- [ ] Mail routing for inbox@ + receiving secret (blocked: user DNS/provider setup)
- [ ] Real forwarded-email E2E (blocked on routing)
- [ ] Body-only email fact extraction (deferred)

## Automated Fleet Intelligence (plan approved 2026-10-08)
- [x] Step A — background job queue, worker, retries/backoff/dead-letter, pause switch, live status (preview; worker live only after publish)
- [ ] Step B — payment confirmation type, reconciliation, expense dedupe (awaiting go-ahead after Step A review)
- [ ] Step C — match suggestions with evidence, nickname, indexes
- [ ] Step D — searchable server-side vehicle picker
- [ ] Step E — actionable de-duplicated notifications
- [ ] Step F — policy engine (Auto-File first; financial posting off)
- [ ] Step G — validation suite incl. 1,000-vehicle simulation
