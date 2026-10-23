/**
 * Compile-time gate for Today's Ops.
 *
 * false: the admin rail has no Today's Ops tab, a direct ?tab=todays_ops link
 * falls back to Overview, and getTodaysOps throws before the role check and
 * before any table read.
 * true: Managers and Owners see the tab, and the handler reads the board.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const TODAYS_OPS_ENABLED = false;
