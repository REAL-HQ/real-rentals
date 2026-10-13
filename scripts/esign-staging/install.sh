#!/usr/bin/env bash
# ===========================================================================
# eSign staging installer. PREPARATION ONLY — nothing here runs by itself.
#
#   ./install.sh "<staging connection string>" [--stage N] [--dry-run]
#
# Three stages, in this order, each one transaction:
#
#   stage10_agreements_baseline   01_agreements_baseline.sql + 02_private_storage.sql
#   stage11_esign_0023            ../esign-release/0023_esign_template_versioning_library.sql
#   stage12_esign_0024            ../esign-release/0024_esign_agreement_numbering.sql
#
# Each stage: BEGIN -> preflight -> payload -> receipt -> postflight -> COMMIT.
# Any failure at any point rolls the whole stage back, receipt included, so a
# stage is installed completely or not at all. There is no partial state to
# clean up and no receipt for work that did not land.
#
# The 0023/0024 payloads are the reviewed files, byte for byte. This runner
# checksums them before execution and refuses to run on any mismatch, so the
# approved SHA-256s stay authoritative — they are never re-embedded or edited
# into this package.
#
# Stops on: a missing prerequisite, a ledger that is not the expected shape,
# a receipt count that is not what the review assumed, a stage already
# recorded, partial schema, or any postflight check that does not pass.
# ===========================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE="$HERE/../esign-release"
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

# ---------------------------------------------------------------- checksums
# The reviewed SHA-256s. A mismatch means the file under this name is not the
# file that was reviewed, and nothing is executed.
EXPECT_0023="675bff0e8cba301581209c6c2a4f4cd7d485676c47a9e3920de87622c129acc7"
EXPECT_0024="199f57eda905ef73f9d531f813abc8b2f16759a8b0e89b6920f2985ba55d9aa8"

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

SHA_BASE="$(verify "$HERE/01_agreements_baseline.sql" "")"
SHA_STOR="$(verify "$HERE/02_private_storage.sql" "")"
SHA_0023="$(verify "$RELEASE/0023_esign_template_versioning_library.sql" "$EXPECT_0023")"
SHA_0024="$(verify "$RELEASE/0024_esign_agreement_numbering.sql" "$EXPECT_0024")"

echo "payload checksums"
printf '  %-34s %s\n' "01_agreements_baseline.sql" "$SHA_BASE"
printf '  %-34s %s\n' "02_private_storage.sql"     "$SHA_STOR"
printf '  %-34s %s  (reviewed)\n' "0023_...library.sql" "$SHA_0023"
printf '  %-34s %s  (reviewed)\n' "0024_...numbering.sql" "$SHA_0024"

if [ "$DRY" = 1 ]; then
  echo
  echo "--dry-run: checksums verified, nothing executed."
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
    echo "BEGIN;"
    echo "\\i $HERE/preflight.sql"
    for f in "$@"; do echo "\\i $f"; done
    # The receipt, in the same transaction as the work it records.
    cat <<SQL
INSERT INTO private.staging_install_receipts (stage, sha256, applied_at)
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
