# Preview: three Overview panels fail — root cause

2026-10-23. Read-only inspection. **No code change, no SQL, RC `67b62664` untouched.**

## 1. The served version reconciles

Lovable's API now reports `latest_commit_sha = 67b626641ec83b871e608f8621857054d7859d55` —
**`67b62664`, the expected RC.** My earlier report of `0946c750` was read *before*
the branch was switched; it was stale, not a mismatch.

Caveat you were right to raise: that is the platform's record of the synced
commit, not proof of what the running Worker serves. The app carries no build
marker, so there is no in-app way to confirm the SHA. The reconciliation rests
on the API field, not the "In sync with GitHub" indicator.

## 2. Root cause: the Preview runtime has no server-side secrets

**Not a regression. Not a database problem. Not authentication.**

The split is exact:

| Panel | How it reads | Needs | Preview |
|---|---|---|---|
| **Fleet Snapshot** ✅ | `supabase.from("vehicles")` **in the browser** | publishable key, **baked into the bundle** | works |
| **Lead Priorities** ❌ | `createServerFn` → `supabaseAdmin` | `SUPABASE_SERVICE_ROLE_KEY` | missing |
| **Recent Applications** ❌ | `createServerFn` → `supabaseAdmin` | `SUPABASE_SERVICE_ROLE_KEY` | missing |
| **Revenue** ❌ | `createServerFn` → Stripe | Stripe secret | missing |

The code states its own failure. `client.server.ts` throws
`Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY. Connect
Supabase in Lovable Cloud.` and `stripe.server.ts` throws
`<KEY> is not configured`. Both produce exactly the messages you saw.

### Why this is not a regression

Every module in the Lead Priorities and Recent Applications chains is
**byte-identical to live production**: `lead-priorities.functions.ts`,
`admin-overview.functions.ts`, `client.server.ts`, `roles.server.ts`,
`auth-middleware.ts`, `lead-priorities.ts`. The same code serves those panels in
production today against the same database. The only #266 change in this area is
`OverviewPanel.tsx` passing `isManager={canSeeCollections}` to `<LeadPriorities />`
— a prop, not a data path.

### Why it is not authentication, and not the database

**Fleet Snapshot returned 10 vehicles through RLS.** That read only succeeds for
an authenticated, staff-tiered session — so the sign-in is fine. And since the
two Supabase-backed chains are identical to live code that works against this
same database, the database is compatible.

## 3. Smallest corrective action: none in code

**Do not re-cut the RC.** Nothing here is a defect in the candidate.

Two ways forward, your choice:

- **(a) Accept the limitation.** Preview cannot exercise any server-function
  panel. Verify those three against production right after publishing, with
  republishing `7e3e6eb6` as the rollback. Risk is low for Lead Priorities and
  Recent Applications, whose code is identical to what runs today.
- **(b) Give Preview its own server secrets** so the panels render. Note before
  doing this: `SUPABASE_SERVICE_ROLE_KEY` **bypasses RLS**. Putting the
  production service-role key into a preview environment widens where that key
  exists. If you want (b), a Supabase key scoped to a non-production project, or
  a restricted read-only Stripe key, is the safer shape. This is a security
  decision, not a release step.

## 4. The one thing Preview cannot validate either way

#266 **did** refactor the Stripe collections reader — `stripe-reader.server.ts`,
`stripe-collections.server.ts` and `stripe-collections.ts` all differ from live,
replacing a direct `createStripeClient` with a shared read-only facade plus
extracted pagination, timeout and TTL.

Because Preview reaches Stripe not at all, **that refactor is not exercised in
Preview under either option (a) or a Supabase-only fix**. It is the single
live-money change in this release that a preview walkthrough cannot test.

Both old and new code throw the same `<KEY> is not configured` without a secret,
so the refactor is **not implicated** in the "Unavailable" you saw — but it is
also not cleared by it.

To actually test it, Preview needs a **restricted, read-only Stripe key**
(option b). Otherwise Revenue is the first thing to check after publish, before
anything else.

## Status

| | |
|---|---|
| Release-blocking defect found | **no** |
| RC `67b62664` | **unchanged, still frozen** |
| Action needed from me | none |
| Decision for you | (a) or (b) above, and whether to give Preview a read-only Stripe key |
