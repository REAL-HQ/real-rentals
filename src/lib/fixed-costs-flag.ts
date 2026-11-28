/**
 * Compile-time gate for Fixed Costs (Accounting section, Owner only).
 *
 * true: owners see Accounting > Fixed Costs. Until the fixed_cost_items
 * migration is applied the screen says "Setup Needed" and lists nothing,
 * because the server read reports the missing table instead of failing.
 * false: the tab is omitted, a direct link falls back to Overview and the
 * server functions return before the owner check or any read.
 */
export const FIXED_COSTS_ENABLED = true;
