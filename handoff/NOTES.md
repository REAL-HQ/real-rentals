WIP handoff from the previous session. Not a product change.

Unfinished:

- #261 (`cursor/stripe-static-check-b1d6` @ 22d9eadc) static-check update is pushed. The results-file follow-up is not finished and was not pushed to #261.
- `.stripe-ci-results.json` is written by `scripts/ci/stripe/validate.sh` (vitest 3.2.4 `--reporter=json --outputFile=.stripe-ci-results.json`), not by `regressions.mjs`. The collections tests mock Stripe. No live Stripe call was made.
- `static-check.mjs` still requires exactly 67 passed tests in three files. The vitest include `scripts/stripe-collections*.test.ts` also runs recovery and revenue suites. #243 and #250 wrote 91 passed / 0 failed. rc16-all @58bdbd83 also ran `stripe-collections-paid-row.test.ts` and wrote 102 passed / 0 failed. The check then failed `all 67 required tests executed without skip/todo`.
- #250 re-merge is not done. Last pushed head is afc9a0a0, which already contains #254 @81f6beb8. Do not merge a newer #254 head until it is relayed. #257 fold into #254 was in progress with the Integrator.

Sequence actually run, in this order, with the dummy env (`VITE_SUPABASE_URL=http://127.0.0.1:9`, dummy Supabase and payments keys, `NODE_OPTIONS=--max-old-space-size=4096`): `npm run build`, then the vitest results writer, then `node scripts/ci/stripe/static-check.mjs`.

| Tree | build | results writer | static-check |
| --- | --- | --- | --- |
| #243 / #261 | 0 | 0 | 1 |
| #250 @afc9a0a0 | 0 | 0 | 1 |
| rc16-all @58bdbd83 | 0 | 0 | 1 |

`node --test scripts/ci/stripe/static-check.test.mjs` on #261 was 4 passed, exit 0, before this sequence.

`validate.sh` order is network-check, vitest results, tsc, vite build, static-check, regressions, lockfile diff. network-check, tsc, and regressions were not run. CI runs that script inside `unshare --net`.

Next step for #261: decide whether static-check should keep requiring the original 67 tests or also require the extra suites the glob now emits. Do not loosen the 67 assertion without that decision.

`handoff/local-probes/` is scratch harnesses that were untracked in the workspace. `handoff/stripe-ci-results-*.json` are the three writer outputs.
