#!/usr/bin/env bash
# ===========================================================================
# eSign staging installer. PREPARATION ONLY — nothing here runs by itself.
#
#   ./install.sh "<staging connection string>" [--stage N] [--dry-run]
#
# THIS INSTALLER IS NOT EXECUTABLE END TO END THROUGH THE ORDINARY STAGING
# CONNECTION, AND DOES NOT CLAIM TO BE.
#
#   03_storage_policy.privileged.sql creates a policy on storage.objects.
#   Postgres requires superuser or ownership of that table to do so, and the
#   staging connection runs as postgres, which is neither a superuser nor a
#   member of its owner supabase_storage_admin. That file is therefore NOT
#   driven from here. It is applied first, through a separately reviewed
#   privileged path that has not yet been identified, and stage10 refuses to
#   run until its policy is present.
#
#   So the order is:
#     0.  03_storage_policy.privileged.sql   <-- privileged path, not this script
#     10. stage10_agreements_baseline        01 + 02 (bucket only)
#     11. stage11_esign_0023                 ../esign-release/0023_...sql
#     12. stage12_esign_0024                 ../esign-release/0024_...sql
#
# Each stage: BEGIN -> preflight -> payload -> receipt -> postflight -> COMMIT.
# Any failure at any point rolls the whole stage back, receipt included, so a
# stage is installed completely or not at all. There is no partial state to
# clean up and no receipt for work that did not land.
#
# Concurrency: preflight takes a transaction-scoped advisory lock and a NOWAIT
# lock on the ledger, so a second installer is refused rather than queued.
#
# The 0023/0024 payloads are the reviewed files, byte for byte. This runner
# checksums them before execution and refuses to run on any mismatch, so the
# approved SHA-256s stay authoritative — they are never re-embedded or edited
# into this package. The baseline and storage files are pinned the same way.
#
# Stops on: an unpopulated receipt manifest, a connection that is not the
# verified staging target, a ledger that is not the expected shape, the nine
# existing receipts differing in name/checksum/order, a receipt count that is
# not what the sequence expects, a stage already recorded, a missing
# prerequisite, partial schema, a missing privileged storage policy, or any
# postflight check that does not pass.
# ===========================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE="$HERE/../esign-release"
# The manifest path. Overridable only so the disposable-PostgreSQL test can
# point at a generated one; an operator never sets it.
MANIFEST="${ESIGN_STAGING_MANIFEST:-$HERE/baseline-receipts.json}"
# shellcheck source=manifest.sh
. "$HERE/manifest.sh"
STAGING_REF="bhpdppyxnkokzhlkgcsc"

CONN="${1:-}"
shift || true
ONLY_STAGE=""
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --stage) ONLY_STAGE="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$CONN" ]; then
  echo "usage: $0 \"<staging connection string>\" [--stage 10|11|12] [--dry-run]" >&2
  exit 2
fi

sha() { sha256sum "$1" | cut -d' ' -f1; }

# ------------------------------------------------------------ target binding
# Part one, here: the connection names the verified staging project. Part two
# is in preflight, where the nine pinned receipts must reproduce exactly —
# which is the check that actually matters, because a hostname can be
# tunnelled or copied and a ledger cannot.
if ! printf '%s' "$CONN" | grep -q "$STAGING_REF"; then
  echo "STOP: the connection string does not name the verified staging project ($STAGING_REF)." >&2
  echo "      This installer is bound to that backend. It is not a production tool and" >&2
  echo "      there is no override flag." >&2
  exit 1
fi

# ------------------------------------------------- the pinned nine receipts
MF_STATUS="$(jread status)"
if [ "$MF_STATUS" != "VERIFIED" ]; then
  cat >&2 <<MSG
STOP: baseline-receipts.json is "$MF_STATUS", not VERIFIED.

The nine existing receipts in private.staging_install_receipts have not been
recorded here, so there is nothing to compare the live ledger against — and
no second proof that this is the right database. They are deliberately not
guessed: a made-up stage name or checksum would make the comparison pass
against a ledger nobody checked.

Populate $MANIFEST
from the read-only query in its own header, have the result reviewed, then
re-run. Nothing was executed.
MSG
  exit 1
fi
MF_COUNT="$(jread count)"
if [ "$MF_COUNT" != "9" ]; then
  echo "STOP: baseline-receipts.json pins $MF_COUNT receipt(s); the reviewed sequence assumes 9." >&2
  exit 1
fi
BASELINE_DIGEST="$(jread digest)"
EXPECT_DB="$(jread database)"

