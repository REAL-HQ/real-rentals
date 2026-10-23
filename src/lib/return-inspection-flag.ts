/**
 * Compile-time gate for Return Inspection.
 *
 * false: the admin rail has no Return Inspection tab, a direct
 * ?tab=return_inspection link falls back to Overview, and both server
 * functions throw before the role check and before any table read.
 * true: Managers and Owners see the tab, and the handlers read one rental.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const RETURN_INSPECTION_VIEW_ENABLED = false;
