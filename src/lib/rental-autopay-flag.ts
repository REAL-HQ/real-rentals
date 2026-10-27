/**
 * The only declaration of the weekly-autopay start switch. It is a hard false.
 *
 * Starting autopay is off for launch: the subscription request sent today is
 * rejected by Stripe (subscription items need an existing Price/Product, not
 * product_data), nothing stops two starts creating two subscriptions, and End
 * Rental does not cancel a subscription. Staff charge the card weekly with
 * Charge Card until a corrected start is verified in Stripe test mode.
 * Stopping autopay is never gated by this switch.
 */
export const RENTAL_AUTOPAY_START_ENABLED: boolean = false as boolean;

export const AUTOPAY_START_OFF_MESSAGE =
  "Weekly autopay is turned off for now. Charge the card each week with Charge Card.";