# ---------------------------------------------------------------- checksums
# The reviewed SHA-256s. A mismatch means the file under this name is not the
# file that was reviewed, and nothing is executed.
EXPECT_BASE="c1c875fb616707bf04082272a70e54d29d78aca21d38524fc08bb6e8bd656ed6"
EXPECT_STOR="3b80aa229cb4f8b275207b4f4b1a789e2c18c181660335e2f685009bb2d641fb"
EXPECT_POLICY="b2dc593ce214ef78f07c8f127087dddc30149960f3456c3e429a7e7cd7bdeb68"
EXPECT_0023="675bff0e8cba301581209c6c2a4f4cd7d485676c47a9e3920de87622c129acc7"
EXPECT_0024="199f57eda905ef73f9d531f813abc8b2f16759a8b0e89b6920f2985ba55d9aa8"
# preflight and postflight ARE the safety checks — every refusal in this
# package lives in one of them. An edited preflight is a disarmed installer,
# so they are pinned exactly like the payloads.
EXPECT_PREFLIGHT="bd2c6e207f711fdf89c4a4f3e4e44327d77e78fe50a8226edcf8258ce06dfd32"
EXPECT_POSTFLIGHT="b308d0b6cfa840e6c1936b3bff6336045c4e88f49efd24e780e3ac20d0be47c4"

verify() {
  local file="$1" want="$2" got
  [ -f "$file" ] || { echo "STOP: missing payload $file" >&2; exit 1; }
  got="$(sha "$file")"
  if [ -n "$want" ] && [ "$got" != "$want" ]; then
    echo "STOP: checksum mismatch for $(basename "$file")" >&2
    echo "  expected $want" >&2
    echo "  actual   $got" >&2
    exit 1
  fi
  echo "$got"
}

SHA_BASE="$(verify "$HERE/01_agreements_baseline.sql" "$EXPECT_BASE")"
SHA_STOR="$(verify "$HERE/02_private_storage.sql" "$EXPECT_STOR")"
SHA_POL="$(verify "$HERE/03_storage_policy.privileged.sql" "$EXPECT_POLICY")"
SHA_0023="$(verify "$RELEASE/0023_esign_template_versioning_library.sql" "$EXPECT_0023")"
SHA_0024="$(verify "$RELEASE/0024_esign_agreement_numbering.sql" "$EXPECT_0024")"
SHA_PRE="$(verify "$HERE/preflight.sql" "$EXPECT_PREFLIGHT")"
SHA_POST="$(verify "$HERE/postflight.sql" "$EXPECT_POSTFLIGHT")"

echo "payload checksums"
printf '  %-36s %s  (pinned)\n' "01_agreements_baseline.sql"       "$SHA_BASE"
printf '  %-36s %s  (pinned)\n' "02_private_storage.sql"           "$SHA_STOR"
printf '  %-36s %s  (pinned, NOT run here)\n' "03_storage_policy.privileged.sql" "$SHA_POL"
printf '  %-36s %s  (reviewed)\n' "0023_...library.sql"             "$SHA_0023"
printf '  %-36s %s  (reviewed)\n' "0024_...numbering.sql"           "$SHA_0024"
printf '  %-36s %s  (pinned)\n' "preflight.sql"                    "$SHA_PRE"
printf '  %-36s %s  (pinned)\n' "postflight.sql"                   "$SHA_POST"
echo "pinned baseline: 9 receipts, digest $(printf '%s' "$BASELINE_DIGEST" | sha256sum | cut -c1-16)"

if [ "$DRY" = 1 ]; then
  echo
  echo "--dry-run: checksums and manifest verified, nothing executed."
  echo "reminder: 03_storage_policy.privileged.sql must be applied through the"
  echo "          privileged path BEFORE stage10, and this script cannot do it."
  exit 0
fi

# ------------------------------------------------------------------ staging
# One stage, one transaction. ON_ERROR_STOP makes psql abort the whole
# transaction on the first failing statement rather than carrying on.
run_stage() {
  local name="$1" expect="$2" payload_sha="$3"; shift 3
  echo
  echo "=== $name ==="
  {
    echo "\\set ON_ERROR_STOP on"
    echo "\\set stage_name '$name'"
    echo "\\set payload_sha '$payload_sha'"
    echo "\\set expect_receipt $expect"
    echo "\\set baseline_digest '$BASELINE_DIGEST'"
    echo "\\set expect_database '$EXPECT_DB'"
    echo "BEGIN;"
    echo "\\i $HERE/preflight.sql"
    for f in "$@"; do echo "\\i $f"; done
    # The receipt, in the same transaction as the work it records. The column
    # is installed_at — the verified staging ledger's own name for it.
    cat <<SQL
INSERT INTO private.staging_install_receipts (stage, sha256, installed_at)
VALUES (:'stage_name', :'payload_sha', now());
SQL
    echo "\\set expect_receipt_after $((expect + 1))"
    echo "\\i $HERE/postflight.sql"
    echo "COMMIT;"
  } | psql "$CONN" -v ON_ERROR_STOP=1 -q -f -
  echo "$name: committed"
}

case "$ONLY_STAGE" in
  ""|10) run_stage stage10_agreements_baseline 9  "$SHA_BASE:$SHA_STOR" \
           "$HERE/01_agreements_baseline.sql" "$HERE/02_private_storage.sql" ;;
esac
case "$ONLY_STAGE" in
  ""|11) run_stage stage11_esign_0023 10 "$SHA_0023" \
           "$RELEASE/0023_esign_template_versioning_library.sql" ;;
esac
case "$ONLY_STAGE" in
  ""|12) run_stage stage12_esign_0024 11 "$SHA_0024" \
           "$RELEASE/0024_esign_agreement_numbering.sql" ;;
esac

echo
echo "done. Run verify.sql against the same database to confirm the result."
