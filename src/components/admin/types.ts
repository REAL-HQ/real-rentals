import type { Tables } from "@/integrations/supabase/types";

export type Application = Tables<"applications">;
export type Vehicle = Tables<"vehicles"> & { color?: string | null };
export type ContactLead = Tables<"contact_leads">;
export type InvestorLead = Tables<"investor_leads">;
export type FleetOwner = Tables<"fleet_owner_submissions">;
export type Partner = Tables<"partners">;
export type Payment = Tables<"payments">;
export type DriverScreening = Tables<"driver_screenings">;
// No LeadDocument type. public.lead_documents is retired: it holds no rows,
// nothing reads or writes it, and applicant documents live in public.documents
// (src/lib/documents.functions.ts). The table stays in the schema until a later
// cleanup drops it; nothing in the app should grow a dependency on it again.

export const SCREENING_STATUSES = [
  "new_lead",
  "contacted",
  "interview_complete",
  "docs_pending",
  "insurance_verified",
  "approved",
  "pickup_scheduled",
  "active_renter",
  "disqualified",
] as const;
export type ScreeningStatus = (typeof SCREENING_STATUSES)[number];

export const REQUIRED_DOC_TYPES = [
  "license_front",
  "license_back",
  "insurance_card",
  "driver_profile_screenshot",
] as const;
export type RequiredDocType = (typeof REQUIRED_DOC_TYPES)[number];
