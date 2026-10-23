/** Live Stripe is read only when this variable is exactly the string "true". */
export function collectionsWatchEnabled(env: { COLLECTIONS_WATCH_ENABLED?: string } = process.env): boolean {
  return env.COLLECTIONS_WATCH_ENABLED === "true";
}
