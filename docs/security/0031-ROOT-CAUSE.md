# Security 0031 — the blocker was a misdiagnosis

2026-10-23. Established with **read-only queries only**. No production SQL was
executed, no probe was run, and the recovered 0031 package was not modified or
installed.

## Conclusion

**The production `postgres` role CAN create policies on `storage.objects`.** The
premise 0031 has been blocked on — "CREATE POLICY requires superuser or table
ownership, and BYPASSRLS does not grant it" — is correct for vanilla PostgreSQL
and **wrong for Supabase**.

**No production probe is needed.** The capability is declared in configuration
and readable without writing anything.

## Why it succeeded, precisely

Supabase preloads **`supautils`**, which keeps a per-role allowlist of tables on
which a non-owner may run policy DDL. On both the rehearsal project and
production:

```
supautils.privileged_role = supabase_privileged_role
supautils.policy_grants   = {"postgres": [ ... 24 tables ... ]}
```

That list contains `auth.users`, `auth.sessions`, `realtime.subscription`,
**`storage.objects`**, `storage.buckets`, `storage.prefixes`,
`storage.s3_multipart_uploads` and more.

**Production's `supautils.policy_grants` is byte-identical to the rehearsal
project's**, and both name `storage.objects` under `postgres`.

## The experiment, on the disposable rehearsal project

`CREATE POLICY ... ON storage.objects` as `postgres`: **SUCCESS**.

The asymmetry is what identifies the mechanism. All four results come from one
transaction, as the same role:

| Probe as `postgres` | Result |
|---|---|
| `CREATE POLICY` on `storage.objects` | **SUCCESS** |
| `ALTER TABLE storage.objects ADD COLUMN` | `42501 must be owner of table objects` |
| `SET ROLE supabase_storage_admin` | `42501 permission denied to set role` |
| `CREATE POLICY` on a `public` table | SUCCESS (expected — `postgres` owns it) |

So `postgres` is not the owner, cannot become the owner, and is refused every
other owner-only operation. Only **policy DDL** is permitted, and only on the
allowlisted tables. That is `supautils.policy_grants`, not ownership.

Ordinary ownership rules are still enforced for everyone else. Same statement,
same table, different roles:

| Role | Result |
|---|---|
| `authenticated` | `42501 must be owner of table objects` |
| `service_role` | `42501 must be owner of table objects` |
| `supabase_privileged_role` | `42501 permission denied for schema storage` |

Note the third: the privileged role *itself* cannot do it. The grant is to
`postgres` by name, which is why reasoning about role membership never found it.

`CREATE POLICY` also succeeded on `auth.users`, `auth.sessions`,
`storage.buckets` and `realtime.subscription` — every allowlisted table tried,
including `realtime.subscription`, where `postgres` holds **no** grant option
(`arwdDxtm`, no `*`). So the grant option is not the mechanism either.

## What the earlier investigation got right, and where it went wrong

Right: `postgres` is not a superuser, has `BYPASSRLS`, is **not** a member of
`supabase_storage_admin`, and that role has **zero members**. All of that is
true on production today and was verified again here.

Wrong: the inference that those facts make policy creation impossible. They
would in stock PostgreSQL. Supabase's platform adds a supported privileged
execution context for exactly this, and the investigation had no reason to look
for a GUC named `supautils.policy_grants`.

Also worth retiring: the three migration receipts carrying
`created_by='reconciled: applied out-of-band'` were treated as suspicious
because the executor's authority could not be established. The authority exists.
That does not make a receipt proof of execution, but it removes the reason to
doubt that the Oct 7 migration could have run as recorded.

## Comparison table

| | Rehearsal (disposable) | Production (read-only) |
|---|---|---|
| `server_version` | 17.11 | 17.6 |
| `storage.objects` owner | `supabase_storage_admin` | `supabase_storage_admin` |
| Members of that role | none | none |
| `postgres` superuser | no | no |
| `postgres` BYPASSRLS | yes | yes |
| `postgres` CREATE on `storage` schema | no | no |
| `postgres` in `supabase_privileged_role` | yes | yes |
| `supautils.policy_grants` names `storage.objects` for `postgres` | **yes** | **yes** |
| Existing `storage.objects` policies | 8 (created during this rehearsal) | 24 |

## What this does and does not authorise

It establishes **capability**, not approval. The 0031 package stays unmodified
and uninstalled. What changes is that "the executor lacks authority" is no
longer a reason to hold it, so the remaining questions are the ordinary ones:
whether to install, when, and with what verification — and the feasibility work
already done (16/16, five policies installing atomically, a privilege failure
rolling back all five) applies unchanged.

The narrow production probe proposed earlier — `CREATE POLICY` inside a
transaction then `ROLLBACK` — is **withdrawn as unnecessary.** Two read-only
`pg_settings` rows answer the question without touching production.
