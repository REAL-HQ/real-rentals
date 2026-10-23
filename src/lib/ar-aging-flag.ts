/**
 * Receivables aging is off until an owner turns this constant on in source.
 * false hides the Payments page section. The server throws before the manager
 * check and before any read. There is no environment variable for this flag.
 */
export const AR_AGING_ENABLED = false;

export const AR_AGING_OFF = "Receivables Aging Is Off";
