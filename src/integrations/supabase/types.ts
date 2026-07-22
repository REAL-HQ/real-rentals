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
          ai_flags: Json | null
          ai_score: number | null
          ai_summary: string | null
          ai_tier: string | null
          background_check_status: string
          city: string | null
          consent_background: boolean | null
          consent_gps: boolean | null
          consent_prepay: boolean | null
          consent_terms: boolean | null
          contacted_at: string | null
          created_at: string | null
          current_step: string | null
          deposit_amount: number | null
          deposit_paid: number | null
          deposit_status: string
          dob: string | null
          earnings_verified_status: string
          email: string
          full_coverage_insurance: boolean | null
          full_name: string
          gclid: string | null
          gig_status: string | null
          how_heard: string | null
          id: string
          incident_count: number
          landing_page: string | null
          license_expiration: string | null
          license_number: string | null
          license_photo_url: string | null
          license_state: string | null
          license_valid: boolean | null
          market_id: string | null
          mvr_status: string
          notes: string | null
          payment_method: string | null
          payment_status: string
          phone: string
          pickup_date: string | null
          pickup_time: string | null
          platform_active: boolean | null
          platform_status: string | null
          platforms: string[] | null
          primary_application_id: string | null
          profile_screenshot_url: string | null
          rating: number | null
          referrer: string | null
          rental_duration: string | null
          rental_duration_days: number | null
          rental_length: string | null
          rental_term: string | null
          resubmission_count: number
          resubmission_history: Json
          return_date: string | null
          return_time: string | null
          rideshare_history_status: string
          score: number
          scored_at: string | null
          sms_consent: boolean | null
          source: string | null
          start_date: string | null
          start_timing: string | null
          state: string | null
          status: string
          trip_screenshots: string[]
          trips_completed: string | null
          updated_at: string
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          vehicle_id: string | null
          vehicle_size: string | null
          weekly_hours: number | null
          weekly_rent: number | null
          years_licensed: number | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          ai_flags?: Json | null
          ai_score?: number | null
          ai_summary?: string | null
          ai_tier?: string | null
          background_check_status?: string
          city?: string | null
          consent_background?: boolean | null
          consent_gps?: boolean | null
          consent_prepay?: boolean | null
          consent_terms?: boolean | null
          contacted_at?: string | null
          created_at?: string | null
          current_step?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string
          dob?: string | null
          earnings_verified_status?: string
          email: string
          full_coverage_insurance?: boolean | null
          full_name: string
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string
          incident_count?: number
          landing_page?: string | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          phone: string
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          rating?: number | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          resubmission_count?: number
          resubmission_history?: Json
          return_date?: string | null
          return_time?: string | null
          rideshare_history_status?: string
          score?: number
          scored_at?: string | null
          sms_consent?: boolean | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string
          trip_screenshots?: string[]
          trips_completed?: string | null
          updated_at?: string
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          weekly_hours?: number | null
          weekly_rent?: number | null
          years_licensed?: number | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          ai_flags?: Json | null
          ai_score?: number | null
          ai_summary?: string | null
          ai_tier?: string | null
          background_check_status?: string
          city?: string | null
          consent_background?: boolean | null
          consent_gps?: boolean | null
          consent_prepay?: boolean | null
          consent_terms?: boolean | null
          contacted_at?: string | null
          created_at?: string | null
          current_step?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string
          dob?: string | null
          earnings_verified_status?: string
          email?: string
          full_coverage_insurance?: boolean | null
          full_name?: string
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string
          incident_count?: number
          landing_page?: string | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          phone?: string
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          rating?: number | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          resubmission_count?: number
          resubmission_history?: Json
          return_date?: string | null
          return_time?: string | null
          rideshare_history_status?: string
          score?: number
          scored_at?: string | null
          sms_consent?: boolean | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string
          trip_screenshots?: string[]
          trips_completed?: string | null
          updated_at?: string
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          weekly_hours?: number | null
          weekly_rent?: number | null
          years_licensed?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_primary_application_id_fkey"
            columns: ["primary_application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
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
      documents: {
        Row: {
          created_at: string
          driver_id: string | null
          id: string
          kind: string
          notes: string | null
          partner_id: string | null
          storage_bucket: string
          storage_path: string
          updated_at: string
          vehicle_id: string | null
          visibility: string[]
        }
        Insert: {
          created_at?: string
          driver_id?: string | null
          id?: string
          kind: string
          notes?: string | null
          partner_id?: string | null
          storage_bucket: string
          storage_path: string
          updated_at?: string
          vehicle_id?: string | null
          visibility?: string[]
        }
        Update: {
          created_at?: string
          driver_id?: string | null
          id?: string
          kind?: string
          notes?: string | null
          partner_id?: string | null
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          vehicle_id?: string | null
          visibility?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "documents_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
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
      issues: {
        Row: {
          body: string | null
          created_at: string
          driver_id: string
          id: string
          kind: string
          rental_id: string | null
          severity: string
          status: string
          title: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          driver_id: string
          id?: string
          kind?: string
          rental_id?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          kind?: string
          rental_id?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issues_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_records: {
        Row: {
          category: string
          company_share: number
          completed_at: string | null
          cost_split: string
          created_at: string
          driver_id: string | null
          due_date: string | null
          due_mileage: number | null
          id: string
          item: string
          notes: string | null
          partner_id: string | null
          partner_share: number
          rental_id: string | null
          shop_id: string | null
          status: string
          total_cost: number
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          category?: string
          company_share?: number
          completed_at?: string | null
          cost_split?: string
          created_at?: string
          driver_id?: string | null
          due_date?: string | null
          due_mileage?: number | null
          id?: string
          item: string
          notes?: string | null
          partner_id?: string | null
          partner_share?: number
          rental_id?: string | null
          shop_id?: string | null
          status?: string
          total_cost?: number
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          category?: string
          company_share?: number
          completed_at?: string | null
          cost_split?: string
          created_at?: string
          driver_id?: string | null
          due_date?: string | null
          due_mileage?: number | null
          id?: string
          item?: string
          notes?: string | null
          partner_id?: string | null
          partner_share?: number
          rental_id?: string | null
          shop_id?: string | null
          status?: string
          total_cost?: number
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_records_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_records_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_records_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_records_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      markets: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          state: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          created_at: string
          driver_id: string | null
          id: string
          kind: string
          partner_id: string | null
          read: boolean
          recipient_id: string | null
          sender_id: string | null
          thread_id: string
        }
        Insert: {
          body: string
          created_at?: string
          driver_id?: string | null
          id?: string
          kind?: string
          partner_id?: string | null
          read?: boolean
          recipient_id?: string | null
          sender_id?: string | null
          thread_id?: string
        }
        Update: {
          body?: string
          created_at?: string
          driver_id?: string | null
          id?: string
          kind?: string
          partner_id?: string | null
          read?: boolean
          recipient_id?: string | null
          sender_id?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          channels: string[]
          created_at: string
          driver_id: string | null
          id: string
          kind: string
          partner_id: string | null
          read: boolean
          title: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          channels?: string[]
          created_at?: string
          driver_id?: string | null
          id?: string
          kind?: string
          partner_id?: string | null
          read?: boolean
          title: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          channels?: string[]
          created_at?: string
          driver_id?: string | null
          id?: string
          kind?: string
          partner_id?: string | null
          read?: boolean
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
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
          revenue_split_pct: number
          status: string
          updated_at: string
          user_id: string | null
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
          revenue_split_pct?: number
          status?: string
          updated_at?: string
          user_id?: string | null
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
          revenue_split_pct?: number
          status?: string
          updated_at?: string
          user_id?: string | null
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
      payouts: {
        Row: {
          created_at: string
          gross_rent: number
          id: string
          maintenance_share: number
          net_amount: number
          notes: string | null
          paid_at: string | null
          partner_id: string
          partner_share: number
          period_end: string
          period_start: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          gross_rent?: number
          id?: string
          maintenance_share?: number
          net_amount?: number
          notes?: string | null
          paid_at?: string | null
          partner_id: string
          partner_share?: number
          period_end: string
          period_start: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          gross_rent?: number
          id?: string
          maintenance_share?: number
          net_amount?: number
          notes?: string | null
          paid_at?: string | null
          partner_id?: string
          partner_share?: number
          period_end?: string
          period_start?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referred_email: string | null
          referred_user_id: string | null
          referrer_id: string
          reward_amount: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          referred_email?: string | null
          referred_user_id?: string | null
          referrer_id: string
          reward_amount?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          referred_email?: string | null
          referred_user_id?: string | null
          referrer_id?: string
          reward_amount?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      rentals: {
        Row: {
          application_id: string | null
          created_at: string
          deposit_amount: number
          deposit_held: boolean
          driver_id: string
          end_date: string | null
          id: string
          next_payment_due: string | null
          start_date: string
          status: string
          updated_at: string
          vehicle_id: string
          weekly_rate: number
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          deposit_amount?: number
          deposit_held?: boolean
          driver_id: string
          end_date?: string | null
          id?: string
          next_payment_due?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          vehicle_id: string
          weekly_rate?: number
        }
        Update: {
          application_id?: string | null
          created_at?: string
          deposit_amount?: number
          deposit_held?: boolean
          driver_id?: string
          end_date?: string | null
          id?: string
          next_payment_due?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          vehicle_id?: string
          weekly_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "rentals_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          address: string | null
          created_at: string
          hours: string | null
          id: string
          is_active: boolean
          market_id: string | null
          name: string
          notes: string | null
          phone: string | null
          services: string[]
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          hours?: string | null
          id?: string
          is_active?: boolean
          market_id?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          services?: string[]
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          hours?: string | null
          id?: string
          is_active?: boolean
          market_id?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          services?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shops_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      site_content: {
        Row: {
          id: string
          key: string
          site_id: string | null
          updated_at: string
          value: Json
        }
        Insert: {
          id?: string
          key: string
          site_id?: string | null
          updated_at?: string
          value?: Json
        }
        Update: {
          id?: string
          key?: string
          site_id?: string | null
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "site_content_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          created_at: string
          hero_image_url: string | null
          id: string
          is_published: boolean
          market_id: string | null
          show_on_homepage: boolean
          slug: string
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          hero_image_url?: string | null
          id?: string
          is_published?: boolean
          market_id?: string | null
          show_on_homepage?: boolean
          slug: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          hero_image_url?: string | null
          id?: string
          is_published?: boolean
          market_id?: string | null
          show_on_homepage?: boolean
          slug?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
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
          fuel_type: string
          id: string
          maintenance_status: string | null
          make: string
          market_id: string | null
          miles_per_tank: number | null
          model: string
          monthly_rate: number | null
          mpg: number | null
          partner_id: string | null
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
          fuel_type?: string
          id?: string
          maintenance_status?: string | null
          make: string
          market_id?: string | null
          miles_per_tank?: number | null
          model: string
          monthly_rate?: number | null
          mpg?: number | null
          partner_id?: string | null
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
          fuel_type?: string
          id?: string
          maintenance_status?: string | null
          make?: string
          market_id?: string | null
          miles_per_tank?: number | null
          model?: string
          monthly_rate?: number | null
          mpg?: number | null
          partner_id?: string | null
          photos?: string[] | null
          seats?: number | null
          status?: string
          trim?: string | null
          uber_eligibility?: string[] | null
          weekly_rate?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string
          driver_status: string | null
          email: string
          full_name: string
          gclid: string | null
          id: string
          market_id: string | null
          phone: string | null
          source: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          created_at?: string
          driver_status?: string | null
          email: string
          full_name: string
          gclid?: string | null
          id?: string
          market_id?: string | null
          phone?: string | null
          source?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          created_at?: string
          driver_status?: string | null
          email?: string
          full_name?: string
          gclid?: string | null
          id?: string
          market_id?: string | null
          phone?: string | null
          source?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "admin" | "user" | "partner" | "driver" | "team"
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
      app_role: ["admin", "user", "partner", "driver", "team"],
    },
  },
} as const
