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
