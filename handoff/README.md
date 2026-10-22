# Handoff notes, 22 Oct 2026

Work is already on the draft pull-request branches. This branch only keeps local rehearsal logs that were not in git. No production SQL was run for this note. No new rehearsal was started.

## Unfinished

Pull request 226 head `30703b013b3fe69111c12f249c16c37d7718acc5` is the only Uber and Lyft date install. That commit changes two comment lines on `proposed/driver-doc-expiry-tnc.sql`. The scratch rehearsal `rb226` was run on the parent `e01ef62f6399e5e08021bf4c3151a556af16864d`, whose executable SQL matches this head. The deduped head itself was not re-applied, re-applied, or rolled back. That rehearsal stays unfinished.

`rb226` result, parent only: `lock_timeout` was 5s, a second apply kept both columns, anon was refused with permission denied, and the rollback matched the clone. The clone was dropped. There is no log file for that run in this folder.

## Logs in this folder

`m3-proof-run.log` is the local M3 scratch proof that became pull request 232 head `a1f3e3464489f608002cbfbbeedfc45369e5663a`. The old date file and its old undo refused. The waitlist file applied twice. Its undo matched the clone. Exit 0. Clone `m3_rehearsal` was dropped.

`rbfeat.log` is the local scratch proof of swap (`proposed/m2-packet/20.sql`) and extend (`proposed/m2-packet/extend.sql`) after M2 steps 1 through 25. Second applies matched. Both rollbacks matched the pre-step dump. Clone `rbfeat` was dropped. Those files are on pull request 190. Later commits on 190 and 253 are documentation only.

Schema dumps from those clones were left out of this branch.
