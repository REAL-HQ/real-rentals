/**
 * Compile-time gate for Fleet Calendar.
 *
 * false: the admin rail has no Fleet Calendar tab, a direct ?tab=fleet_calendar
 * link falls back to Overview, and getFleetCalendar throws before the role
 * check and before any table read.
 * true: Managers and Owners see the tab, and the handler reads the week.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const FLEET_CALENDAR_ENABLED = false;
