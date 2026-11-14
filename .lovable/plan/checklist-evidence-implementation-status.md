# Checklist Evidence — Code-Only Preparation

## Completed
- `src/lib/checklist-evidence.ts`: category-scoped append-only event proposal/validated history, Yellow Upload Due/Red Not Collected projection, explicit correction conflicts, matching-file resolution, requirement/stage aggregation and mock-only exception assessment.
- `src/components/admin/ChecklistEvidenceControl.tsx`: compact Collected and Not Collected choices, source/note dialog, nested Escape isolation, disabled Save without a persistence callback. No optimistic saved checkmark.
- `src/components/admin/ChecklistExceptionFields.tsx`: explicit selected item exceptions with a shared written reason, separate from actual verification facts and the current submit gate.
- Existing checklist, Next Step, lifecycle rail and activation screen accept the prepared evidence presentation without changing their default workflow.
- `checklist-evidence.functions.ts` authenticates future seam calls. `checklist-evidence.server.ts` has no database access: reads return unavailable capabilities, writes always refuse. No dummy history is returned.
- `scripts/checklist-evidence.test.ts`: 26 concrete rule tests using invented records. Existing quick-call/checklist/submission tests also passed.

## Deliberately Disabled
`CHECKLIST_EVIDENCE_ENABLED` is false. Real profiles do not show unsavable preparation controls or request new evidence data. Existing readiness, approval, rental functions and transaction enforcement are unchanged. Mock eligibility is not imported into the real activation decision or submitted to the rental function.

The profile preparation path has no saved history yet and no save callback. Do not flip the flag alone: replace that preparation projection with the reviewed authorized read response, wire the atomic mutation, then accept compatibility with the installed checked rental transaction.

## Pending Database Contract — No SQL Generated
1. Dedicated append-only field attestations with immutable actor/time, revision, previous-event reference, application, category, collected/not_collected state, source, note and retry key. Lock the application before revision checks; retry of the same key/input returns the prior result, changed input/key reuse refuses. Never allow direct overwrite/delete or browser actor attribution.
2. Field-scoped follow-up history attached to the same application and evidence field. Actual current saved file clears only its own upload gap; required review/signature facts remain separate. A Not Collected correction never deletes a real document; disagreements require review. No invented deadlines, automated notices or rental cancellation.
3. Explicit staff SELECT grants/RLS, no anonymous access, operational staff receipt authority only as existing permissions permit, restricted transactional writes and immutable attributed audit. New actor UUIDs must not cascade-delete the history through managed auth tables.
4. Extend the checked activation transaction contract with selected evidence-event revisions/fields and a shared written reason. Lock/re-read role, application, vehicle and authoritative field states; validate exact authorized exceptions; preserve identity/account, license validity, vehicle readiness/availability, mileage and dates. Commit the canonical activation, exception audit and follow-ups together. No unreviewed legacy fallback for evidence exceptions.
5. Review approval compatibility and the independent insurance exception setting/acknowledgement before activation exceptions become effective. A new Manager exception must not silently bypass an existing Owner insurance policy or a Codex-owned identity boundary. No direct application-status write or parallel signing path.

## Checks Completed
- Yellow persists until matching upload; unrelated/rejected/noncurrent/unsaved files do not clear it.
- Yellow-to-Red correction preserves the earlier event. Forged actor fields, invalid categories, stale/forked history and incomplete notes refuse.
- Both Yellow and Red qualify in the mock proposed contract with explicit selection, Manager/Owner tier, valid written reason and separate safeguards satisfied. States/follow-ups remain unchanged after mock activation.
- Desktop/phone synthetic UI exercised receipt dialog Save/readback, correction/history, reason-gated mock activation and matching-file resolution. Actual server/database activation was not simulated as passing.
- Signed-in real profile still has no preparation controls; existing missing-evidence refusal and Cancel verified. No real customer mutation occurred.
- Build log clean and upload/navigation regressions passed.

## Outstanding Acceptance
The actual durable read/write, authorization/RLS matrix, transactional retry/idempotency, audit-failure rollback, competing vehicle allocation and real approval/activation readback are blocked by the ungenerated/uninstalled database package. They must be tested in an approved disposable environment; no shared-backend eSign tests or real renter activation is authorized.

Separate authorization is required for SQL generation/execution. Publication remains unapproved.