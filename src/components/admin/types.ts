import type { Tables } from "@/integrations/supabase/types";

export type Application = Tables<"applications">;
export type Vehicle = Tables<"vehicles"> & { color?: string | null };
export type ContactLead = Tables<"contact_leads">;
export type InvestorLead = Tables<"investor_leads">;
export type FleetOwner = Tables<"fleet_owner_submissions">;
export type Partner = Tables<"partners">;
export type Payment = Tables<"payments">;