# Security 0031 v2 — collation-corrected package (prepared; not approved for production)

Supersedes `../0031-package/0031_guarded_coordinator_containment.sql`
(`32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f`). That file stays
unchanged for audit history. It must not be installed: on production's `en_US.UTF-8` it
always refuses (`../0031-direct-attempt-2026-10-24/`). v2 inherits no approval.

| Artifact | SHA-256 | Bytes |
|---|---|---|
| `0031_guarded_coordinator_containment_v2.sql` | `d101c54e903f8495b1d1c6fa063319a3ac5a88340cc0e5bd276b60cc87a3e9d1` | 22,503 |
| `submission-guard3-v2.sql` (from `../0031-direct-route/gen-guard3.py`) | `dc0285c16bea5477bfeba536e6da88741924ccef26d61923ac07a415aff5f9aa` | 1,962 |
| **`request-v2-guard3.sql`** = guard v3 + unchanged v2 package | **`1acaf722737d735fd6bbcc3ac133a8e5428954730d70339e5a448dc279477c32`** | 24,465 |
| Superseded, do not use: `request-v2-guard2.sql` (guard v2, search_path substitution) | `713febbe326bd262d3c6aacf13357676282330af2f1ef137f59c528ad435883f` | 23,980 |
| Inner approved DDL (unchanged; checked by the package itself) | `cf8d5572670cb3f865fc0911d623ff070e6a9be1ca8d254c87db8f2a5c3cd723` | — |
| Superseded, do not use: `request-v2.sql` (guard v1, two bypasses) | `e84fe067eb0c169e79ff15b57c9ac62ac8de4953d7e32dc35b5b73144a9a257a` | 23,865 |

## The change (`EXACT-v1-to-v2.diff`: one line, one expression)

```
- ... SELECT jsonb_agg(p ORDER BY p->>'policyname') FROM jsonb_array_elements( ...
+ ... SELECT jsonb_agg(p ORDER BY (p->>'policyname') COLLATE "C") FROM jsonb_array_elements( ...
```

The normalisation now sorts each table's policies in the same C order as the "before"
snapshot (`ORDER BY policyname`, type `name`). Nothing else changed:
- the five policy definitions and the inner DDL;
- role restrictions and catalog scope;
- the journal pins;
- the audit evidence and every other guard.

The normalisation's table sort (`t->>'schema', t->>'name'`) was left alone. For the fixed
seven-table scope it orders identically under C and `en_US`. This was shown on production
read-only, in test T2, and independently by the reviewer. It would need revisiting only if the
scope ever changed.

## Guard v3: what it guarantees, and what it cannot

The guard is a separate statement that runs first in the same request. Every function,
operator and type it uses is qualified as `pg_catalog`, so a changed `search_path` cannot
substitute them. Every check fails closed: a NULL refuses.

**It guarantees the package runs only if all of the following hold:**
1. Everything before the package is exactly the guard. It hashes its own text with its
   self-hash literal masked to zeros (`RRGUARD_GUARD_TEXT_CHANGED`).
2. The package header appears exactly once (`RRGUARD_PACKAGE_MISSING`).
3. The 22,503 package bytes hash to `d101c54e…` (`RRGUARD_BYTES_MISMATCH`).
4. Only the Management API's comment trailer follows, with no `\r` (`RRGUARD_TRAILING_TEXT`).
5. The query text is readable (`RRGUARD_NO_QUERY_TEXT`).

Because the request is one transaction, a refusal also rolls back anything placed before the
guard, unless that text commits itself.

**What it cannot do (threat model):**
- **Text that ends in `COMMIT` before the guard takes effect even though the guard refuses**
  (T8j). Work committed before the guard runs is beyond any guard's reach. Only the person
  composing the request can add such text. The defence is out of band: submit exactly the file
  whose hash was approved (`1acaf722…`). The package still never runs in that case.
- A superuser could redefine `pg_catalog`. Production executes as `postgres`, which is not a
  superuser (read-only check).
- A request with no trailer is accepted by design, as in direct `psql` delivery (T8o).

**Trailer on this route:** the guard models Supabase's Management API trailer. On 2026-10-24
the v1 guard *passed* in production through this exact route (Lovable `query_database` to
project `8cf1f99e…`; the package then refused for the collation defect). The disposable probe
captured the trailer byte for byte. If the route ever changes the trailer, the guard refuses,
which fails closed.

## Disposable verification (`test/`, results in `test/results.json`): 42/42 pass

Environment:
- PostgreSQL 17.6, with libc `en_US.UTF-8` like production;
- `replica.sql`, which reproduces the scope the package inspects, including production's 24
  mixed-case `storage.objects` policy names and the 23-receipt journal.

