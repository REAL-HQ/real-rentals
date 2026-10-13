# eSign staging Worker — preparation only

Nothing here is deployed. This describes the exact artifact an operator would
publish once SQL and Worker deployment are separately approved.

## What it is

The ordinary production build (`npx vite build` → `.output/server`) deployed
with `wrangler.staging.jsonc` in place of the generated
`.output/server/wrangler.json`. **The application code is not forked.** A
staging build that differs from the production build proves nothing about the
production build, so the only differences are this config and the secret
values.

### The build is where the backend is chosen — not the config

`src/integrations/supabase/client.ts` reads
`import.meta.env.VITE_SUPABASE_URL`, and **`import.meta.env.*` is a
build-time replacement**. Vite substitutes the literal value while
compiling, so the browser client's backend is fixed when `vite build` runs
and is NOT read from the Worker's environment afterwards.

The `VITE_*` entries in `wrangler.staging.jsonc` therefore do nothing for the
browser. Build this repo with the ordinary `.env` in place and the staging
Worker serves a client that talks to **production** Supabase while the server
half talks to staging — the worst possible split, because the browser would
be reading and writing real customer records.

So the artifact must be built with the staging values in the environment:

```
VITE_SUPABASE_URL=https://bhpdppyxnkokzhlkgcsc.supabase.co \
VITE_SUPABASE_PROJECT_ID=bhpdppyxnkokzhlkgcsc \
VITE_SUPABASE_PUBLISHABLE_KEY=<staging publishable key> \
  npx vite build

cp scripts/esign-staging/worker/wrangler.staging.jsonc .output/server/wrangler.json
bash scripts/esign-staging/verify-artifact.sh .output          # must pass
npx wrangler deploy --config .output/server/wrangler.json      # after approval
```

`verify-artifact.sh` fails if the production project ref appears anywhere in
the built output, so a build made against the wrong environment cannot be
deployed by mistake. Run it on the exact directory being deployed, every
time.

## Private by construction

| | |
|---|---|
| `workers_dev` | `false` — no `*.workers.dev` hostname |
| `preview_urls` | `false` — no preview deployments |
| `routes` | `[]` — bound to no zone or hostname |
| Reachability | only through the Cloudflare Access application below |

**Google access gate.** A Cloudflare Access application in front of the
Worker, with Google as the identity provider and an explicit staff
allow-list — the same gate the existing staging surfaces use. The Worker has
no public ingress of its own, so the gate is not a layer over an open
service; it is the only door. No global Auth settings are touched: this is
Cloudflare Access in front of the Worker, not Supabase Auth configuration,
and the staging Supabase project's Auth settings are left exactly as they
are.

## Secret manifest

Set with `wrangler secret put` against this Worker. None is written into this
file or the repository.

| Secret | Staging value | Why |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | staging `bhpdppyxnkokzhlkgcsc` key | server reads/writes, and the only path to a signed PDF |
| `SUPABASE_PUBLISHABLE_KEY` | staging publishable key | server-side client |

`VITE_SUPABASE_PUBLISHABLE_KEY` is **not** a Worker secret — it is inlined at
build time (see above) and must be present in the build environment instead.
The staging publishable key is a prerequisite that has to be supplied before
the artifact can be built at all.

**Deliberately not set, so the code path fails closed rather than reaching a
real provider:**

| Secret | |
|---|---|
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_INBOUND_*` | no live email |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_INBOUND_URL` | no live SMS |
| `STRIPE_SECRET_KEY` | no payment surface |
| `ANTHROPIC_API_KEY` | no model calls |
| `LEAD_ALERT_TO`, `INBOUND_INTAKE_ADDRESSES` | no real inbox |
| `DATABASE_URL` | no direct production connection |

With the keys absent, `deliverSigningLink` still runs end to end and records
its outcome on the agreement row (`email_status`, `email_error`,
`sms_status`, `sms_error`) — which is exactly the capture-only behaviour
acceptance needs to observe, and exactly what the engine tests already cover.

## No scheduled work

`wrangler.staging.jsonc` has no `triggers`/`crons` block. The six cron
routes are present in the bundle but nothing fires them. Archive retry is
exercised during acceptance by calling
`/api/public/cron/esign-archive-retry` directly through the Access gate,
never on a timer.

## Verifying the artifact

`npm run test:esign-staging-worker` checks this config rather than trusting
the description above: staging project ref only, no production host anywhere,
no ingress, no cron triggers, capture-only flags set, and no secret value
committed. It also fails if `PUBLIC_SITE_URL` points at a real domain — a
signing link that escaped to a real renter would be a real contract.
