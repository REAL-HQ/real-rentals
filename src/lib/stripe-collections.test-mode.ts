/**
 * TEST-ONLY Stripe Collections activation. Keep `false` in committed code.
 * When temporarily set to `true` on the local dev server, the UI and server
 * function serve synthetic fixture data — only in development builds
 * (import.meta.env.DEV), never in production. Role authorization still applies.
 */
export const STRIPE_COLLECTIONS_TEST_MODE = false;
