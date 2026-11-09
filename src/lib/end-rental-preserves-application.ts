/**
 * Installed end_rental_tx sets applications.status to 'closed' in the same
 * transaction that marks the rental closed. Leaving the application open
 * needs proposed/end-rental-preserves-application-v1.sql. Until that SQL is
 * installed by a person, this stays false and End Rental keeps today's call.
 */
export const END_RENTAL_PRESERVES_APPLICATION_ENABLED = false as boolean;
