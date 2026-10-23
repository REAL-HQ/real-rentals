# Security 0031 — recovered approved package

Stored here so the artifact cannot go missing again. **Byte-identical to what
was provided on 2026-10-23; nothing was modified.**

```
32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f  0031_guarded_coordinator_containment.sql
2445ecc8aed4dd721649f2b879db5de5841c8e0b46afba0dbac6f3643419d6b2  EXACT.diff
fd30ab5c97f1673798278448e302a0ef4eb8f162e0dd6fc5207b931db498099f  REVIEW.txt
```

Verify: `sha256sum -c SHA256SUMS` (the four files not included here —
`audit-catalog.sql`, `build-package.py`, `github-original.sql`,
`hosted-receipts.json`, `synthetic-results.json`, `test-local.py`, `test.log` —
were not provided and will report as missing; that is expected).

**This directory is deliberately outside migration discovery.** It is not under
`drizzle/migrations/` or `supabase/migrations/`, so nothing here is applied by
any deploy. Do not move it into either directory.

Verification and reconciliation: `../0031-package-reconciliation.md`.
Feasibility matrix: `../../../scripts/0031-feasibility/`.
