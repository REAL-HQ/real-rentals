# Vehicle Pricing Templates — Implementation Plan

## What already exists (reuse, do not duplicate)
- **Vehicle Defaults** is the pricing template system you described. It already has: weekly rate, monthly rate and deposit per body type; Owner-only editing with an audit trail; staff can view; Drivers have no access.
- Settings already shows the Vehicle Defaults panel.
- Add Vehicle and Quick Add pre-fill from the default for the chosen body type. They show "Company Default" as the source, let staff override, never overwrite a typed value, and leave values Not Set when no default exists.
- Defaults are copied onto the vehicle when it is created, so changing a default later never changes existing cars.
- Agreements use the rental's rate first, then the vehicle's rate. Sent and signed agreements keep a frozen copy. Templates are never read during agreement preparation.
- Body types are already defined (Sedan, SUV, Minivan (XL), Truck, Van and others).

## Gaps
1. **No values saved yet.** The defaults table is empty, so nothing pre-fills today. Fix: the Owner enters Sedan $350, SUV $375 and Minivan $400 in the existing panel. This is a settings entry, not a code change.
2. **Location.** The panel lives in Settings but not under a "Rentals" heading. Fix: rename or move it to Settings → Rentals → Vehicle Pricing. This is a display change only.
3. **Title upload and Fleet Inbox imports don't pre-fill.** Only manual Add Vehicle uses defaults. Fix: when a new vehicle is created from a title scan or an import, apply the same rule (blank fields only, body type known; otherwise leave Not Set and flag "Choose Body Type").
4. **Missing template features.** The spec asks for Active/Inactive, a deposit policy (None/Required/Waived), "Last Updated By" in the list, and custom categories like "Premium". The current table has one row per body type and no status or policy fields.
5. **Apply Template to existing vehicles.** Deferred, per the spec. Later it would be a per-vehicle preview with confirmation; no bulk changes.

## Database dependency
- Gaps 1–3 need **no migration**.
- Gap 4 needs a small, additive migration on the existing defaults table: an `active` flag, `deposit_policy`, `updated_by`, and optionally a free category label for "Premium". I would prepare it without applying it, numbered after Codex's 0022 and the eSign 0023, so provisionally 0024.
- Open question for gap 4: should "Premium" be a new body type, or a label that sits on top of an existing body type? Today, matching is strictly by body type, which avoids guessing.

## Safest sequence
1. You enter the three rates in the existing panel (or approve me entering them).
2. Settings → Rentals placement (no migration).
3. Pre-fill for title scan and imports on newly created vehicles only, with tests confirming existing vehicles, rentals and agreements are unchanged.
4. Prepare the migration for gap 4 and stop for approval.
5. Apply Template action, later and separately approved.

## Out of scope
No changes to existing vehicle rates, rentals or signed agreements. No changes to Application Resume, Identity Review, Codex branches, Manual Payments or Step C1. No publishing.