Test copies change exactly two profile values (system identifier and catalog hash), and this
is asserted (T0b). Requests are sent as the Management API sends them: one transaction, with
its trailer.

| # | Demonstration | Result |
|---|---|---|
| T0 | Cluster orders like production: the old normalisation reorders `storage.objects`, the new one does not | pass |
| T1 | Original fails with `POST_UNEXPECTED_CATALOG_CHANGE`; nothing persists | pass |
| T1b | Control: on C collation the original passes, which is why earlier tests missed it | pass |
| T2 | Corrected package passes the same scenario | pass |
| T3 | All five restrictive SELECT policies install together; exactly one evidence row | pass |
| T3b | Role effect: Coordinator loses identity data and keeps non-identity data; Owner, Manager and driver unchanged | pass |
| T4a–e | Genuine catalog mutations refused (`POST_UNEXPECTED_CATALOG_CHANGE`): extra grant, extra mixed-case storage policy, dropped policy, widened helper ACL, new column | pass |
| T4f | A policy weakened to `USING (true)` is refused by the inner checksum | pass |
| T5a | Failure after the DDL leaves no policies and no evidence | pass |
| T6 | Re-run after success refused (`PARTIAL_INSTALL`) | pass |
| T7, T7b | Journal identical on the direct route; a receipt added first is refused (`JOURNAL_DRIFT_OR_REPLAY`) | pass |
| T8a | Real request: guard passes, package refuses the foreign target | pass |
| T8b–h | Real request tampered: one package byte; text before; **bypass A** (statement inside the guard); guard logic edited; **bypass B** (`\r` in trailer, then a statement); statement after; statement between. Each is refused before anything runs, and injected tables do not survive | pass |
| B1, B2 | Controls: guard v1 let bypasses A and B through | pass |
| T8c2 | Matching copy, statement before the guard: refused, rolled back, package not run | pass |
| T8j | **Limitation, asserted:** a prefix ending in `COMMIT` survives the refusal; the package does not run | pass |
| T8k–m | `search_path` substitution of `current_query()` (returning NULL, or the clean request text), and of `<>`/`!~`: refused, nothing commits | pass |
| T8n | Second package header after the package: `RRGUARD_PACKAGE_MISSING` | pass |
| T8o | No trailer: the exact request installs (by design) | pass |
| B3, B4 | Controls: guard v2 let the substitutions through (B3: package ran and the injected table committed) | pass |
| T8i | End to end with a matching copy: both bypasses refused, nothing commits | pass |
| T9, T9b | Production Coordinator plan rehearsed (below) | pass |
| N1 | Control: catalog comparison removed, so an injected policy is accepted (the check is load-bearing) | pass |
| N2 | Control: partial-install check removed, so a re-run is refused only by `SCHEMA_POLICY_GRANT_DRIFT` (second layer) | pass |
| N3 | Control: pre-DDL journal check removed, so drift is refused only by `POST_JOURNAL_CHANGED` (second layer) | pass |

Reproduce with `PG17_BIN=<postgresql 17 bin> bun test/run.ts`, run as root; the cluster runs
as an unprivileged user and is deleted afterwards. Every tampering edit asserts that its
anchor exists, so no tampering test can pass on unchanged input. Binaries used: npm
`@embedded-postgres/linux-x64@17.6.0-beta.15`.

## Independent review (fresh agent, files only, no author conclusions) and resolution

Verdict on the first submission: **approve with notes**.
- Confirmed: checksums, the exact one-expression diff, the byte-identical inner DDL, that the
  fix is correct and sufficient (all 17 `ORDER BY` clauses examined), request composition,
  the local re-run, and that the Coordinator test always aborts.
- **Should-fix, resolved here:** the first guard's two bypasses (A: text inside the guard;
  B: `\r` in the trailer). Fixed by guard v2 and tested in T8c–T8i, B1 and B2.
- **Should-fix, resolved here:** negative controls N2 and N3 passed on *any* other outcome.
  They now assert the exact second-layer refusal. N4 became positive test T4f.
- **Notes, accepted:**
  - The replica is not a full Supabase database: it loads as superuser, has a subset of the
    165 policies, and a simplified `user_roles`. This does not affect the ordering fix,
    because production already passed every gate up to and including the DDL in the v1 run.
  - Production event triggers were checked read-only: only extension hooks and PostgREST's
    schema-reload notifier, which changes no catalog. Any unknown DDL side effect would refuse
    safely.

