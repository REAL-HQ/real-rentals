/**
 * Statuses approve_application_checked may move to approved.
 * active and suspended stay off this list: approving them demotes a running
 * renter. declined, closed, and duplicate stay until an owner changes the line.
 * The same array is private.approval_source_statuses() in
 * proposed/m2-with-approval-boundary/00-approval-boundary.sql.
 */
export const APPROVAL_SOURCE_STATUSES = [
  "partial",
  "new",
  "complete",
  "reviewing",
  "declined",
  "closed",
  "duplicate",
] as const;

export const APPROVAL_STATUS_NOT_APPROVABLE =
  "application_status_not_approvable: an active or suspended application is a running renter";
