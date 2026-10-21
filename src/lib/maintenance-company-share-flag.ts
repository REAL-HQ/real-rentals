/**
 * Explicit company_share on a service insert that does not also write a
 * linked vehicle expense. No environment variable can open it.
 * Leave this false until an owner changes it and rebuilds.
 * While it is false, inserts omit company_share and the database default 0 remains.
 */
export const MAINTENANCE_COMPANY_SHARE_ENABLED = false;