**Second review (fresh agent, adversarial, on guard v2): reject as claimed.**
- Confirmed: the request composition and the self-hash construction; and that every
  injection inside or after the guard was refused. Inputs tried: `\r`, `\v`, `\f`, `\t`,
  U+2028, U+0085, NUL, CRLF, nested comments, dollar quotes, a duplicate header, multibyte
  characters and a split boundary.
- **Blocking, resolved by narrowing the claim:** a prefix ending in `COMMIT` survives the
  refusal. This is now stated as a limitation and asserted (T8j); the package still does not run.
- **Blocking, resolved by guard v3:** `search_path` substitution of unqualified functions and
  operators, and NULL failing open. Guard v3 qualifies everything as `pg_catalog` and fails
  closed (T8k–m; controls B3 and B4).
- **Should-fix, resolved:**
  - prefix rollback is now proven with a matching copy (T8c2);
  - prefix-with-COMMIT, substitution, duplicate-header and no-trailer tests added;
  - every tampering edit now asserts its anchor. This also exposed one vacuous test (T8e) on
    guard v3, which is fixed.
- **Note, addressed:** trailer format on the Lovable route (see the guard section).

A third review of guard v3 is requested before approval.

## Production read-only check (2026-10-24, `production-readonly-check.json`)

Identity `7642734024280108049`, `postgres`, PostgreSQL 17.6, `en_US.UTF-8`.
- Journal exact (23); Supabase 105; `0023` not applied.
- Catalog `c753236e…` (= the v2 profile).
- Helpers unchanged; storage policy authority present.
- 0 containment policies, 0 evidence rows.

## Production operation requiring approval (not authorised)

1. Read-only: `../0031-preflight-readonly.sql` and `../0031-direct-route/fingerprint-readonly.sql`.
   Stop on any difference from `../0031-direct-attempt-2026-10-24/`.
2. One Lovable `query_database` call to project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6` with
   exactly `request-v2-guard3.sql` (`1acaf722…7c32`). No retry.
3. Read-only verification (`../0031-direct-route/verify-after-readonly.sql`). Expected:
   - five policies, all `RESTRICTIVE`, `SELECT`, `{authenticated}`:
     `coordinator_agreement_containment` (agreements), `coordinator_application_containment`
     (applications), `coordinator_document_containment` (documents),
     `coordinator_identity_storage_containment` (storage.objects),
     `coordinator_review_containment` (application_identity_reviews);
   - one `audit_log` row: `action='security_migration_verified'`,
     `entity_id='0031_coordinator_containment'`, `actor_role='postgres'`, metadata
     `original_sql_sha256 = cf8d5572…`, `baseline_catalog_sha256 = c753236e…`, and the five
     verified policies;
   - Drizzle 23 (same hashes), Supabase 105;
   - `executed_text` `{len 22501, sha 8d030e94bb381d6217ffe53c37c0bc79f5ec7b392536ad41791badac57216921}`;
   - fingerprint: policies 165 → 170, storage policies 24 → 25, audit rows 886 → 887; every
     other value unchanged (`policies_other_md5` excludes the five).
4. `../0031-direct-route/access-test-readonly.sql`: Owner and Managers equal the 2026-10-24 baseline.

## Coordinator access test (production has no Coordinator account)

`coordinator-access-test.sql` is one always-aborting statement. It borrows one existing
driver login, gives it the coordinator role inside the transaction only, counts what that
user can read through row-level security, and raises. Nothing commits; it returns counts only.
It refuses if a real Coordinator exists; use that account instead.
- Rehearsed as T9 and T9b.
- Production pre-checks, read-only and done: `user_roles` allows the second role
  (`UNIQUE (user_id, role)`), `coordinator` is an `app_role` label, other columns have
  defaults, the table has no triggers, and the only outbound-network extension is `pg_net`,
  which is transactional.
- **Limitation:** this is a simulated session, not a real Coordinator sign-in. It exercises
  the same row-level security path the API uses. Running it on production is a separate
  approval.

## Review checklist

- [ ] `sha256sum -c SHA256SUMS` passes; v1 still hashes to `32c17aa7…`.
- [ ] `EXACT-v1-to-v2.diff` changes one line, and only the expression above.
- [ ] Inner `approved_sql` is byte-identical (`cf8d5572…`).
- [ ] `cat submission-guard3-v2.sql 0031_guarded_coordinator_containment_v2.sql | cmp - request-v2-guard3.sql`.
- [ ] `gen-guard3.py` reproduces `submission-guard3-v2.sql`; every function, operator and type in it is `pg_catalog`-qualified. The self-hash appears exactly
      twice, and masking it yields the hashed template.
- [ ] Results reproduce 42/42 on PostgreSQL 17 with `en_US.UTF-8`.
