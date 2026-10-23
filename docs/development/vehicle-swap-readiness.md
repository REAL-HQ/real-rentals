# Vehicle Swap — where its SQL actually is

Recorded 2026-10-23 by Claude Code. No SQL executed. Flag `SWAP_ENABLED` is a
hard `false` and stays that way.

## The pointer on the release candidate is dangling

`proposed/vehicle-swap-v1.sql` on RC `67b62664` is a five-line pointer:

> *"The vehicle swap SQL has one source: proposed/m2-packet/20.sql"*

**`proposed/m2-packet/` does not exist on that branch**, so following the
pointer from the candidate leads nowhere. It was never deleted — the M2 packet
was simply never merged into the RC's lineage (`29d47ee3` is not an ancestor of
`67b62664`). Harmless for the release: nothing under `proposed/` runs, and the
feature is off. It matters the moment someone tries to approve the migration.

## The authoritative file

| | |
|---|---|
| Path | `proposed/m2-packet/20.sql` |
| Commit | `29d47ee3` — *"Make swap and extend installs idempotent with a 5 second lock timeout."* (2026-10-22) |
| Size | 23,111 bytes |
| **SHA-256** | `57260b67d037f8173a972054ff278b4c75abe49a3ebd606e1b139520a03e71ea` |
| Branches | `origin/cursor/m2-packet-grants-ba3d`, `origin/handoff/wip-M2-2026-10-22` |

Retrieve with `git show 29d47ee3:proposed/m2-packet/20.sql`, and check that
hash before treating any copy as the real one. Three older versions exist in
history (`c23e187d…`, `dd58a035…`, `96bba3dd…`); none is current.

## It cannot be installed on its own

The file states its own prerequisite: install only after the Record Rental
payloads that create `booking_vehicle_assignments`, `assignment_closures`,
`record_operations`, `private.approval_lock()`, `private.approval_actor()` and
`rr_record_executor`. It creates none of them.

So **Vehicle Swap is downstream of Record Rental**, and both sit inside the M2
hosted install (swap is step 26). Approving swap alone is not possible.

## Status

**Blocked** — on the M2 packet, which is a separate owner approval, and on
Record Rental landing first. Nothing here is actionable without that.

The one thing that would help the candidate: the pointer should name the commit
and hash above instead of a path that is not on the branch. **Not changed** —
RC `67b62664` is frozen and this is not release-blocking.
