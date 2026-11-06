/**
 * false: Tolls And Tickets is not in the admin rail and the server reads nothing.
 * No environment variable can open this.
 * true: managers and owners can open a read-only ledger of existing toll,
 * ticket, and violation rows. Activation is changing this constant and rebuilding.
 */
export const TOLLS_TICKETS_LEDGER_ENABLED = false;
