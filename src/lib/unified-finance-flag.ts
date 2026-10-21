/**
 * Compile-time gate for Unified Finance.
 *
 * false: useSessionIsolation keeps the production auth listener. It does not
 * construct the finance observer, clear unified-finance queries, or ignore a
 * late getSession result. getUnifiedFinanceReport answers disabled after the
 * current-role check and does not read finance tables. The admin screen is omitted.
 * true: that same hook installs createFinanceSessionObserver, the handler builds
 * the report, and the Unified Finance admin tab is shown to managers and owners.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const UNIFIED_FINANCE_ENDPOINT_ENABLED = false;
