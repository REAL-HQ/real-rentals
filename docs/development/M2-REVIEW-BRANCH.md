# M2 review branch — source integration only

**For review. Not an installation approval.** Created 2026-10-23 at commit
`29d47ee3`, the authoritative M2 source.

## 1. Byte-for-byte preservation

The branch **points directly at `29d47ee3`**. The SQL files are not copies —
they are the original blobs, so checksums match by construction rather than by
transcription. This commit adds one document and changes no SQL.

| Directory | Files |
|---|---|
| `proposed/m2-packet/` | 24 |
| `proposed/rollback/` | 31 (one per step) |
| `proposed/m2-with-approval-boundary/` | 6 |
| `proposed/HOSTED-INSTALL.md` | 2,673-line runbook |
| `proposed/m2-preflight.sql` | read-only preflight |

### SHA-256 (first 16) of each packet file

```
d6fb0b76aa88dd1b 01.sql    922b5bcbcf1b1481 02.sql    596df528c0561a9e 03.sql
c29fa122bf9ddb4f 04.sql    c27b49a46e55381e 05.sql    39863c6763c8fdbf 06.sql
6537823ca84203a6 07.sql    814d00b8ff505457 08.sql    290f3b4aceee1c68 09.sql
cf40bd9d02cf03d9 10.sql    b8fde7718e9893c3 11.sql    c26bcdd58f62a8d7 12.sql
0269b937f4189257 13.sql    4f9217759844e934 14.sql    0e3977d47842d9d0 15.sql
09f339e76fd669c9 16.sql    36b3d8e9525bbe6f 17.sql    7057c340052ea363 18.sql
8ddf84ce34a9ecbd 19.sql    af1f5b28d91b774a 19b.sql   57260b67d037f817 20.sql
2eea1a9184bc545d 21-revoke-executor-create.sql
c849bb754d4d4f85 extend.sql   4eca4e74ba21b1cb return.sql
```

`20.sql` = `57260b67d037f817…` matches the Vehicle Swap hash recorded
independently earlier — a cross-check that this is the same source.

## 2. Minimum ordered steps for Record Rental

**The stubs are not sufficient, and you were right to say so.** `03.sql`
(step 5) leaves *both* evidence helpers deny-all. They are replaced at different
points:

| Stub | Replaced at |
|---|---|
| `private.record_subscription_evidence` | **step 7** (`05.sql`, Evidence V1) |
| `private.record_agreement_evidence` | **step 25** (`19c-agreement-contract.sql`) |

`19c` states it in its own header: *"Step 3 and step 19b leave
`private.record_agreement_evidence(...)` as a deny-all."*

So Record Rental is not operational until **step 25**. The chain is
5 → 7 → 10 (`07.sql`, evidence consumer) → 23 (`19.sql`) → 24 (`19b.sql`) → 25.

**Minimum sequence: steps 1 – 25, then step 29.**

Step 29 (`21-revoke-executor-create.sql`) is not optional. Step 5 grants
`CREATE` on `public` and `private` to `rr_record_executor` so ownership can
move; step 29 revokes it. **Stopping before 29 leaves that grant standing.**

## 3. Shared with Vehicle Swap, and unrelated

| Steps | Relationship |
|---|---|
| **1 – 25** | **Shared prerequisites** — Vehicle Swap needs all of them |
| **26** (`20.sql`) | Vehicle Swap itself, the only step unique to it |
| **27** (`extend.sql`) | Extend rental — **unrelated** to both |
| **28** (`return.sql`) | Return checklist — **unrelated** to both |
| **29** | Required by both; closes the privilege window |

Vehicle Swap therefore costs exactly **one additional step** once Record Rental
is in.

## 4. The install is one window, not a resting point

The runbook is explicit: the window opens at step 1 and closes when step 29
verifies, and *"Approval and signing during that window see a partial install."*
Stopping at 25 is a valid feature boundary only if 29 runs too.

## 5. Remaining blockers

1. **Step 3 hold.** Gated on flag-on builds being deployed
   (`DOCUMENT_CONTENT_SHA256_ENABLED`, `IDENTITY_VERIFICATION_ENABLED`) and on
   `proposed/backfill-document-content-sha.sql` reporting 0 missing and 0
   mismatched. Both constants are `false` here; turning either on is its own
   approval.
2. **The application deploy must precede the packet.** Installing first makes
   live Approve fail — the approval triggers refuse the legacy writes.
3. **Owner approval for the hosted install.**
4. `RECORD_RENTAL_CONTRACT_ENABLED` and `SWAP_ENABLED` stay hard `false` until
   after installation, verification and separate approval.

## 6. Recommendation for the next approval

Approve the install **as one window, steps 1 – 29**, not 1 – 25. Vehicle Swap
costs one extra step, closing at 29 is required regardless, and splitting leaves
a `CREATE` grant open between windows.

Before that, the **step 3 hold** must clear — a smaller, separate approval:
deploy the flag-on builds and run the document-hash backfill to a clean report.
That is the next thing to decide.
