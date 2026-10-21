// Live-path switches. Each stays false until the matching SQL is installed.
// Today's End Rental, autopay, archive layout and file deletion keep their
// current database calls while these are false.

export const END_RENTAL_SAFE_V1_ENABLED = false;
export const RENTAL_SUBSCRIPTION_COORDINATION_ENABLED = false;
export const SIGNED_ARCHIVE_V1_ENABLED = false;
export const ARCHIVE_DELETION_GUARD_ENABLED = false;
