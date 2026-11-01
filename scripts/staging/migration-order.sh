#!/usr/bin/env bash
# Prints the rebuild order for a fresh staging project from release/financial-integrity-3 @ 4fdf5a78.
# NOTE: production has 105 supabase receipts, the tree has 122 files: confirm the exact production list
# (read-only, Owner-approved: SELECT version FROM supabase_migrations.schema_migrations ORDER BY 1) before applying.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
echo "# 1. supabase/migrations (filename order)"; ls supabase/migrations/*.sql | sort
echo "# 2. drizzle/migrations 0000-0022 (journal order)"; ls drizzle/migrations/00{0,1}*.sql drizzle/migrations/002[0-2]*.sql | sort
echo "# 3. guarded packages (adapted copies pinned to the NEW system id), in production order:"
echo "   0031 v2 (git e0c2fe6e docs/security/0031-package-v2) -> S1 (source NOT in repo) -> activation-insurance-setting -> insurance-verification-authority -> payments-delete-guard -> payments-write-guard (origin/fix/payments-write-guard-sql ed2ed072) -> 0023 (origin/feature/app-resume-finish b0f5158d)"
