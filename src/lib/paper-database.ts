import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attestation, Operation } from "./paper-contract";
// Explicit proposed interface, not a claim that hosted generated types/schema contain these objects.
export type PaperDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      paper_upload_operations: {
        Row: Operation;
        Insert: Attestation;
        Update: never;
        Relationships: [];
      };
    };
    Functions: Database["public"]["Functions"] & {
      register_paper_agreement: {
        Args: { p_operation_id: string };
        Returns: Database["public"]["Functions"]["purge_application"]["Returns"];
      };
      set_paper_agreement_note: {
        Args: {
          p_document_id: string;
          p_expected_revision: number;
          p_note: string | null;
          p_operation_id: string;
        };
        Returns: Database["public"]["Functions"]["purge_application"]["Returns"];
      };
      cancel_paper_registration: {
        Args: { p_operation_id: string };
        Returns: Database["public"]["Functions"]["purge_application"]["Returns"];
      };
    };
  };
};
export function paperClient(client: SupabaseClient<Database>): SupabaseClient<PaperDatabase> {
  return client as unknown as SupabaseClient<PaperDatabase>;
}
