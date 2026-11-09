/**
 * Tax Year Export is off until this constant is turned on in source.
 * false throws before the owner check and before any payment, refund,
 * expense, or maintenance read, omits the tab, and sends a direct link to Overview.
 * There is no environment variable for this flag.
 */
export const TAX_EXPORT_ENABLED = false;
export const TAX_EXPORT_OFF = "Tax Year Export Is Off";
