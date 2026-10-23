# The environment variables I cannot read — where to check them

**Correcting myself:** I have been saying "two env flags". There are **four**.
The repo keeps the authoritative list in `scripts/live-enabled-flags.mjs`, and a
test (`scripts/enabled-flags-no-env.test.mjs`) already fails if a new flag starts
reading the environment — so this list cannot go stale.

Two of the four send messages to real people, which I had not called out.

## Where

The build targets **Cloudflare Workers** (the Nitro preset is
`cloudflare-module`, and the code notes "Cloudflare binds env at request time").
So these are Worker variables, not anything in the repo:

> **Cloudflare dashboard → Workers & Pages → the REAL RENTALS project →
> Settings → Variables and Secrets →** the **Production** environment.

If Lovable manages the deployment for you, the same values appear under the
project's environment/secrets settings in Lovable Cloud.

A value only counts as "on" when it is the exact string `true`.

## What to look for

| Variable | If it is `true` | Want |
|---|---|---|
| **`APPLICATION_RESUME_ATOMIC_ENABLED`** | Application Resume calls `reserve_application_recovery` / `finish_application_recovery` — **functions that exist only in pending migration 0023**. Recovery sends would fail at the call. | **not `true`** |
| `RENTER_LIFECYCLE_NOTICES_ENABLED` | Renters get **lifecycle notices** after a rental or incident write | your call |
| `DRIVER_ISSUE_ALERTS_ENABLED` | Staff get an **email** each time a driver files an issue | your call |
| `STRIPE_RECONCILIATION_ENABLED` | Turns on the reconciliation activation pin | your call |

The first is the one that matters for this release: it is the only link between
#266 and a migration that has not been installed. The code states the rule
itself — *"Set `APPLICATION_RESUME_ATOMIC_ENABLED=true` only after that SQL."*

## Record them here before publishing

```
APPLICATION_RESUME_ATOMIC_ENABLED  = ______    (must not be "true")
RENTER_LIFECYCLE_NOTICES_ENABLED   = ______
DRIVER_ISSUE_ALERTS_ENABLED        = ______
STRIPE_RECONCILIATION_ENABLED      = ______
```

Nothing in #266 changes any of these. They already exist in production exactly
as they are; publishing does not alter them. This is a confirmation, not a
change.
