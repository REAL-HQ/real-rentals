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
      agreement_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          version?: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      agreements: {
        Row: {
          application_id: string
          body: string
          company_signer_name: string
          created_at: string
          created_by: string | null
          document_id: string | null
          id: string
          merge_data: Json
          rental_id: string | null
          sent_at: string | null
          signed_at: string | null
          signer_email: string | null
          signer_ip: string | null
          signer_name: string | null
          signer_user_agent: string | null
          status: string
          template_id: string | null
          title: string
          token_expires_at: string | null
          token_hash: string | null
          updated_at: string
          vehicle_id: string | null
          viewed_at: string | null
          voided_at: string | null
        }
        Insert: {
          application_id: string
          body: string
          company_signer_name?: string
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          id?: string
          merge_data?: Json
          rental_id?: string | null
          sent_at?: string | null
          signed_at?: string | null
          signer_email?: string | null
          signer_ip?: string | null
          signer_name?: string | null
          signer_user_agent?: string | null
          status?: string
          template_id?: string | null
          title?: string
          token_expires_at?: string | null
          token_hash?: string | null
          updated_at?: string
          vehicle_id?: string | null
          viewed_at?: string | null
          voided_at?: string | null
        }
        Update: {
          application_id?: string
          body?: string
          company_signer_name?: string
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          id?: string
          merge_data?: Json
          rental_id?: string | null
          sent_at?: string | null
          signed_at?: string | null
          signer_email?: string | null
          signer_ip?: string | null
          signer_name?: string | null
          signer_user_agent?: string | null
          status?: string
          template_id?: string | null
          title?: string
          token_expires_at?: string | null
          token_hash?: string | null
          updated_at?: string
          vehicle_id?: string | null
          viewed_at?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreements_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreements_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreements_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreements_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
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
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
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
          doc_request_note: string | null
          doc_request_sent_at: string | null
          earnings_verified_status: string
          email: string
          full_coverage_insurance: boolean | null
          full_name: string
          gclid: string | null
          gig_status: string | null
          how_heard: string | null
          id: string
          incident_count: number
          insurance_carrier: string | null
          insurance_doc_url: string | null
          insurance_expires_on: string | null
          insurance_policy_number: string | null
          insurance_rideshare_endorsement: boolean | null
          insurance_status: string
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
          recovery_email_sent_24h: string | null
          recovery_email_sent_72h: string | null
          recovery_sent_at: string | null
          referrer: string | null
          rental_duration: string | null
          rental_duration_days: number | null
          rental_length: string | null
          rental_term: string | null
          requested_docs: Json
          resubmission_count: number
          resubmission_history: Json
          return_date: string | null
          return_time: string | null
          rideshare_history_status: string
          score: number
          scored_at: string | null
          sms_consent: boolean | null
          sms_opt_out_at: string | null
          source: string | null
          start_date: string | null
          start_timing: string | null
          state: string | null
          status: string
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
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
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
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
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          earnings_verified_status?: string
          email: string
          full_coverage_insurance?: boolean | null
          full_name: string
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string
          incident_count?: number
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string
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
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          requested_docs?: Json
          resubmission_count?: number
          resubmission_history?: Json
          return_date?: string | null
          return_time?: string | null
          rideshare_history_status?: string
          score?: number
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
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
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
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
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          earnings_verified_status?: string
          email?: string
          full_coverage_insurance?: boolean | null
          full_name?: string
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string
          incident_count?: number
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string
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
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          requested_docs?: Json
          resubmission_count?: number
          resubmission_history?: Json
          return_date?: string | null
          return_time?: string | null
          rideshare_history_status?: string
          score?: number
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
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
      automation_enrollments: {
        Row: {
          application_id: string | null
          cancelled_reason: string | null
          completed_at: string | null
          created_at: string
          current_step: number
          enrolled_at: string
          id: string
          next_run_at: string | null
          rental_id: string | null
          status: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          application_id?: string | null
          cancelled_reason?: string | null
          completed_at?: string | null
          created_at?: string
          current_step?: number
          enrolled_at?: string
          id?: string
          next_run_at?: string | null
          rental_id?: string | null
          status?: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          application_id?: string | null
          cancelled_reason?: string | null
          completed_at?: string | null
          created_at?: string
          current_step?: number
          enrolled_at?: string
          id?: string
          next_run_at?: string | null
          rental_id?: string | null
          status?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_enrollments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_enrollments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_enrollments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "automation_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_steps: {
        Row: {
          body: string
          channel: string
          created_at: string
          delay_minutes: number
          id: string
          is_active: boolean
          step_order: number
          subject: string | null
          updated_at: string
          workflow_id: string
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          delay_minutes?: number
          id?: string
          is_active?: boolean
          step_order?: number
          subject?: string | null
          updated_at?: string
          workflow_id: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          delay_minutes?: number
          id?: string
          is_active?: boolean
          step_order?: number
          subject?: string | null
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_steps_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "automation_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_workflows: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          quiet_hours_end: number
          quiet_hours_start: number
          stop_on_reply: boolean
          stop_on_statuses: string[]
          trigger_event: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          quiet_hours_end?: number
          quiet_hours_start?: number
          stop_on_reply?: boolean
          stop_on_statuses?: string[]
          trigger_event: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          quiet_hours_end?: number
          quiet_hours_start?: number
          stop_on_reply?: boolean
          stop_on_statuses?: string[]
          trigger_event?: string
          updated_at?: string
        }
        Relationships: []
      }
      condition_media: {
        Row: {
          angle: string | null
          application_id: string | null
          caption: string | null
          captured_by: string | null
          captured_by_role: string
          created_at: string
          file_name: string | null
          id: string
          incident_id: string | null
          inspection_id: string | null
          media_type: string
          mime_type: string | null
          phase: string
          rental_id: string | null
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          vehicle_id: string
        }
        Insert: {
          angle?: string | null
          application_id?: string | null
          caption?: string | null
          captured_by?: string | null
          captured_by_role?: string
          created_at?: string
          file_name?: string | null
          id?: string
          incident_id?: string | null
          inspection_id?: string | null
          media_type?: string
          mime_type?: string | null
          phase?: string
          rental_id?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path: string
          vehicle_id: string
        }
        Update: {
          angle?: string | null
          application_id?: string | null
          caption?: string | null
          captured_by?: string | null
          captured_by_role?: string
          created_at?: string
          file_name?: string | null
          id?: string
          incident_id?: string | null
          inspection_id?: string | null
          media_type?: string
          mime_type?: string | null
          phase?: string
          rental_id?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "condition_media_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_media_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_media_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_media_vehicle_id_fkey"
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
      deposit_deductions: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          incident_id: string | null
          notes: string | null
          reason: string
          rental_id: string
          toll_charge_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          incident_id?: string | null
          notes?: string | null
          reason: string
          rental_id: string
          toll_charge_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          incident_id?: string | null
          notes?: string | null
          reason?: string
          rental_id?: string
          toll_charge_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposit_deductions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_deductions_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_deductions_toll_charge_id_fkey"
            columns: ["toll_charge_id"]
            isOneToOne: false
            referencedRelation: "toll_charges"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          category: string
          created_at: string
          driver_id: string | null
          expires_at: string | null
          file_name: string | null
          id: string
          is_current: boolean
          kind: string
          label: string | null
          mime_type: string | null
          notes: string | null
          partner_id: string | null
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          superseded_by: string | null
          updated_at: string
          uploaded_by: string | null
          uploaded_by_role: string | null
          vehicle_id: string | null
          visibility: string[]
        }
        Insert: {
          category?: string
          created_at?: string
          driver_id?: string | null
          expires_at?: string | null
          file_name?: string | null
          id?: string
          is_current?: boolean
          kind: string
          label?: string | null
          mime_type?: string | null
          notes?: string | null
          partner_id?: string | null
          size_bytes?: number | null
          storage_bucket: string
          storage_path: string
          superseded_by?: string | null
          updated_at?: string
          uploaded_by?: string | null
          uploaded_by_role?: string | null
          vehicle_id?: string | null
          visibility?: string[]
        }
        Update: {
          category?: string
          created_at?: string
          driver_id?: string | null
          expires_at?: string | null
          file_name?: string | null
          id?: string
          is_current?: boolean
          kind?: string
          label?: string | null
          mime_type?: string | null
          notes?: string | null
          partner_id?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          superseded_by?: string | null
          updated_at?: string
          uploaded_by?: string | null
          uploaded_by_role?: string | null
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
            foreignKeyName: "documents_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "documents"
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
      driver_screenings: {
        Row: {
          accidents_last_3yr: number | null
          card_in_own_name: boolean | null
          created_at: string
          disqualification_reason: string | null
          disqualified: boolean
          drive_type: string | null
          driver_age: number | null
          driver_rating: number | null
          gig_account_status: string | null
          gig_apps: string[] | null
          has_current_vehicle: boolean | null
          has_dui: boolean | null
          has_personal_insurance: boolean | null
          id: string
          insurance_carrier: string | null
          insurance_carrier_phone: string | null
          insurance_name_matches_license: boolean | null
          insurance_policy_number: string | null
          insurance_verified: boolean
          insurance_verified_at: string | null
          insurance_verified_by: string | null
          interview_completed_at: string | null
          interview_notes: string | null
          interviewed_by: string | null
          lead_id: string
          license_active: boolean | null
          license_points: number | null
          license_state: string | null
          license_years: number | null
          major_violations: boolean | null
          months_on_platform: number | null
          mvr_authorized: boolean | null
          needed_by_date: string | null
          policy_active: boolean | null
          qualification_score: number | null
          rate_confirmed: boolean | null
          rideshare_endorsement: boolean | null
          status: string
          trip_count: number | null
          updated_at: string
          verification_recording_url: string | null
        }
        Insert: {
          accidents_last_3yr?: number | null
          card_in_own_name?: boolean | null
          created_at?: string
          disqualification_reason?: string | null
          disqualified?: boolean
          drive_type?: string | null
          driver_age?: number | null
          driver_rating?: number | null
          gig_account_status?: string | null
          gig_apps?: string[] | null
          has_current_vehicle?: boolean | null
          has_dui?: boolean | null
          has_personal_insurance?: boolean | null
          id?: string
          insurance_carrier?: string | null
          insurance_carrier_phone?: string | null
          insurance_name_matches_license?: boolean | null
          insurance_policy_number?: string | null
          insurance_verified?: boolean
          insurance_verified_at?: string | null
          insurance_verified_by?: string | null
          interview_completed_at?: string | null
          interview_notes?: string | null
          interviewed_by?: string | null
          lead_id: string
          license_active?: boolean | null
          license_points?: number | null
          license_state?: string | null
          license_years?: number | null
          major_violations?: boolean | null
          months_on_platform?: number | null
          mvr_authorized?: boolean | null
          needed_by_date?: string | null
          policy_active?: boolean | null
          qualification_score?: number | null
          rate_confirmed?: boolean | null
          rideshare_endorsement?: boolean | null
          status?: string
          trip_count?: number | null
          updated_at?: string
          verification_recording_url?: string | null
        }
        Update: {
          accidents_last_3yr?: number | null
          card_in_own_name?: boolean | null
          created_at?: string
          disqualification_reason?: string | null
          disqualified?: boolean
          drive_type?: string | null
          driver_age?: number | null
          driver_rating?: number | null
          gig_account_status?: string | null
          gig_apps?: string[] | null
          has_current_vehicle?: boolean | null
          has_dui?: boolean | null
          has_personal_insurance?: boolean | null
          id?: string
          insurance_carrier?: string | null
          insurance_carrier_phone?: string | null
          insurance_name_matches_license?: boolean | null
          insurance_policy_number?: string | null
          insurance_verified?: boolean
          insurance_verified_at?: string | null
          insurance_verified_by?: string | null
          interview_completed_at?: string | null
          interview_notes?: string | null
          interviewed_by?: string | null
          lead_id?: string
          license_active?: boolean | null
          license_points?: number | null
          license_state?: string | null
          license_years?: number | null
          major_violations?: boolean | null
          months_on_platform?: number | null
          mvr_authorized?: boolean | null
          needed_by_date?: string | null
          policy_active?: boolean | null
          qualification_score?: number | null
          rate_confirmed?: boolean | null
          rideshare_endorsement?: boolean | null
          status?: string
          trip_count?: number | null
          updated_at?: string
          verification_recording_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_screenings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "applications"
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
      incidents: {
        Row: {
          actual_cost: number
          application_id: string | null
          at_fault: string
          claim_closed_on: string | null
          claim_number: string | null
          claim_opened_on: string | null
          created_at: string
          created_by: string | null
          deductible: number
          description: string | null
          drivable: boolean | null
          driver_responsible_amount: number
          estimated_cost: number
          id: string
          incident_type: string
          injuries: boolean
          insurance_carrier: string | null
          insurance_payout: number
          location: string | null
          notes: string | null
          occurred_at: string
          other_party: string | null
          police_report_number: string | null
          rental_id: string | null
          reported_at: string
          severity: string
          status: string
          updated_at: string
          vehicle_id: string
          vendor_id: string | null
        }
        Insert: {
          actual_cost?: number
          application_id?: string | null
          at_fault?: string
          claim_closed_on?: string | null
          claim_number?: string | null
          claim_opened_on?: string | null
          created_at?: string
          created_by?: string | null
          deductible?: number
          description?: string | null
          drivable?: boolean | null
          driver_responsible_amount?: number
          estimated_cost?: number
          id?: string
          incident_type?: string
          injuries?: boolean
          insurance_carrier?: string | null
          insurance_payout?: number
          location?: string | null
          notes?: string | null
          occurred_at?: string
          other_party?: string | null
          police_report_number?: string | null
          rental_id?: string | null
          reported_at?: string
          severity?: string
          status?: string
          updated_at?: string
          vehicle_id: string
          vendor_id?: string | null
        }
        Update: {
          actual_cost?: number
          application_id?: string | null
          at_fault?: string
          claim_closed_on?: string | null
          claim_number?: string | null
          claim_opened_on?: string | null
          created_at?: string
          created_by?: string | null
          deductible?: number
          description?: string | null
          drivable?: boolean | null
          driver_responsible_amount?: number
          estimated_cost?: number
          id?: string
          incident_type?: string
          injuries?: boolean
          insurance_carrier?: string | null
          insurance_payout?: number
          location?: string | null
          notes?: string | null
          occurred_at?: string
          other_party?: string | null
          police_report_number?: string | null
          rental_id?: string | null
          reported_at?: string
          severity?: string
          status?: string
          updated_at?: string
          vehicle_id?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incidents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_items: {
        Row: {
          created_at: string
          id: string
          inspection_id: string
          is_critical: boolean
          label: string
          notes: string | null
          requires_photo: boolean
          result: string
          section: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          inspection_id: string
          is_critical?: boolean
          label: string
          notes?: string | null
          requires_photo?: boolean
          result?: string
          section?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          inspection_id?: string
          is_critical?: boolean
          label?: string
          notes?: string | null
          requires_photo?: boolean
          result?: string
          section?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_items_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_template_items: {
        Row: {
          created_at: string
          help_text: string | null
          id: string
          is_critical: boolean
          label: string
          requires_photo: boolean
          section: string
          sort_order: number
          template_id: string
        }
        Insert: {
          created_at?: string
          help_text?: string | null
          id?: string
          is_critical?: boolean
          label: string
          requires_photo?: boolean
          section?: string
          sort_order?: number
          template_id: string
        }
        Update: {
          created_at?: string
          help_text?: string | null
          id?: string
          is_critical?: boolean
          label?: string
          requires_photo?: boolean
          section?: string
          sort_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inspection_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          inspection_type: string
          is_active: boolean
          is_default: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          inspection_type?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          inspection_type?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      inspections: {
        Row: {
          application_id: string | null
          completed_at: string | null
          created_at: string
          driver_notes: string | null
          driver_signature_ip: string | null
          driver_signature_name: string | null
          driver_signature_user_agent: string | null
          driver_signed_at: string | null
          driver_user_id: string | null
          exterior_notes: string | null
          fuel_level: string | null
          id: string
          inspection_type: string
          inspector_id: string | null
          inspector_name: string | null
          interior_notes: string | null
          notes: string | null
          odometer: number | null
          rental_id: string | null
          signature_requested_at: string | null
          started_at: string
          status: string
          template_id: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          application_id?: string | null
          completed_at?: string | null
          created_at?: string
          driver_notes?: string | null
          driver_signature_ip?: string | null
          driver_signature_name?: string | null
          driver_signature_user_agent?: string | null
          driver_signed_at?: string | null
          driver_user_id?: string | null
          exterior_notes?: string | null
          fuel_level?: string | null
          id?: string
          inspection_type?: string
          inspector_id?: string | null
          inspector_name?: string | null
          interior_notes?: string | null
          notes?: string | null
          odometer?: number | null
          rental_id?: string | null
          signature_requested_at?: string | null
          started_at?: string
          status?: string
          template_id?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          application_id?: string | null
          completed_at?: string | null
          created_at?: string
          driver_notes?: string | null
          driver_signature_ip?: string | null
          driver_signature_name?: string | null
          driver_signature_user_agent?: string | null
          driver_signed_at?: string | null
          driver_user_id?: string | null
          exterior_notes?: string | null
          fuel_level?: string | null
          id?: string
          inspection_type?: string
          inspector_id?: string | null
          inspector_name?: string | null
          interior_notes?: string | null
          notes?: string | null
          odometer?: number | null
          rental_id?: string | null
          signature_requested_at?: string | null
          started_at?: string
          status?: string
          template_id?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspections_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inspection_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
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
      lead_documents: {
        Row: {
          doc_type: string
          file_url: string
          id: string
          lead_id: string
          uploaded_at: string
        }
        Insert: {
          doc_type: string
          file_url: string
          id?: string
          lead_id: string
          uploaded_at?: string
        }
        Update: {
          doc_type?: string
          file_url?: string
          id?: string
          lead_id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "applications"
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
          invoice_number: string | null
          item: string
          notes: string | null
          odometer: number | null
          partner_id: string | null
          partner_share: number
          performed_on: string | null
          rental_id: string | null
          schedule_id: string | null
          shop_id: string | null
          status: string
          total_cost: number
          updated_at: string
          vehicle_id: string
          vendor_id: string | null
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
          invoice_number?: string | null
          item: string
          notes?: string | null
          odometer?: number | null
          partner_id?: string | null
          partner_share?: number
          performed_on?: string | null
          rental_id?: string | null
          schedule_id?: string | null
          shop_id?: string | null
          status?: string
          total_cost?: number
          updated_at?: string
          vehicle_id: string
          vendor_id?: string | null
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
          invoice_number?: string | null
          item?: string
          notes?: string | null
          odometer?: number | null
          partner_id?: string | null
          partner_share?: number
          performed_on?: string | null
          rental_id?: string | null
          schedule_id?: string | null
          shop_id?: string | null
          status?: string
          total_cost?: number
          updated_at?: string
          vehicle_id?: string
          vendor_id?: string | null
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
      maintenance_schedules: {
        Row: {
          category: string
          created_at: string
          id: string
          interval_days: number | null
          interval_miles: number | null
          is_active: boolean
          item: string
          last_done_miles: number | null
          last_done_on: string | null
          next_due_miles: number | null
          next_due_on: string | null
          notes: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          interval_days?: number | null
          interval_miles?: number | null
          is_active?: boolean
          item: string
          last_done_miles?: number | null
          last_done_on?: string | null
          next_due_miles?: number | null
          next_due_on?: string | null
          notes?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          interval_days?: number | null
          interval_miles?: number | null
          is_active?: boolean
          item?: string
          last_done_miles?: number | null
          last_done_on?: string | null
          next_due_miles?: number | null
          next_due_on?: string | null
          notes?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_schedules_vehicle_id_fkey"
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
      outbound_messages: {
        Row: {
          application_id: string | null
          body: string
          channel: string
          created_at: string
          enrollment_id: string | null
          error: string | null
          from_address: string | null
          id: string
          kind: string | null
          provider: string | null
          provider_message_id: string | null
          rental_id: string | null
          sent_at: string | null
          status: string
          step_id: string | null
          subject: string | null
          to_address: string
          vehicle_id: string | null
          workflow_id: string | null
        }
        Insert: {
          application_id?: string | null
          body: string
          channel: string
          created_at?: string
          enrollment_id?: string | null
          error?: string | null
          from_address?: string | null
          id?: string
          kind?: string | null
          provider?: string | null
          provider_message_id?: string | null
          rental_id?: string | null
          sent_at?: string | null
          status?: string
          step_id?: string | null
          subject?: string | null
          to_address: string
          vehicle_id?: string | null
          workflow_id?: string | null
        }
        Update: {
          application_id?: string | null
          body?: string
          channel?: string
          created_at?: string
          enrollment_id?: string | null
          error?: string | null
          from_address?: string | null
          id?: string
          kind?: string | null
          provider?: string | null
          provider_message_id?: string | null
          rental_id?: string | null
          sent_at?: string | null
          status?: string
          step_id?: string | null
          subject?: string | null
          to_address?: string
          vehicle_id?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "automation_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "automation_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "automation_workflows"
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
          late_fee_applied_through: string | null
          late_fees: number
          notes: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          rental_id: string | null
          status: string
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          stripe_subscription_id: string | null
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
          late_fee_applied_through?: string | null
          late_fees?: number
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          rental_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
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
          late_fee_applied_through?: string | null
          late_fees?: number
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          rental_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
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
            foreignKeyName: "payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
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
          autopay_active: boolean
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          created_at: string
          deposit_amount: number
          deposit_held: boolean
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string
          driver_id: string
          end_date: string | null
          id: string
          next_payment_due: string | null
          payment_status: string
          start_date: string
          status: string
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          vehicle_id: string
          weekly_rate: number
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string
          deposit_amount?: number
          deposit_held?: boolean
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string
          driver_id: string
          end_date?: string | null
          id?: string
          next_payment_due?: string | null
          payment_status?: string
          start_date?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          vehicle_id: string
          weekly_rate?: number
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string
          deposit_amount?: number
          deposit_held?: boolean
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string
          driver_id?: string
          end_date?: string | null
          id?: string
          next_payment_due?: string | null
          payment_status?: string
          start_date?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
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
      sms_opt_outs: {
        Row: {
          created_at: string
          phone: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          phone: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          phone?: string
          reason?: string | null
        }
        Relationships: []
      }
      toll_charges: {
        Row: {
          admin_fee: number
          agency: string | null
          amount: number
          application_id: string | null
          charge_type: string
          created_at: string
          created_by: string | null
          id: string
          location: string | null
          notes: string | null
          occurred_at: string
          payment_id: string | null
          reference_number: string | null
          rental_id: string | null
          source: string
          status: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          admin_fee?: number
          agency?: string | null
          amount?: number
          application_id?: string | null
          charge_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          occurred_at: string
          payment_id?: string | null
          reference_number?: string | null
          rental_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          admin_fee?: number
          agency?: string | null
          amount?: number
          application_id?: string | null
          charge_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          occurred_at?: string
          payment_id?: string | null
          reference_number?: string | null
          rental_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "toll_charges_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toll_charges_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toll_charges_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toll_charges_vehicle_id_fkey"
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
          current_odometer: number | null
          deposit: number | null
          description: string | null
          doors: number | null
          fuel_type: string
          gps_device_id: string | null
          gps_installed_on: string | null
          gps_provider: string | null
          id: string
          insurance_carrier: string | null
          insurance_expires_on: string | null
          insurance_policy_number: string | null
          internal_notes: string | null
          key_count: number | null
          last_brake_inspection_date: string | null
          last_oil_change_miles: number | null
          last_tire_date: string | null
          license_plate: string | null
          lienholder: string | null
          maintenance_status: string | null
          make: string
          market_id: string | null
          miles_per_tank: number | null
          model: string
          monthly_rate: number | null
          mpg: number | null
          odometer_updated_at: string | null
          oil_interval_miles: number
          partner_id: string | null
          photos: string[] | null
          plate_expires_on: string | null
          plate_state: string | null
          purchase_date: string | null
          purchase_price: number | null
          registration_expires_on: string | null
          registration_state: string | null
          seats: number | null
          status: string
          title_number: string | null
          title_status: string | null
          toll_account: string | null
          toll_transponder_id: string | null
          trim: string | null
          uber_eligibility: string[] | null
          vin: string | null
          weekly_rate: number
          year: number
        }
        Insert: {
          badges?: string[] | null
          body_type?: string | null
          color?: string | null
          created_at?: string | null
          current_odometer?: number | null
          deposit?: number | null
          description?: string | null
          doors?: number | null
          fuel_type?: string
          gps_device_id?: string | null
          gps_installed_on?: string | null
          gps_provider?: string | null
          id?: string
          insurance_carrier?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          internal_notes?: string | null
          key_count?: number | null
          last_brake_inspection_date?: string | null
          last_oil_change_miles?: number | null
          last_tire_date?: string | null
          license_plate?: string | null
          lienholder?: string | null
          maintenance_status?: string | null
          make: string
          market_id?: string | null
          miles_per_tank?: number | null
          model: string
          monthly_rate?: number | null
          mpg?: number | null
          odometer_updated_at?: string | null
          oil_interval_miles?: number
          partner_id?: string | null
          photos?: string[] | null
          plate_expires_on?: string | null
          plate_state?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          registration_expires_on?: string | null
          registration_state?: string | null
          seats?: number | null
          status?: string
          title_number?: string | null
          title_status?: string | null
          toll_account?: string | null
          toll_transponder_id?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          vin?: string | null
          weekly_rate: number
          year: number
        }
        Update: {
          badges?: string[] | null
          body_type?: string | null
          color?: string | null
          created_at?: string | null
          current_odometer?: number | null
          deposit?: number | null
          description?: string | null
          doors?: number | null
          fuel_type?: string
          gps_device_id?: string | null
          gps_installed_on?: string | null
          gps_provider?: string | null
          id?: string
          insurance_carrier?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          internal_notes?: string | null
          key_count?: number | null
          last_brake_inspection_date?: string | null
          last_oil_change_miles?: number | null
          last_tire_date?: string | null
          license_plate?: string | null
          lienholder?: string | null
          maintenance_status?: string | null
          make?: string
          market_id?: string | null
          miles_per_tank?: number | null
          model?: string
          monthly_rate?: number | null
          mpg?: number | null
          odometer_updated_at?: string | null
          oil_interval_miles?: number
          partner_id?: string | null
          photos?: string[] | null
          plate_expires_on?: string | null
          plate_state?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          registration_expires_on?: string | null
          registration_state?: string | null
          seats?: number | null
          status?: string
          title_number?: string | null
          title_status?: string | null
          toll_account?: string | null
          toll_transponder_id?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          vin?: string | null
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
      vendors: {
        Row: {
          account_number: string | null
          address: string | null
          city: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          hours: string | null
          id: string
          is_active: boolean
          market_id: string | null
          name: string
          notes: string | null
          phone: string | null
          preferred: boolean
          rate_notes: string | null
          rating: number | null
          services: string[]
          state: string | null
          updated_at: string
          vendor_type: string
          website: string | null
          zip: string | null
        }
        Insert: {
          account_number?: string | null
          address?: string | null
          city?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          hours?: string | null
          id?: string
          is_active?: boolean
          market_id?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          preferred?: boolean
          rate_notes?: string | null
          rating?: number | null
          services?: string[]
          state?: string | null
          updated_at?: string
          vendor_type?: string
          website?: string | null
          zip?: string | null
        }
        Update: {
          account_number?: string | null
          address?: string | null
          city?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          hours?: string | null
          id?: string
          is_active?: boolean
          market_id?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          preferred?: boolean
          rate_notes?: string | null
          rating?: number | null
          services?: string[]
          state?: string | null
          updated_at?: string
          vendor_type?: string
          website?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
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
      get_cron_token: { Args: { _name: string }; Returns: string }
      rental_at_time: { Args: { _vehicle_id: string; _at: string }; Returns: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
