/**
 * Billing controls stay off until an owner turns a constant on in source.
 * There is no environment variable for these flags. Apply and extension
 * recording stay off even if a product flag is later enabled, until
 * proposed/billing-controls-v1.sql is installed.
 */
export const BILLING_PM_UPDATE_LINK_ENABLED = false;
export const BILLING_DAY_CHANGE_ENABLED = false;
export const BILLING_ONE_TIME_EXTENSION_ENABLED = false;
export const BILLING_DAY_APPLY_ENABLED = false;
export const BILLING_EXTENSION_RECORD_ENABLED = false;

export const BILLING_PM_UPDATE_LINK_OFF = "Payment method update links are off.";
export const BILLING_DAY_CHANGE_OFF = "Billing day changes are off.";
export const BILLING_ONE_TIME_EXTENSION_OFF = "Payment extensions are off.";
export const BILLING_DAY_APPLY_OFF = "Billing day apply is off until the operation journal is installed.";
export const BILLING_EXTENSION_RECORD_OFF = "Payment extension recording is off until the exception table is installed.";
