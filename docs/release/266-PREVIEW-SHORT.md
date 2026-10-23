# PR #266 — Preview walkthrough

Fifteen minutes. **Everything you click writes to the real database**, so look
and filter; don't create, send, charge or sign. **Never press Publish while the
preview is on this branch.**

**Switch:** Project settings → Git → branch picker → `integration/grok-baseline-2026-10-22`
→ wait for "In sync with GitHub". Commit should read `67b62664`.

Open production in a second tab and compare as you go.

## Does today's work still work?

- [ ] **Revenue** — the Overview totals match production. *(If one number differs, stop and tell me.)*
- [ ] **Payments** — the list looks right; paid, unpaid and refunded read the same as production.
- [ ] **Stripe Collections** — the screen loads and the rows still match real drivers.
- [ ] **Drivers** — the list filters, counts look sane, and a driver's detail panel opens.
- [ ] **Bookings** — the list loads and a booking opens.
- [ ] **Agreements** — an already-signed agreement opens and still shows as archived.

## Has anything appeared that shouldn't have?

- [ ] No new tab, button or card for: Record Rental, Vehicle Swap, Unmatched Stripe Payments, any P&L or finance report, Incident Board, Maintenance Log, Tolls & Tickets, or anything billing-related.
- [ ] The Payments screen has **no** "Link to Rental" button.

## The three new pages

- [ ] **Driver portal → Help** — reads correctly, and makes **no** promise about insurance coverage or about driving for Uber, Lyft or DoorDash.
- [ ] **Driver portal → Roadside** — loads, and offers no way to text staff.
- [ ] **A vehicle page** — a published car shows its photos. An unpublished car shows none.

## Two specific things

- [ ] **Thank-you page** — after a test application reaches it, Google Ads still records the conversion. *(The tag is unchanged in this release; this just confirms it.)*
- [ ] **Driver preview** — open a driver through Driver Preview and confirm you cannot act as them: no buttons that would send, sign or pay on their behalf.

## Finishing

- [ ] Switch the branch picker back to `codex/revenue-publication` and wait for "In sync".
- [ ] No records were created while you looked.

---

Anything that fails: tell me which box and what you saw. A failure is a fix and
another preview, not a publish with a caveat.

**Before you approve publishing**, I also need the environment-variable values —
see `266-env-flags.md`. That is the one thing I cannot check for you.
