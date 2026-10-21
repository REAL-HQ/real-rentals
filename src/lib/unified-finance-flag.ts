/**
 * Compile-time gate for the root finance session observer.
 *
 * false: useSessionIsolation keeps the production auth listener. It does not
 * construct the finance observer, clear unified-finance queries, or ignore a
 * late getSession result.
 * true: that same hook installs createFinanceSessionObserver.
 *
 * This constant does not make getUnifiedFinanceReport return a report. That
 * handler always answers disabled after the current-role check until an owner
 * wires the report builder. No environment variable can open it.
 */
export const UNIFIED_FINANCE_ENDPOINT_ENABLED = false;
