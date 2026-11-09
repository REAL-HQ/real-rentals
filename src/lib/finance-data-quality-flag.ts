/**
 * Finance Data Quality is off until an owner turns this constant on in source.
 * false omits the tab, sends a direct link to Overview, and the server
 * throws before the role check and before any table read.
 * There is no environment variable for this flag.
 */
export const FINANCE_DATA_QUALITY_ENABLED = false;

export const FINANCE_DATA_QUALITY_OFF = "Finance Data Quality Is Off";
