# Release B — both M2 flags enabled

Branch `release/m2-app-flags-on`, based on `release/m2-app-flags-off`.

**Preparation only.** Not published, not activated. Owner approval covers
preparing it and nothing more.

## Two lines of source differ from Release A

```
src/lib/document-content-sha.ts:23   DOCUMENT_CONTENT_SHA256_ENABLED = false -> true
src/lib/identity-verification.ts:9   IDENTITY_VERIFICATION_ENABLED   = false -> true
```

Nothing else in `src/` changes. Activation is a publish, not a variable: neither
module reads `process.env`, and its test asserts that.

## Where Release B must sit in the window

**After HOSTED-INSTALL step 2. Before step 3.** Both halves are load-bearing.

### Why not before step 2

With the flag on and `record_uploaded_content_sha` absent, an upload still
confirms — the probe sees `PGRST202`, logs once, and returns a null hash. It
does not throw. But those rows are **unhashed**, and once step 3 installs the
approval boundary **those applications cannot be approved**. The module says so
itself:

> *"record_uploaded_content_sha is not installed; confirming the upload without
> a content hash. Approval stays closed while content_sha256 is null."*

Published after step 2, every upload from that moment is hashed, so the only
unhashed rows left are historical — which is what the backfill is for.

### Why not after step 3

Step 3 requires a server-recorded licence hash and a verified identity review
for every approval. With the flags off and step 3 installed, the identity
control renders nothing and no hash is written, so **Approve closes for
everyone**. That is the failure the runbook's step 3 hold exists to prevent.

### The backfill does not wait for this release

`scripts/backfill-document-content-sha.ts` calls `writeUploadedContentSha`
directly, which has no flag check, so it is driven by step 2 alone. The test
asserts the backfill contains no flag gate. That independence is what lets the
historical 24 licence documents be hashed in the same window, and it is why the
outage is avoidable at all.

## Verified without a database

`npm run test:m2`, plus `scripts/m2-release-b-active.test.ts`:

| Property | Proven |
|---|---|
| Both flags ship `true`, neither reads the environment | yes |
| Step 2 present: the bytes are hashed and merged through `record_uploaded_content_sha` | yes — the stored hash equals the SHA-256 of the bytes |
| The merge is bound to the object's id and version that were hashed | yes — `p_object_id` and `p_version` are asserted |
| Step 2 absent: the upload confirms with a **null** hash and nothing throws | yes |
| A missing function is probed **once** per process, not on every upload | yes |
| A real storage or merge failure still throws — a missing function is the only tolerated gap | yes, `42501` propagates |
| The backfill has no flag gate | yes |
| The identity flag is still checked before any role lookup and before either RPC | yes — the ordering survives the flip |
| The identity control renders | yes |

Cross-check from the #266 dark-flag scanner: **62 dark modules on Release A, 59
here.** The three missing are `applications.functions.ts`,
`documents.functions.ts` and `identity-verification.functions.ts` — exactly the
M2 surface, no longer dark. The scanner fails if a list names a module that is
not dark, so that difference is enforced, not asserted.

`npx tsc --noEmit`, `npm run build` and the suite pass. The known
`agreement-evidence.test.cjs` failure (`initdb` refuses to run as root) is
pre-existing and unrelated.

## What changed in the tests, and why

Three Release A tests assert the flags are **false** — that is their job. On this
branch they would be asserting the opposite of the branch's purpose:

- `m2-content-sha.test.ts` and `m2-approve-fallback.test.ts`: the flag guards are
  **inverted** here, with a comment naming both branches. Not deleted — the
  guard still exists, it just asserts `true`.
- `m2-release-a-inert.test.ts` is **removed** and replaced by
  `m2-release-b-active.test.ts`. Inertness is a property of the flags-off build;
  on Release B it is intentionally false, so keeping a weakened version of that
  file would be worse than replacing it. The original stays on
  `release/m2-app-flags-off`.
- `dark-flag-coverage.test.mjs`: the three M2 entries are removed, because the
  scan no longer sees those modules as dark. The scanner itself enforces this.

## Still required before Release B can publish

1. Release A published and soaked.
2. Steps 1 and 2 installed and verified.
3. A successful rehearsal (`docs/development/M2-CUTOVER-AND-RECOVERY.md`, §4).
4. Separate owner approval for this publish.

The full ordering is in `docs/development/M2-CUTOVER-AND-RECOVERY.md`, §1.
