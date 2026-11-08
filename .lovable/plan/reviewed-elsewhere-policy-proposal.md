# Reviewed Elsewhere / Upload Due — Proposal Only

## Intended Staff Flow
For each document field, **Received Elsewhere** would record an actual email or paper copy, its source, when it arrived and a short staff note. **Upload Due** stays visible until the specific file is added. This is not a verified identity, license or signature verdict.

### Evidence Colors And Staff Choice
- **Yellow — Upload Due:** staff attest the specific evidence was collected elsewhere, but the matching file is not uploaded. Keep it Yellow until the file is added; receiving it is not a verification verdict.
- **Red — Not Collected:** staff can explicitly select Not Collected, including correcting an earlier collected checkmark. Preserve the previous attestation in history, and do not create fictitious evidence or turn an override Green.
- **Green — Complete:** use the existing item-specific completion criteria. An upload resolves the upload gap only; where review, signature or verification is required, adding a file alone does not complete that check.
- **Activation request:** the user wants both Yellow and Red operational gaps eligible for a Manager/Owner exception with a required written reason. This is a requested policy, not enabled behavior. Record every waived item, its current evidence state, reason, actor, driver, vehicle and time atomically with activation; leave the item Yellow/Red and the follow-up open afterward.
- Aggregate Screening/Documents/Insurance stages derive their colors from their own applicable items. A Red item outranks Yellow; Yellow outranks complete. Do not change the driver's actual application or rental status to implement color.
- The optional Interview Script and quick **Call Complete** entry remain separate choices. Script use is not required to attest an actual completed qualification call; neither path may invent answers or erase negative findings.

Owner/Manager review is a separate action: **Reviewed Elsewhere** records what was inspected and the outcome. Coordinator receipt recording cannot authorize approval or rental activation. Signed eSign evidence continues through the canonical archive only.

## Proposed Storage (Not Created)
A separate evidence-receipt entity is needed; do not overload identity review, payment rows, or mutable application status.
- Immutable receipt: id, application_id, category (license_front/license_back/insurance/agreement/gig_profile), source_type (email/paper), restricted source_reference, received_at, recorded_by, recorded_at, note.
- Append-only state attestation/correction: application_id, category, state (collected_elsewhere/not_collected), source receipt when collected, actor, timestamp, note and superseded event. Server actor and category-scoped history must support a truthful Not Collected correction without deleting the original receipt.
- Immutable review: receipt_id, reviewer_id, reviewed_at, outcome, review_basis, license validity/identity matching references where applicable, agreement family/version/vehicle reference for paper contracts, expires_at, supersedes_id. No browser-supplied actor or fabricated archive hash.
- Follow-up: receipt_id, due_at, assigned_staff_id, status (open/resolved/cancelled), resolution_document_id and resolved_at. A file only resolves the matching category/receipt; adding it does not rewrite prior review.
- Append-only events: action, actor, time, receipt/review/task references and idempotency key. Persist reminder attempts if delivery is separately authorized.

## Dependencies And Enforced Boundaries
- Existing `documents` and document review in `documents.functions.ts` remain the private file authority. `audit_log` stores staff attribution; audit requests alone cannot be mistaken for successful evidence review.
- Existing approval in `applications.functions.ts` / `approval-rpc.server.ts` and `approve_application_checked`, where installed, must explicitly support any approved external review. Do not modify Codex-owned Identity Review or authentication without reassignment.
- `activation-readiness.ts`, `rentals.functions.ts` and the existing checked/atomic rental transaction must agree on evidence eligibility. No additional rental start function or separate signing path.
- License front/back and signed paper agreements currently require stored evidence. Merely receiving email, scheduling an upload, or clicking a circle must not satisfy those checks.
- Insurance-card and gig-screenshot uploads are advisory in activation readiness; insurance verification remains separate. Broader approval/pipeline gates may have different requirements and must be reviewed before calling any item globally nonblocking.
- Optional missing uploads stay advisory. Any permission to activate on reviewed-but-not-uploaded **required** evidence is an explicit policy change needing its own approved transaction design, duration, roles and required provenance.

## Decisions Needed Before Implementation
1. Resolve whether Red exceptions cover missing uploads only or genuinely unfinished work/no collected evidence. The requested Yellow/Red exception policy must distinguish a storage gap from an unsigned agreement, unverified insurance, invalid license or unresolved identity. Receiving a document without reviewing it cannot count as reviewed.
2. Who can approve the exception, how long it lasts, and when Upload Due expires/escalates. No deadline has been assumed.
3. Required review evidence for identity, valid licenses and fully signed paper contracts, including the correct driver/vehicle/family version.
4. Whether follow-up is in-app only or includes separately approved transactional messages. No reminder messages are enabled by this proposal.

## Recommended Sequence
1. Approve the operational receipt/reminder policy and exact exception eligibility, if any.
2. Review schema/grants/RLS and atomic review/audit/follow-up functions as a separate package; confirm pending-migration ordering without changing Security 0031.
3. Add receipt/review/follow-up presentation and synthetic tests while exceptions stay disabled.
4. Separately review approval and rental-transaction compatibility before enabling any required-evidence exception. Existing identity/license requirements and signed evidence must remain real and auditable.

## Tests And Risks
Test staff roles, forbidden customer/Coordinator approval, forged actor IDs, wrong driver/category, expiry/stale versions, duplicate receipts, matching-only reminder resolution, immutable corrections, audit failure, retry idempotency and private source references. Confirm unsigned agreements, rejected/expired licenses, identity conflicts, inaccessible required evidence and missing provenance still refuse activation. Confirm no automatic approvals, rentals, accounts, charges or messages.

Risks: treating an email claim as reviewed evidence; unsigned paperwork marked signed; reminder resolution by an unrelated upload; Coordinator escalation; mismatch between UI/readiness/transaction; stale/expired exceptions; leaking email/source details; non-atomic audit/state writes.

## Recommendation
**GO:** Phase 1 quick recording of an actual completed call without repeating the interview script.
**NO-GO:** Enabling Yellow/Red required-file activation exceptions until the evidence eligibility and atomic package are approved. The existing activation rules and checked transaction reject missing license documents and missing qualifying signed agreements; only interview/inspection soft blockers have a written-reason override. A UI checkmark or reason cannot change that contract. No schema, SQL, permission, eSign, customer record, message, Stripe or publication changes are authorized by this proposal.