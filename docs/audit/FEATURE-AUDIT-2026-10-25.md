# Feature audit: Driver Active, e-signature, application save and resume (2026-10-25)

This is a read-only audit of the live Release A code (`14cbf81b`), the related unmerged branches and the
proposed SQL. Nothing was changed, deployed or run against production.

Legend: **[V]** verified in code (the high-impact items were re-checked by hand); **[I]** inferred.

## 1. Driver "Active"

- **Active is not a status you pick. Starting a rental sets it [V].**
  - `activate_rental_tx` is the only writer of `applications.status='active'`.
  - Migration 0021 (`active_requires_running_rental`) refuses any other write.
  - The status menu leaves Active out, and the server's `updateApplicationLifecycle` input check
    (`application-lifecycle.functions.ts:23`) does not accept it.
  - There is no separate "driver" record or driver-activation code. The portal account is created at
    approval (`provisionDriverAccount`).
- **Why the owner cannot find it [V]:** the only entry point is the profile header's primary button
  (`DriversPanel.tsx:2390`). It shows **Activate Rental** only when all of these hold:
  - the interview is complete;
  - the 4 current required documents are present;
  - `insurance_verified` is set;
  - the status is approved or active;
  - there is no open rental.

  Otherwise it reads "Continue Interview", "Review Documents", "Verify Insurance" and so on. [I] The
  owner's approved drivers most likely lack one of those screening flags.
- **The server checks less than the UI [V].** `getActivationReadiness` / `activateRental` (Manager+)
  checks:
  - email;
  - approved;
  - no active rental;
  - vehicle Rental Ready and not busy;
  - a passed pre-delivery inspection (soft; overriding it needs a written reason and an audit entry).

  It does **not** check interview, documents, insurance verification, a signed agreement, deposit,
  card on file, identity review or vehicle `available`.
- **Record Rental** (feature branch, dark) also goes through `activate_rental_tx` and is stricter. It
  needs M2 Windows 1–2 plus its own installs.
- **Recommendation (no SQL):**
  1. Add soft blockers on the server for interview, documents, insurance verification and a signed
     agreement, so they can only be overridden with a written reason and an audit entry.
  2. Add an "Activate Rental" entry on the Rental tab, plus the hint "Active is set by starting a
     rental".
  3. Hide it for Coordinators.

  Keep 0021, `activate_rental_tx` and the menu exclusion as they are.

## 2. E-signature

- **Live end to end for the current ("in use") template [V]:**
  - Manager preview, then Send with the fingerprint (email and SMS link).
  - Signing by token link or in the portal: typed or drawn marks, initials and consent.
  - Atomic `esign_claim`, then the PDF and certificate, archived with a SHA-256 to `rental-agreements`.
  - Archive retry cron, then the `documents` row, downloadable from the vault and the portal.
  - Timestamps, IP, user agent and the signature-evidence SHA are stored, along with an audit log.
- **Not sendable:** the insurance and no-insurance library families (preview only). They need the
  template-approval SQL, agreement numbering and insurance verification.
- **Bugs and gaps [V]:**
  - Contract dates are computed in UTC, so a preview before midnight UTC fails Send afterwards. The
    fix exists in `e208920d` and needs porting.
  - The portal shows **voided** agreements as "Review & Sign".
  - Reopening a signed link says "Link Isn't Valid".
  - Initials are uppercased with CSS only.
  - **Owners can delete a signed agreement PDF from the vault.** `deleteDocument` removes the storage
    object, then the row.
  - The template key, version and fingerprint are not persisted.
  - The live archive uses `upsert:true`.
  - No ESIGN consumer-disclosure step.
- **Mobile:** the layout is responsive and pointer/touch drawing works. Risks:
  - nested scroll boxes for the contract;
  - rotation after drawing;
  - long typed names overflowing at 320px.
- **Dark or proposed:**
  - the pending-signatures list and driver card (dark, no SQL);
  - `completed-v1` (dark) and `immutable-v1` (patch 03);
  - M2 steps 23–25 (Window 2);
  - signed rental terms and historical/paper agreements (Record Rental).

## 3. Application save and resume

