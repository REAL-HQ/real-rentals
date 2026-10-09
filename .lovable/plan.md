# eSign Multi-Template Library — Implementation Plan

## Two things need your answer before work starts
1. **The Insurance Required agreement (v1.10.2) is not in the uploads.** Only the No Insurance PDF is there. Please upload it.
2. **The version label doesn't match what the request describes.** The uploaded No Insurance PDF says **v1.6** in three places: the file name, the PDF title and the printed heading. Nothing in it says v1.10. Either a newer v1.10 file exists and needs uploading, or the display version should stay v1.6. Please confirm which.

## What can be reused as-is
- Signing engine (`esign.server.ts`: atomic claim/void, archive, SHA-256), signature/initials adoption, consent and audit evidence.
- PDF renderer (`esign-pdf.server.ts`) and structured layout format (`agreement-layout.ts`). Both templates use the same six-page table structure.
- Agreement Builder split-screen, live preview and Owner-only edit/approval controls.
- Prepare Agreement dialog, its merge data and blockers, the fingerprint-checked send, reservation fee and optional deposit rules.
- The template versioning proposal: name+version unique, body immutable after insert, approval status, content hash.
- Acknowledgments already come from the template layout (the `|i` rows), not from a fixed list of 13. Only the tests and UI copy that say "13" need to change.

## What needs changing
- **Template identity:** add a stable `template_key` (for example `no_insurance`, `insurance_required`) so each agreement family keeps its own version history. Add `insurance_required boolean` and `display_label`. Status values become Draft — Legal Review Required, Approved, and Retired.
- **Library screen** (Settings → Rentals → Agreement Templates): one card per template showing name, version, insurance requirement and status. Actions: Create, Upload, Duplicate (as a new draft), Edit (always saves a new draft version), Compare Versions (line diff of the layout text), Preview, Approve/Retire (Owner only), and History.
- **Prepare Agreement:** a template picker that lists only approved, active templates. Changing the template clears the preview and its fingerprint. Blockers are recalculated from the fields the chosen template uses. Agreements store template key, version and hash at send, and agreements already sent or signed are never changed.
- **Insurance fields:** blockers come from the chosen template.
  - Insurance Required: carrier, policy number, coverage start/end, proof document and verification status. Uploading proof alone never counts as verified. A staff member with a recorded name and time must mark it Verified.
  - No Insurance Required: no renter insurance fields are required. Wording is preserved exactly. The UI never says this template provides coverage.
- **Signing checklist:** built from the selected template's acknowledgment rows (13 for No Insurance, 15 for Insurance Required). Each row must be initialed.
- **Deposit variant:** if Deposit = Required and the template has no approved deposit clause, sending is blocked. This is already enforced; it moves to a per-template check.

## Smart upload (Owner only)
1. Owner uploads a PDF or DOCX through the shared uploader. The file goes to private storage.
2. The server extracts the text, and AI proposes:
   - section and table structure
   - placeholders such as `[Legal Entity Name]`, `[address]` and blank table cells
   - fee schedule rows
   - acknowledgment and initial rows
   - signature blocks
   - pickup/return condition fields
3. Each proposed field is mapped to an existing field definition (the list below). Anything that matches nothing is marked **Unmapped** and never filled in.
4. On the mapping review screen the Owner can accept, correct, add or remove each mapping, and place a field by hand at a chosen spot in the text. The legal wording is shown read-only, with a diff warning if extraction changed any characters.
5. The result is saved as a new Draft template. The AI never approves anything.

## Field mappings (existing sources)
| Agreement field | Source |
|---|---|
| Legal entity name, address, phone, support email, countersigner name/title | Settings → Company / Agreements & eSign |
| Governing law, late/toll/cleaning/smoking/fee schedule amounts | Template reusable values |
| Renter name, phone/email, license #/state, DOB, home address | Driver profile (verified fields) |
| Additional drivers | Prepare Agreement (verified identity + license attestation) |
| Year/make/model, color, VIN, plate, unit | Vehicle profile (real VIN only) |
| Agreement number | RRA numbering (pending migration) |
| Start/end, weekly rate, reservation fee, deposit option | Prepare Agreement / rental |
| Pickup/return mileage, fuel, condition | Staff at pickup/return (left blank on the preview) |
| Insurance carrier/policy/dates/proof/status | New insurance fields (Insurance Required only) |
| Signatures, initials, acknowledgments | Signing engine |

## Database changes (proposed only, not applied)
These are one additive migration, folded into the pending template migration (provisionally 0023, after Codex's 0022). No new numbers are added out of order. Agreement numbering and Vehicle Pricing 0024 move one slot later if needed.
- `agreement_templates`: add `template_key`, `insurance_required`, `display_label`, `retired_at/by`, `source_document_path` and `field_map jsonb`. Add a unique index on (`template_key`, `version`) and a rule that only one template per key can be approved and active at a time.
- `agreements`: add `template_key` and `insurance_snapshot jsonb`, which is frozen at send.
- New `rental_insurance_verifications` table: carrier, policy, dates, proof document link, status, and who verified it and when. Staff RLS, with grants.

## Tests (disposable harness and synthetic data only)
- Import both PDFs. Confirm six pages each, wording identical to the source, and independent version histories and hashes.
- Template selection: only approved templates appear, and switching templates invalidates the preview and fingerprint.
- Mapping: mapped fields fill in, unmapped fields block sending, and nothing is invented.
- Insurance: the Insurance Required template blocks until a staff member verifies; proof upload alone does not count. The No Insurance template has no insurance blockers.
- 13 initials on one template and 15 on the other. All must be initialed before signing.
- Live preview matches the signed PDF, signatures land in their places, and versions can't be changed after saving.
- Permissions: Owner manages templates, Manager can select only, and Coordinator, Driver and signed-out users are refused.
- Signed documents are untouched, and both mobile and desktop flows work.
- Rerun the 38 engine tests and 25 prep tests, with only the hardcoded "13" assertions changed.

## Minimum phases
1. **Library and two templates** (no migration needed in preview): template keys in code, library cards, import both PDFs as drafts, compare and history.
2. **Picker and dynamic checklist:** template selector in Prepare Agreement, invalidation on switch, per-template blockers and acknowledgments.
3. **Insurance Required requirements:** fields, staff verification and blockers. Saving these needs the migration.
4. **Smart upload:** extraction, AI proposal and mapping review screen.
5. **Migration SQL plus tests** prepared and numbered after 0022. Nothing is applied, approved, sent or published.

Estimate: about 1.5–2 days of work across phases 1–4, once the Insurance Required PDF arrives and the version label is confirmed.
