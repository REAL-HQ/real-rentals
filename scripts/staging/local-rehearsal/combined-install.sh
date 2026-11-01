#!/usr/bin/env bash
# LOCAL ONLY. Combined security rehearsal on the disposable baseline (db "postgres" cloned from rrbase_tpl).
# Packages are ADAPTED copies: only the system identifier (and 0031's pre-install catalog hash) are substituted;
# the substitutions are printed. Unguarded inner package files are used (the outer byte-guards pin production bytes).
set -uo pipefail; R="$(git rev-parse --show-toplevel)"; PK="${PK:-/workspace/pk}"; T=$(mktemp -d)
P="psql -h /tmp -p 55499 -U postgres -v ON_ERROR_STOP=1 -qAt"
$P -d template1 -c "DROP DATABASE IF EXISTS postgres WITH (FORCE)" -c "CREATE DATABASE postgres TEMPLATE rrbase_tpl" >/dev/null
SYS=$($P -d postgres -c "select system_identifier from pg_control_system()")
case "$SYS" in 7642734024280108049|7702070854497379551|7692130048193495360) echo REFUSED; exit 1;; esac
CAT=$($P -d postgres -f "$R/scripts/staging/local-rehearsal/0031-catalog-hash.sql")
adapt(){ sed -e "s/7642734024280108049/$SYS/g" -e "s/c753236ecd2c4067c9bce7262d7b4786f5c9ea8bcbb42ce531e8deba3db41446/$CAT/g" "$1" > "$T/$(basename "$1")"; echo "  adapted $(basename "$1"): $(diff "$1" "$T/$(basename "$1")" | grep -c '^>') line(s) changed"; }
ro(){ $P -d postgres -c "BEGIN READ ONLY" -f "$1" -c "ROLLBACK" 2>&1 | grep -v '^SET$'; }
step(){ local name="$1" pkg="$2" pre="${3:-}" post="${4:-}"
  echo "== $name"
  [[ -n "$pre" ]] && { adapt "$pre"; out=$(ro "$T/$(basename "$pre")"); echo "$out" | grep -qE '\|f$' && echo "  PREFLIGHT not-ok rows: $(echo "$out" | grep -E '\|f$' | cut -d'|' -f1 | tr '\n' ' ')" || echo "  preflight ok"; }
  adapt "$pkg"; if out=$($P -d postgres -f "$T/$(basename "$pkg")" 2>&1); then echo "  INSTALL OK"; else echo "  INSTALL FAILED: $(echo "$out" | grep -m1 ERROR)"; return 1; fi
  [[ -n "$post" ]] && { adapt "$post"; out=$(ro "$T/$(basename "$post")"); bad=$(echo "$out" | grep -E '\|f$' | cut -d'|' -f1 | tr '\n' ' '); [[ -z "$bad" ]] && echo "  verify-after ok ($(echo "$out" | grep -c '|t$') rows)" || echo "  VERIFY-AFTER not-ok: $bad"; }
  return 0; }
step "0031 v2" "$PK/docs/security/0031-package-v2/0031_guarded_coordinator_containment_v2.sql" || exit 1
echo "== RECONSTRUCTED S1"; "$R/proposed/security-s1-RECONSTRUCTED/src/build-request.sh" "$SYS" > "$T/s1.sql"; $P -d postgres -f "$T/s1.sql" >/dev/null 2>"$T/s1.err" && echo "  INSTALL OK" || { echo "  INSTALL FAILED: $(grep -m1 ERROR "$T/s1.err")"; exit 1; }
A=$PK/proposed/activation-insurance-setting; step "insurance activation setting" "$A/activation_insurance_setting_v1.sql" "$A/preflight-readonly.sql" "$A/verify-after-readonly.sql" || exit 1
A=$PK/proposed/insurance-verification-authority; step "insurance verification authority" "$A/insurance_verification_authority_v1.sql" "$A/preflight-readonly.sql" "$A/verify-after-readonly.sql" || exit 1
A=$PK/proposed/payments-delete-guard; step "payments DELETE guard" "$A/payments_delete_guard_v1.sql" "$A/preflight-readonly.sql" "$A/verify-after-readonly.sql" || exit 1
A=$PK/proposed/payments-write-guard; step "payments write guard" "$A/payments_write_guard_v1.sql" "$A/preflight-readonly.sql" "$A/verify-after-readonly.sql" || exit 1
A=$PK/proposed/application-resume-0023; step "0023" "$A/application_resume_0023_v1.sql" "$A/preflight-readonly.sql" "$A/verify-after-readonly.sql" || exit 1
echo "== installed in order; snapshot saved as db rr_secured_tpl"
$P -d template1 -c "DROP DATABASE IF EXISTS rr_secured_tpl" -c "CREATE DATABASE rr_secured_tpl TEMPLATE postgres" >/dev/null