- **Live [V]:**
  - a `partial` row on first contact;
  - Part 1 autosave (1.5 s debounce);
  - Part 2 per-section save;
  - hashed resume tokens (14-day session, 30-minute single-use recovery);
  - the email resume link;
  - Manager reissue;
  - 24h/72h/abandoned emails;
  - uploads stay attached and are registered in `documents`.
- **Dark:**
  - `APPLICATION_RESUME_ENABLED` (first-incomplete step, signed-in banner);
  - `APPLY_PROGRESS_ENABLED`;
  - `APPLY_VEHICLE_PREFILL_ENABLED`;
  - `APPLICATION_RESUME_ATOMIC_ENABLED`, which needs **Drizzle 0023**. That migration is in the code
    but not applied in production; the next Lovable migration would apply it implicitly.
- **Bugs [V]:**
  1. **A live resume token can still edit an approved or active application**, including the
     licence-photo pointer (`updateApplicationStep`). After M2 step 3 that invalidates approval
     evidence. Only the status move is guarded.
  2. Any recovery-link request can revoke the applicant's open session token (the trimming counts
     both kinds).
  3. Cron issues: emails mint 14-day reusable tokens, the queries don't exclude
     deleted/purged/closed applications, they send before stamping (a double send is possible), and
     they filter a status `'rejected'` that doesn't exist.
  4. No autosave flush on page close, and no retry after a failed save.
  5. Quiet upload saves swallow errors.
  6. Duplicate check-then-insert race. Anonymous INSERT (contact and marketing columns only) can
     bypass the duplicate check.
  7. The phone field has no `inputMode="tel"` and contact fields have no `autocomplete`.
  8. No SMS resume link.

## 4. Cross-cutting security findings

| # | Finding | Severity | Fix | Gate |
|---|---|---|---|---|
| S1 | The RLS policy "Staff update applications" plus column UPDATE on `status` lets a **Coordinator** set statuses such as `approved` directly, bypassing `requireManager` and the audit entry. `active` is blocked by 0021. 0031's restrictive SELECT may narrow which rows are reachable [I]. | High | M2 step 3 closes `approved` only. A narrow SQL fix (revoke `status` UPDATE from `authenticated`, after confirming no client writes it) is needed for the other statuses. | SQL, owner approval |
| S2 | A resume token can edit decided applications (bug 3.1). | High (before Window 2) | App-only guard | PR 1 |
| S3 | A signed agreement PDF can be deleted (Owner). | Medium | App-only guard; DB immutability at M2 step 23 | PR 1 |
| S4 | Recovery requests revoke the applicant's session token. | Medium | App-only | PR 4 |
| S5 | Anonymous INSERT can bypass duplicate detection. | Low | SQL (revoke) or server-only insert | later |

## 5. Readiness classes

| Item | Develop now | Isolated test | Production after verification | Blocked by |
|---|---|---|---|---|
| Driver activation entry and server blockers | yes | unit tests + harness (0021, `activate_rental_tx`) | yes (app release, Preview gate) | — |
| Record Rental activation for existing renters | yes (built) | harness | no | M2 Windows 1–2, Record Rental installs, flags |
| E-sign app fixes (date, voided, signed link, initials, vault guard, template metadata) | yes | eSign harness only | yes | — (certificate printing touches pinned `esign.server`: Owner approval) |
| E-sign library families, numbering, insurance verification | port SQL | harness | after SQL approval and legal approval of the bodies | template/numbering SQL (rename: it collides with Drizzle 0023/0024 numbering) |
| E-sign immutable archive, evidence (steps 23–25, patch 03) | built | harness | no | Window 2 |
| Resume bug fixes (S2, S4, cron, autosave, uploads, mobile fields) | yes | unit tests + harness | yes | — |
| Resume atomic path (Drizzle 0023) | built | harness with 0031 + M2 | after an intentional 0023 apply | owner approval of a production migration |
| S1 Coordinator status writes | design | harness | after approval | SQL approval; `approved` is also covered by Window 2 |

**Security 0031 does not authorize any of these.** It only contains Coordinators' reads.
Release A only routes approvals through the compatibility gate with the M2 flags off.
