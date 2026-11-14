/**
 * One-time backfill of successful Stripe payments into public.payments.
 *
 * Default: dry-run. Prints the Nov 12, 2026 preview and exits 0.
 * This script will not write to any database. After Dolmar approves going
 * live, apply supabase/migrations/20261113010000_payment_receipt_links.sql
 * first, then run proposed/payment-receipts-backfill-2026-11-12.sql.
 *
 * Usage: bun scripts/backfill-payment-receipts.ts
 */
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

function main() {
  if (APPLY) {
    console.error("Refusing to apply. This backfill is dry-run only until Dolmar approves a production run.");
    console.error("After approval: apply 20261113010000_payment_receipt_links.sql, then run proposed/payment-receipts-backfill-2026-11-12.sql.");
    process.exit(1);
  }
  const preview = readFileSync("proposed/payment-receipts-backfill-preview.md", "utf8");
  const sql = readFileSync("proposed/payment-receipts-backfill-2026-11-12.sql", "utf8");
  if (!sql.includes("PREPARED, NOT RUN") || !sql.includes("notified_status")) {
    throw new Error("Backfill SQL is missing its safety markers");
  }
  console.log(preview);
  console.log("Dry-run only. No database writes were made.");
}

main();
