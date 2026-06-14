export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      applications: {
        Row: {
          address: string | null
          background_check_status: string
          city: string | null
          consent_background: boolean | null
          consent_gps: boolean | null
          consent_prepay: boolean | null
          consent_terms: boolean | null
          created_at: string | null
          deposit_amount: number | null
          deposit_paid: number | null
          deposit_status: string
          dob: string | null
          email: string
          full_name: string
          id: string
          incident_count: number
          license_expiration: string | null
          license_number: string | null
          license_photo_url: string | null
          license_state: string | null
          mvr_status: string
          notes: string | null
          payment_method: string | null
          payment_status: string
          phone: string
          platform_active: boolean | null
          platforms: string[] | null
          rental_term: string | null
          start_date: string | null
          state: string | null
          status: string
          updated_at: string
          vehicle_id: string | null
          weekly_hours: number | null
          weekly_rent: number | null
          years_licensed: number | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          background_check_status?: string
          city?: string | null
          consent_background?: boolean | null
          consent_gps?: boolean | null
          consent_prepay?: boolean | null
          consent_terms?: boolean | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string
          dob?: string | null
          email: string
          full_name: string
          id?: string
          incident_count?: number
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          mvr_status?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          phone: string
          platform_active?: boolean | null
          platforms?: string[] | null
          rental_term?: string | null
          start_date?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          weekly_hours?: number | null
          weekly_rent?: number | null
          years_licensed?: number | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          background_check_status?: string
          city?: string | null
          consent_background?: boolean | null
          consent_gps?: boolean | null
          consent_prepay?: boolean | null
          consent_terms?: boolean | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string
          dob?: string | null
          email?: string
          full_name?: string
          id?: string
          incident_count?: number
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          mvr_status?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          phone?: string
          platform_active?: boolean | null
          platforms?: string[] | null
          rental_term?: string | null
          start_date?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          weekly_hours?: number | null
          weekly_rent?: number | null
          years_licensed?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_leads: {
        Row: {
          created_at: string | null
          email: string
          id: string
          message: string | null
          name: string
          phone: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          message?: string | null
          name: string
          phone?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          message?: string | null
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      fleet_owner_submissions: {
        Row: {
          condition: string | null
          created_at: string
          currently_insured: boolean | null
          email: string
          full_name: string
          id: string
          lien_status: string | null
          make: string
          message: string | null
          mileage: number | null
          model: string
          notes: string | null
          phone: string
          photo_urls: string[]
          registration_state: string | null
          status: string
          title_status: string | null
          trim: string | null
          vin: string
          year: number
        }
        Insert: {
          condition?: string | null
          created_at?: string
          currently_insured?: boolean | null
          email: string
          full_name: string
          id?: string
          lien_status?: string | null
          make: string
          message?: string | null
          mileage?: number | null
          model: string
          notes?: string | null
          phone: string
          photo_urls?: string[]
          registration_state?: string | null
          status?: string
          title_status?: string | null
          trim?: string | null
          vin: string
          year: number
        }
        Update: {
          condition?: string | null
          created_at?: string
          currently_insured?: boolean | null
          email?: string
          full_name?: string
          id?: string
          lien_status?: string | null
          make?: string
          message?: string | null
          mileage?: number | null
          model?: string
          notes?: string | null
          phone?: string
          photo_urls?: string[]
          registration_state?: string | null
          status?: string
          title_status?: string | null
          trim?: string | null
          vin?: string
          year?: number
        }
        Relationships: []
      }
      investor_leads: {
        Row: {
          capital_range: string | null
          created_at: string | null
          email: string
          id: string
          message: string | null
          name: string
          phone: string | null
          vehicles_interested: number | null
        }
        Insert: {
          capital_range?: string | null
          created_at?: string | null
          email: string
          id?: string
          message?: string | null
          name: string
          phone?: string | null
          vehicles_interested?: number | null
        }
        Update: {
          capital_range?: string | null
          created_at?: string | null
          email?: string
          id?: string
          message?: string | null
          name?: string
          phone?: string | null
          vehicles_interested?: number | null
        }
        Relationships: []
      }
      partners: {
        Row: {
          capital_committed: number | null
          created_at: string
          documents: Json | null
          email: string | null
          id: string
          monthly_payment: number | null
          name: string
          notes: string | null
          partner_type: string
          phone: string | null
          status: string
          updated_at: string
          vehicles_contributed: number | null
        }
        Insert: {
          capital_committed?: number | null
          created_at?: string
          documents?: Json | null
          email?: string | null
          id?: string
          monthly_payment?: number | null
          name: string
          notes?: string | null
          partner_type?: string
          phone?: string | null
          status?: string
          updated_at?: string
          vehicles_contributed?: number | null
        }
        Update: {
          capital_committed?: number | null
          created_at?: string
          documents?: Json | null
          email?: string | null
          id?: string
          monthly_payment?: number | null
          name?: string
          notes?: string | null
          partner_type?: string
          phone?: string | null
          status?: string
          updated_at?: string
          vehicles_contributed?: number | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          balance_due: number
          created_at: string
          driver_id: string | null
          due_date: string | null
          id: string
          late_fees: number
          notes: string | null
          paid_date: string | null
          payment_method: string | null
          status: string
          type: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          amount?: number
          balance_due?: number
          created_at?: string
          driver_id?: string | null
          due_date?: string | null
          id?: string
          late_fees?: number
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          status?: string
          type?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          amount?: number
          balance_due?: number
          created_at?: string
          driver_id?: string | null
          due_date?: string | null
          id?: string
          late_fees?: number
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          status?: string
          type?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          badges: string[] | null
          body_type: string | null
          color: string | null
          created_at: string | null
          deposit: number | null
          description: string | null
          doors: number | null
          id: string
          maintenance_status: string | null
          make: string
          model: string
          monthly_rate: number | null
          mpg: number | null
          photos: string[] | null
          seats: number | null
          status: string
          trim: string | null
          uber_eligibility: string[] | null
          weekly_rate: number
          year: number
        }
        Insert: {
          badges?: string[] | null
          body_type?: string | null
          color?: string | null
          created_at?: string | null
          deposit?: number | null
          description?: string | null
          doors?: number | null
          id?: string
          maintenance_status?: string | null
          make: string
          model: string
          monthly_rate?: number | null
          mpg?: number | null
          photos?: string[] | null
          seats?: number | null
          status?: string
          trim?: string | null
          uber_eligibility?: string[] | null
          weekly_rate: number
          year: number
        }
        Update: {
          badges?: string[] | null
          body_type?: string | null
          color?: string | null
          created_at?: string | null
          deposit?: number | null
          description?: string | null
          doors?: number | null
          id?: string
          maintenance_status?: string | null
          make?: string
          model?: string
          monthly_rate?: number | null
          mpg?: number | null
          photos?: string[] | null
          seats?: number | null
          status?: string
          trim?: string | null
          uber_eligibility?: string[] | null
          weekly_rate?: number
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
