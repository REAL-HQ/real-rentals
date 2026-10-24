# Release A: publication record (2026-10-24)

## Pre-publication gates (all passed)

| Gate | Result |
|---|---|
| Preview checks on `14cbf81b` (owner's browser session, read-only) | 4/4 PASS. No Verify Identity control; Applications list (All 142) and applicant detail load; the document vault shows and opens an existing licence; no new app console errors. Page HTML `data-commit-sha` = `14cbf81b…` |
| "No Drivers Yet" flash before the list loads | Pre-existing #266 behaviour. It comes from `DriversPanel.tsx`, which Release A does not touch. Not a regression |
| `c83b318d` scope | docs plus a read-only watch query only; not on the Preview branch |
| Preview branch / Lovable latest commit / agent | `14cbf81b…` / `14cbf81b…` / idle |
| M2 installed? | no (`m2_step2_present` false) |
| Security 0031 / policies / journals | `[5, d33877618a9f40924d14e49b6653d7fa]` / 170 / Drizzle 23, Supabase 105 |
| Rollback | `git revert -m 1 14cbf81b` → tree `103eb6b7` (pre-computed). Refs `rollback/pre-release-a-7c7d7b6b`, `rollback/live-rc266-67b62664` and `rollback/pre-rc266-7e3e6eb6` in place |

## Publish

- **Call:** `deploy_project` once, no retry, at about 23:44Z.
- **Response:** `status: pending`, deployment id `8818c842-344c-4143-b9dc-d5bb1ef33443`, URL
  `https://charming-maker-space.lovable.app`.
- **Completion and the served commit could not be read from this session.** The proxy refuses the
  live hosts, and `get_project` does not expose deployment state. The owner confirms in a browser:
  the page source of the live site shows `data-commit-sha="14cbf81b906cd7c65a587a1dba53c0b8e87d1b1f"`,
  and the custom domain still serves it.

## Baseline (`release-a-watch-readonly.sql`, sha256 `85516bc8…71de`)

| | Pre-publish 23:43:49Z | Post-publish 23:56:07Z |
|---|---|---|
| applications / approved | 148 / 2 | 148 / 2 |
| approval audit rows / last 24 h / apps with more than one approval in 24 h | 4 / 0 / 0 | 4 / 0 / 0 |
| documents / uploads 24 h / uploads without object | 91 / 0 / 0 | 91 / 0 / 0 |
| storage objects / audit rows 24 h | 128 / 5 | 128 / 5 |
| 0031 / policies / Drizzle / Supabase | `d3387761…` / 170 / 23 / 105 | identical |
| M2 step 2 present | false | false |

## Watch (24 h) status

- **Smoke tests on the live site** (§C items 7–9): owner, in a browser, read-only. The session
  cannot reach the live hosts.
- **Item 11** (a natural approval) and **item 12** (a natural upload): PENDING until they occur.
- **Item 13** (no new server errors in the Lovable logs): owner. No log access from this session.
- **Watch query re-run:** at about 23:45Z on 2026-10-25, then compare.
