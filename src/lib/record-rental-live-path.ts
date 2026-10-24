// Live-path switches. Each stays false until the matching SQL is installed.
// Today's End Rental, autopay, archive layout and file deletion keep their
// current database calls while these are false.

export const END_RENTAL_SAFE_V1_ENABLED = false;
export const RENTAL_SUBSCRIPTION_COORDINATION_ENABLED = false;
export const SIGNED_ARCHIVE_V1_ENABLED = false;
export const ARCHIVE_DELETION_GUARD_ENABLED = false;
// New eSign agreements carry merge_data.record_rental_terms_v1 (signed-rental-terms.ts)
// so Record Rental can later verify their signed start date and weekly rent.
export const SIGNED_RENTAL_TERMS_V1_ENABLED = false;
// Staff-verified historical (paper) agreements: on only once
// proposed/record-rental-historical/01 is installed. Off, Record Rental reads eSign
// evidence exactly as before and registration refuses.
export const HISTORICAL_AGREEMENTS_V1_ENABLED = false;
