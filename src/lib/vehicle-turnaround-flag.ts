/**
 * Compile-time gate for Vehicle Turnaround.
 *
 * false: the admin rail has no Vehicle Turnaround tab, a direct
 * ?tab=vehicle_turnaround link falls back to Overview, and
 * getVehicleTurnaround throws before the role check and before any table read.
 * true: Managers and Owners see the tab, and the handler reads the board.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const VEHICLE_TURNAROUND_ENABLED = false;
