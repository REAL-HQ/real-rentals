# Quick Staff Completion And Upload Later

## Goal
Let staff record work already done without repeating the interview or confusing a missing upload with missing work. Keep approval, identity, signed-agreement history and actual rental activation accurate.

## What The Team Will See
- Click the **Interview Complete** circle to open a small **Record Call** dialog instead of the full interview script. Record that the call occurred and a short note; preserve existing answers and do not invent answers or clear disqualifications.
- Keep **Add** dialogs for files. A separate **Received Elsewhere** option can record evidence actually received by email or on paper, with its source and an **Upload Due** reminder.
- Distinguish **Completed**, **Received Elsewhere**, **Upload Due**, and **Missing**. Do not show missing or unreviewed evidence as verified.
- Keep signed eSign agreements automatic; never require a second upload or create another signing path.

## Phase 1: Quick Call Recording
Implement a compact call-recording action through the existing interview completion workflow, with the appropriate staff permissions and readiness refresh. Preserve screening answers, history, existing negative findings, and later lifecycle stages. Do not approve or activate automatically.

The current interview and inspection activation exceptions already allow a written reason, subject to the existing server safeguards. Preserve them; do not claim an exception means the inspection or call was completed.

## Phase 2: External Evidence And Activation — Review First
An Upload Due reminder for an optional insurance card or gig screenshot must not become an activation blocker; those uploads are already advisory. Insurance verification remains a separate decision.

Required license evidence and signed agreements are different: today the activation checks require stored license files and either canonical signed eSign evidence or an uploaded, audited, verified paper agreement. A browser checkmark cannot safely change those checks.

Prepare a separate proposal for an authorized **Reviewed Elsewhere** workflow before changing this policy:
- Identify the exact evidence, its source, who reviewed it and when; a missing file or promised future signature cannot qualify.
- Preserve identity and valid-license checks and the separate insurance decision.
- Record a durable upload follow-up tied to the driver and evidence item; uploading later resolves the reminder but does not rewrite the original review.
- Make any permission to activate with externally reviewed, not-yet-uploaded required evidence explicit, audited and enforced by the existing approval/rental transaction path.
- Preserve the original paper agreement and permanent history; staff attestation is not an eSign signature or a fabricated agreement archive.

This phase is **proposal only** until its authorization, evidence requirements, storage and transaction compatibility are reviewed. Existing required-document checks remain enforced meanwhile.

## Technical Scope
- Phase 1: `DriversPanel.tsx`, `ActivationRequirementList.tsx`, `checklist-actions.ts`, `InterviewDrawer.tsx` / `DriverScreening.tsx`, a focused quick-call dialog, and focused tests as needed. Reuse existing screening fields, not a parallel completion flag.
- Phase 2 review: existing readiness rules, document review and approval functions, rental transaction compatibility, durable reminder storage and role boundaries. Do not generate or execute a migration during this review.
- Keep `esign.server.ts`, authentication, Identity Review, Application Resume, Stripe and Security 0031 unchanged.

## Verification
- Recording an actual call does not invent answers, reset later stages, erase disqualifications or approve the driver.
- Unauthorized staff cannot gain approval/activation permissions through a checkmark.
- Optional uploads do not block activation; required evidence stays enforced until a separately approved exception exists.
- Paper agreements are not treated as signed simply because someone clicks; signed eSign evidence remains automatic.
- Check desktop/phone, cancel, readiness refresh and staged uploads without modifying real customer records.

## Release Boundary
No publication, customer-record edits during testing, SQL execution, migration generation, Stripe changes, or branch switching. Approval of this plan permits Phase 1 implementation and Phase 2 design only—not activation-policy weakening.