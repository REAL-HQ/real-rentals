/**
 * Deposit Ledger is off until an owner turns this constant on in source.
 * false omits the tab. The server throws before the manager check and before
 * any deposit read. There is no environment variable for this flag.
 */
export const DEPOSIT_LEDGER_ENABLED = false;

export const DEPOSIT_LEDGER_OFF = "Deposit Ledger Is Off";

/**
 * Days Since Close and the closed-only Due Back filter stay off until an
 * owner turns this constant on in source. A request for that filter throws
 * before the manager check. There is no environment variable for this flag.
 */
export const DEPOSIT_RETURNS_DUE_ENABLED = false;

export const DEPOSIT_RETURNS_DUE_OFF = "Deposit Returns Due Is Off";
