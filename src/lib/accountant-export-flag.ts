/**
 * Compile-time gate for the Accountant Year-to-Date Export.
 *
 * false: the admin tab is omitted, a direct link falls back to Overview, and
 * getAccountantExport returns disabled before the owner check and before any
 * table or Stripe read.
 * true: an owner sees one Eastern Time calendar year, month by month, with
 * two browser CSVs.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const ACCOUNTANT_EXPORT_ENABLED = false;
