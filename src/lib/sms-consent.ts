/**
 * The SMS opt-in REAL RENTALS shows applicants, verbatim, with a version.
 *
 * This exact wording is what the toll-free carrier registration describes.
 * Changing a word means bumping SMS_CONSENT_VERSION so stored evidence keeps
 * pointing at the text the person actually agreed to. The server stores the
 * text from this module, never text sent by the browser.
 *
 * Transactional / customer-care only. No marketing consent lives here.
 */
export const SMS_CONSENT_VERSION = "2026-10-07.v1";

export const SMS_CONSENT_LABEL =
  "I agree to receive text messages from REAL RENTALS about my application, rental, payments, vehicle pickup and return, service, and customer support.";

/** Disclosure shown under the checkbox. "Terms" and "Privacy Policy" are rendered as links. */
export const SMS_CONSENT_DISCLOSURE =
  "By checking this box, you agree to receive recurring transactional SMS messages from REAL RENTALS at the mobile number provided. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of renting a vehicle. View our Terms and Privacy Policy.";

/** Full text stored as evidence with each affirmative consent. */
export const SMS_CONSENT_TEXT = `${SMS_CONSENT_LABEL} ${SMS_CONSENT_DISCLOSURE}`;

export const SMS_CONSENT_SOURCE_WEB = "website_application";

/**
 * Intended first message once a provider is connected. NOT sent anywhere yet.
 */
export const SMS_OPT_IN_CONFIRMATION =
  "REAL RENTALS: You're opted in to receive text updates about your application and rental. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help.";

/** HELP auto-reply, given the canonical business phone display string. */
export function smsHelpReply(phoneDisplay: string): string {
  return `REAL RENTALS: Rental support at ${phoneDisplay} or team@drivereal.com. Msg & data rates may apply. Reply STOP to opt out.`;
}
