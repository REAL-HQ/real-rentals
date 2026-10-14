# 0031 isolated sync candidate — not execution approval

Base: d8c3b84a066c7ad58836527926e64619fb0482b4 (production-compatible Contact UI branch). No development-main merge or application changes.

Only executable migration addition: drizzle/migrations/0031_guarded_coordinator_containment.sql. Journal retains exactly 22 historical entries and appends reviewed 0031. The 22 existing meta/*_snapshot.json files are preserved byte-for-byte. The verifier allows only their exact baseline paths/hashes, not arbitrary snapshot files. No Resume, eSign, Stripe or reservation migrations added.

Approved SQL SHA-256: 479d44d3377103c78894ee46426621ca777dc9de68832918d5dcaf8fd6309f0a
Approved journal SHA-256: 1f76f03b72ede4d4af28b0823f3a20266819ffdb1744d9146553bdb653cb81dc
Approved package manifest SHA-256: e4df55f71abffa847a86331ae2ebbbf30b2252839fddb27c2d3fb24f0b3ff22d

APPROVED-PACKAGE-MANIFEST.json is an unchanged reference manifest for the separately sealed audit-0031-package, not a claim that every package test/evidence file is copied into this repository. This branch's historical inventory and journal/receipt baseline are in baseline.json, itself hash-pinned in verify.py. The production catalog, audit drift and receipt safeguards remain unchanged inside the exact approved SQL.

Run locally: python3 scripts/security-0031-sync/verify.py . --test
This runs no SQL and makes no network calls. It verifies positive inventory/order and eight tamper controls. It compares retained baseline receipts, not live production state. Immediately before any approved execution, independently recheck fresh live receipts/catalog/audit metadata and verify the actual provider runner snapshot, not only this branch.

Lovable documentation states Git sync does not run new migration files: https://docs.lovable.dev/integrations/git-sync-overview#backend-files-in-your-commits
No execution hooks, CI workflows, package scripts or application files are added/changed here. A later agent migration invocation could execute this pending entry; synchronization is not permission to execute. Do not prompt the agent to generate/apply migrations during sync-only staging.

No guarantee has been established that the provider pins the verified snapshot through execution. Additional later journal entries cannot be prevented by 0031 SQL guards. Actual Storage-policy authority remains unresolved. Production installation requires separate approval, fresh preflight, fixed-input guarantee, and exact executor authority. No ownership changes or privilege escalation permitted.

Current authorization: local preparation only. Do not push, switch Lovable branches, merge, publish, deploy, execute SQL or install migrations.
