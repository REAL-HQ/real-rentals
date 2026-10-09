# Roadmap
- [x] Release repair 1: Owner-only finance documents (server guard, UI hide, storage write policy 0013)
- [x] Release repair 2: broken uploader thumbnail
- [x] Release repair 3: hand-test Retry/Remove with simulated network failure
- [x] Release repair 4: final regression + COMBINED RELEASE report
- [ ] Publish combined release (waiting on user approval)
- [ ] Unified Drivers & Waitlist (preview only): people identity, Lead stage, Waitlist badge, server pagination, bulk promotion, metrics, per-city availability design
- [x] Email repairs: plain-text alternative, identity/reason footer, calmer recovery + payment-failed wording (preview)
- [ ] Email: one controlled test send per changed template to owner Gmail + Outlook (needs user go-ahead and inbox check)
- [ ] Email: business postal address (waiting on user)

- [ ] Waitlist acceptance check: automated Coordinator denial test (add/remove/promote), reconcile application/Waitlist counts incl. Dustin Arango. No historical changes, unpublished.
- [ ] Owner driver deletion: 0016 applied; review found Managers can still erase drivers directly + restore drops Waitlist hold; 0017 (remove Manager delete policy) not written/applied — awaits approval.
- [ ] eSign PDF retry hotfix (DEFERRED per user 10-09-2026): preventive repair, no production incident. Preserve reference — repo REAL-HQ/real-rentals, source commit 9707675, dev commit cf79b1e8027afa6f960d80c8be6f539583f7c41d, file src/lib/esign.server.ts, function retryArchive. Must ship in a future controlled release. Before that release, complete 3 missing tests: (1) recent pending archive must not be retried, (2) Coordinator/Driver/signed-out cannot invoke staff Retry, (3) automatic retry job rejects missing/invalid access keys. No new eSign development without approval.
- [ ] eSign Multi-Template Library: Phase 1–2 done (two draft families, library cards, picker, per-template blockers/initials). Open: smart PDF/DOCX upload + mapping review (Phase 4); insurance verification recording, Approve/Retire per family — need proposed migration scripts/agreement-template-library.proposed.sql folded into 0023 after Codex 0022 (needs approval).

## Workstream split (user decision 10-09-2026, Option 1)
- Codex owns Application Resume staging end to end: staging configuration safeguards, isolated database bootstrap, capture-only email testing, concurrent recovery security tests, and migration 0022 local verification. All remaining staging work belongs to Codex.
- Lovable owns the existing REAL RENTALS development project only. No branch switching, no new GitHub credentials, no untested patch files handed to Codex.
- Out of scope for Lovable until reassigned: Application Resume, Identity Review, authentication, staging configuration, and all Codex release branches.
- Preserve in place: eSign (preview-only exact-PDF flow, Owner templates, enforcement switch Off), Manual Payments Practice Mode (migration proposal unapplied), Waitlist safeguards, sticky-header chrome, and other development features.
- Standing holds: nothing published, no migrations applied, no production records modified. eSign PDF retry hotfix stays deferred.
- [ ] Next Lovable task: waiting for user assignment.

- [ ] Vehicle Readiness Phase B/C/D — awaiting approval (Phase A display-only done)
- [ ] Future UX: Open Inspections prefiltered to the selected vehicle (not started)

- [ ] Vehicle Delete data protection (needs approval, not List 1): deleting a vehicle cascades expenses/maintenance/tolls/incidents/odometer/finance/titles and unlinks payments/documents; only rentals block. Decide archive-only or blockers.

## Vehicle Delete Safety
- [ ] Phase 1 safeguard (scripts/vehicle-delete-safety.proposed.sql) — awaiting Owner approval + migration number (not 0022)
- [x] Phase 2 Archive/Restore in preview (no migration; previous status read from audit history)
- [x] Phase 3 Owner-only Delete Permanently (server check-then-delete)
- [ ] Future: move permanent delete into one locked DB function to close check-then-delete race
- [ ] Live preview click-through of Archive/Restore/Delete dialogs per role
