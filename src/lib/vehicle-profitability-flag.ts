/**
 * Vehicle Profitability is off until this constant is turned on in source.
 * false throws before the manager check and before any payment, rental,
 * expense, or maintenance read, omits the tab, and sends a direct link to Overview.
 * There is no environment variable for this flag.
 */
export const VEHICLE_PROFITABILITY_ENABLED = false;
export const VEHICLE_PROFITABILITY_OFF = "Vehicle Profitability Is Off";
