# The four environment flags — where they live, and why they are not a release gate

Corrected 2026-10-23. **My earlier instruction to check your personal Cloudflare
dashboard was wrong.** I inferred it from the build preset (`cloudflare-module`),
which says what the build *targets*, not who hosts it. REAL RENTALS production
runs on Lovable Cloud; the Workers in your own account are staging and a
different project.

## 1. They default to disabled. Verified in code.

All four are strict string comparisons, so an unset variable is `undefined`,
which is not `"true"`:

| Flag | Code | Absent → |
|---|---|---|
| `APPLICATION_RESUME_ATOMIC_ENABLED` | `process.env.… === "true"` (`application-recovery.server.ts:27`) | **off** |
| `RENTER_LIFECYCLE_NOTICES_ENABLED` | `process.env.… === "true"` (3 call sites) | **off** |
| `DRIVER_ISSUE_ALERTS_ENABLED` | `process.env.… === "true"` (`driver-issue-alert.server.ts:12`) | **off** |
| `STRIPE_RECONCILIATION_ENABLED` | `!== 'true'` → throws *"Stripe reconciliation is not activated"* | **off** |

There is **no** default-on path and no fallback. Nothing in the repository sets
any of them: they appear in no tracked `.env` file, and there is no
`wrangler.toml`, Netlify, Vercel or Docker config.

## 2. Database evidence that two of them are not operating

Read-only checks against production:

| Object the flag needs | Exists? |
|---|---|
| `stripe_ingest()` — the RPC `STRIPE_RECONCILIATION_ENABLED` calls | **no** |
| `reserve_application_recovery()` — what `APPLICATION_RESUME_ATOMIC_ENABLED` switches to | **no** (it ships in pending migration `0023`) |
| `application_recovery_attempts` table | **no** |

If either flag were `"true"` in production today, those paths would be failing
on a missing function on every call. The supporting objects simply are not
there.

## 3. This is not a release gate — I over-stated it

**PR #266 does not change any of the four flags, their call sites, or their
behaviour.** All four already exist in live production exactly as they are.
Whatever they are set to now, they will be identical after publishing.

So this is a standing configuration question, not a pre-publish blocker. I
previously listed it as a gate; that was stronger than the evidence supports.

## 4. Where to check, if you want to confirm

**There is no accessible settings interface I can point you to, and none I can
read.**

- The Lovable MCP/API surface has **no tool** for reading or writing
  environment variables or secrets — it exposes project details, knowledge,
  database, deploy and analytics, and nothing else.
- Lovable's own guidance states secret values are handled **only through a
  secure form in the Lovable editor**, never through the API.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are provisioned automatically by
  Lovable Cloud's Supabase integration — the code's own error says *"Connect
  Supabase in Lovable Cloud."* Those are not user-entered variables.

So the only place a custom variable like these could have been set is the
**Lovable editor's own secrets / environment area for this project**
(https://lovable.dev/projects/8cf1f99e-71ad-4a93-a47c-bfbe833616d6). If no such
entry exists there, the flags are unset — which, per §1, means **off**, which is
the state the release wants.

If the editor shows no secrets area at all, that is also a complete answer:
nothing set them, so they are off.

## 5. Bottom line

| | |
|---|---|
| Risk if never set | **none** — all four are off, which is the desired state |
| Risk to this release | **none** — #266 inherits them unchanged |
| Action required before publishing | **none.** Optional: glance at the Lovable editor's secrets area |
| The one that would matter | `APPLICATION_RESUME_ATOMIC_ENABLED` — and the function it needs does not exist, so it cannot be silently working |
