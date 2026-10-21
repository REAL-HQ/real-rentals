/**
 * Compile-time gate for Rental Renewal Due.
 *
 * false: the admin rail has no Renewal Due tab, a direct
 * ?tab=renewals_due link falls back to Overview, and
 * getRenewalsDue throws before the role check and before any table read.
 * true: Managers and Owners see the tab, and the handler reads the list.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const RENEWALS_DUE_ENABLED = false;
