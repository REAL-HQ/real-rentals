# Backlog

Known work that is deliberately not in the change that found it.

## Duplicate applications can form chains instead of a flat group

`mergeDuplicateApplications` in `src/lib/applications.functions.ts`.

Admin-only, manually triggered, and pre-existing — it is not part of the
Part 1 / Part 2 change, and was left out of that PR on purpose.

**What goes wrong.** The function groups applications by phone and, separately,
by email, then elects a primary per group with
`rows.find(r => !r.primary_application_id)`. That reads the in-memory snapshot
taken before any linking, so a row linked while processing the phone group is
still seen as unlinked when the email group is processed.

Given A(phone P1, email E1), B(phone P1, email E2), C(phone P2, email E2):

  - the phone group links B to A
  - the email group then elects B as primary and links C to B

C now points at B, which points at A. Nothing resolves that transitively.
`DriversPanel` lists with `.neq("status", "duplicate")`, so B has vanished from
the list and C groups under a key whose primary is not shown — it renders as
orphaned history. `resubmission_count` is also incremented on a row nobody can
see.

**The fix it needs.** Union-find (connected components) over the phone and
email edges, computing one canonical primary per component before writing
anything, then linking every other member of the component directly to it —
never to an intermediate. Resolve existing chains in the same pass so the data
already in production is flattened rather than merely stopped from growing.

**Related, same area, also backlog.** Duplicate *detection* in
`savePartialApplication` matches on exact string equality, so `8135551234` and
`(813) 555-1234` are different people, as are `karen@example.com` and
`Karen@Example.com`. A returning applicant who formats their number differently
gets a second application row. The durable fix is generated normalized columns
— last-ten digits of the phone, lowercased email — with indexes, matched on
those instead. It is a migration with a backfill, which is why it is here and
not inline.
