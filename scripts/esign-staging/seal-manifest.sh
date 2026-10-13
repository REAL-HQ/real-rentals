#!/usr/bin/env bash
# ===========================================================================
# Sealing baseline-receipts.json — capture the nine, or validate what somebody
# pasted in.
#
#   seal-manifest.sh capture "<staging connection string>"
#   seal-manifest.sh validate [path-to-manifest]
#
# WHY THIS EXISTS.
#
# install.sh refuses to run while the manifest is UNPOPULATED, and the nine
# values can only come from a read of the staging ledger. Whoever has that
# connection should not have to hand-assemble JSON: a typo in one of nine
# 64-character checksums produces a manifest that refuses a correct ledger,
# and the operator's natural next move is to assume the comparison is broken
# and reach for a way around it.
#
# So: `capture` runs exactly the read-only SELECT documented in
# baseline-receipts.json and writes the file. `validate` checks a manifest
# WITHOUT a database, which is the half that can be run anywhere — including
# by a reviewer who only has the file.
#
# `capture` issues ONE SELECT. It writes nothing to the database, reads no
# customer record, and touches no column outside (stage, sha256, installed_at).
# ===========================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_REF="bhpdppyxnkokzhlkgcsc"
MANIFEST="${ESIGN_STAGING_MANIFEST:-$HERE/baseline-receipts.json}"
MODE="${1:-}"

fail=0
ok() { if [ "$1" = 0 ]; then echo "  PASS  $2"; else fail=$((fail+1)); echo "  BLOCKER  $2"; fi; }

usage() {
  echo "usage: $0 capture \"<staging connection string>\"" >&2
  echo "       $0 validate [path-to-manifest]" >&2
  exit 2
}

# --------------------------------------------------------------- capture
if [ "$MODE" = "capture" ]; then
  CONN="${2:-}"
  [ -n "$CONN" ] || usage
  # Same binding as install.sh, same reason: this is not a production tool.
  if ! printf '%s' "$CONN" | grep -q "$STAGING_REF"; then
    echo "STOP: the connection string does not name the verified staging project ($STAGING_REF)." >&2
    exit 1
  fi
  command -v psql >/dev/null 2>&1 || { echo "STOP: psql not found." >&2; exit 1; }

  TMP="$(mktemp)"
  trap 'rm -f "$TMP"' EXIT
  # The query from baseline-receipts.json's header, verbatim. One SELECT.
  psql "$CONN" -Atq -v ON_ERROR_STOP=1 > "$TMP" <<'SQL'
SELECT jsonb_pretty(jsonb_build_object(
  'status','VERIFIED',
  'database', current_database(),
  'captured_at', now(),
  'receipts', (SELECT jsonb_agg(jsonb_build_object(
       'ordinal', ord, 'stage', stage, 'sha256', sha256) ORDER BY ord)
     FROM (SELECT row_number() OVER (ORDER BY installed_at, stage) AS ord, stage, sha256
             FROM private.staging_install_receipts) r)));
SQL
  [ -s "$TMP" ] || { echo "STOP: the capture query returned nothing." >&2; exit 1; }
  cp "$TMP" "$MANIFEST"
  echo "captured into $MANIFEST"
  echo
  # Never trust a capture without checking it, including its own output.
  exec "$0" validate "$MANIFEST"
fi

# -------------------------------------------------------------- validate
if [ "$MODE" != "validate" ]; then usage; fi
[ -n "${2:-}" ] && MANIFEST="$2"
[ -f "$MANIFEST" ] || { echo "STOP: no manifest at $MANIFEST" >&2; exit 1; }

echo "validating $MANIFEST"
echo

node - "$MANIFEST" <<'NODE' || exit 1
const fs = require("fs");
const path = process.argv[2];
let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

let m;
try { m = JSON.parse(fs.readFileSync(path, "utf8")); }
catch (e) { console.log(`  BLOCKER  the file is not valid JSON — ${e.message}`); process.exit(1); }

ok(m.status === "VERIFIED", `status is VERIFIED (got ${JSON.stringify(m.status)})`);
ok(typeof m.database === "string" && m.database.length > 0,
  `database records where it was captured from (got ${JSON.stringify(m.database)})`);
ok(typeof m.captured_at === "string" && !Number.isNaN(Date.parse(m.captured_at)),
  `captured_at is a real timestamp (got ${JSON.stringify(m.captured_at)})`);

const rs = Array.isArray(m.receipts) ? m.receipts : [];
ok(rs.length === 9, `exactly nine receipts (got ${rs.length})`);

// Ordinals are 1..9, each once. The digest is built in ordinal order, so a
// gap or a duplicate silently reorders the comparison string.
const ords = rs.map((r) => r.ordinal);
ok(ords.length === new Set(ords).size, "no duplicate ordinals");
ok(JSON.stringify([...ords].sort((a, b) => a - b)) === JSON.stringify([1,2,3,4,5,6,7,8,9]),
  `ordinals are 1-9 with no gaps (got ${JSON.stringify([...ords].sort((a,b)=>a-b))})`);

const stages = rs.map((r) => r.stage);
ok(stages.every((s) => typeof s === "string" && s.trim().length > 0), "every stage has a name");
ok(stages.length === new Set(stages).size, "no duplicate stage names");

// A checksum that is not 64 lowercase hex characters is not a sha256, and the
// comparison in preflight is a string compare — so a trailing space or an
// uppercase digit refuses a ledger that actually matches.
const HEX = /^[0-9a-f]{64}$/;
for (const r of rs)
  ok(HEX.test(String(r.sha256)),
    `${String(r.stage).padEnd(28)} sha256 is 64 lowercase hex (got ${String(r.sha256).slice(0, 20)}…)`);

// The checks that exist because of how this file could go wrong: somebody
// filling it in by hand, or copying the test fixture.
const PLACEHOLDER = rs.filter((r) => /^(.)\1{63}$/.test(String(r.sha256)));
ok(PLACEHOLDER.length === 0,
  `no checksum is a single repeated character — a placeholder, not a hash (${PLACEHOLDER.length} found)`);
const SYNTH = stages.filter((s) => /_synthetic$/.test(String(s)));
ok(SYNTH.length === 0,
  `no stage name ends in _synthetic — those are the test fixture's, not staging's (${SYNTH.length} found)`);
ok(!stages.some((s) => /^stage1[012]/.test(String(s))),
  "none of the nine is stage10/11/12 — those are the stages this package installs");

const digest = rs.slice().sort((a, b) => a.ordinal - b.ordinal)
  .map((r) => `${r.ordinal}:${r.stage}:${r.sha256}`).join("|");
console.log();
console.log("  stages, in install order:");
for (const r of rs.slice().sort((a, b) => a.ordinal - b.ordinal))
  console.log(`    ${String(r.ordinal).padStart(2)}  ${String(r.stage).padEnd(32)} ${String(r.sha256).slice(0, 16)}…`);
console.log();
console.log(`  digest        ${require("crypto").createHash("sha256").update(digest).digest("hex")}`);
console.log(`  manifest file ${require("crypto").createHash("sha256").update(fs.readFileSync(path)).digest("hex")}`);
console.log();
console.log(fail ? `${fail} BLOCKER(S) — do not seal this manifest` : "manifest is well formed and ready to seal");
process.exit(fail ? 1 : 0);
NODE

echo
echo "Next: commit the populated manifest, regenerate checksums.json, and"
echo "re-run scripts/esign-staging-install.test.sh before any install."
