/**
 * Compile-time gate for Returns Due.
 *
 * false: the admin rail has no Returns Due tab, a direct
 * ?tab=returns_due link falls back to Overview, and
 * listReturnsDue throws before the role check and before any table read.
 * true: Managers and Owners see the tab, and the handler reads the list.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const RETURNS_DUE_ENABLED = false;
