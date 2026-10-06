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
          application_id: string | null
          archive_attempts: number
          archive_error: string | null
          archive_last_attempt_at: string | null
          archive_status: string
          auth_method: string | null
          body: string
          body_sha256: string | null
          company_signer_name: string
          company_signer_title: string | null
          completed_at: string | null
          completed_document_id: string | null
          created_at: string
          created_by: string | null
          document_id: string | null
          email_attempted_at: string | null
          email_error: string | null
          email_status: string
          expires_at: string | null
          id: string
          merge_data: Json
          metadata: Json
          rental_id: string | null
          sent_at: string | null
          sha256: string | null
          signed_at: string | null
          signer_email: string | null
          signer_ip: string | null
          signer_name: string | null
          signer_user_agent: string | null
          signing_started_at: string | null
          sms_attempted_at: string | null
          sms_error: string | null
          sms_status: string
          source: string
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
          application_id?: string | null
          archive_attempts?: number
          archive_error?: string | null
          archive_last_attempt_at?: string | null
          archive_status?: string
          auth_method?: string | null
          body: string
          body_sha256?: string | null
          company_signer_name?: string
          company_signer_title?: string | null
          completed_at?: string | null
          completed_document_id?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          email_attempted_at?: string | null
          email_error?: string | null
          email_status?: string
          expires_at?: string | null
          id?: string
          merge_data?: Json
          metadata?: Json
          rental_id?: string | null
          sent_at?: string | null
          sha256?: string | null
          signed_at?: string | null
          signer_email?: string | null
          signer_ip?: string | null
          signer_name?: string | null
          signer_user_agent?: string | null
          signing_started_at?: string | null
          sms_attempted_at?: string | null
          sms_error?: string | null
          sms_status?: string
          source?: string
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
          application_id?: string | null
          archive_attempts?: number
          archive_error?: string | null
          archive_last_attempt_at?: string | null
          archive_status?: string
          auth_method?: string | null
          body?: string
          body_sha256?: string | null
          company_signer_name?: string
          company_signer_title?: string | null
          completed_at?: string | null
          completed_document_id?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          email_attempted_at?: string | null
          email_error?: string | null
          email_status?: string
          expires_at?: string | null
          id?: string
          merge_data?: Json
          metadata?: Json
          rental_id?: string | null
          sent_at?: string | null
          sha256?: string | null
          signed_at?: string | null
          signer_email?: string | null
          signer_ip?: string | null
          signer_name?: string | null
          signer_user_agent?: string | null
          signing_started_at?: string | null
          sms_attempted_at?: string | null
          sms_error?: string | null
          sms_status?: string
          source?: string
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
          {
            foreignKeyName: "agreements_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
      applicant_upload_grants: {
        Row: {
          application_id: string
          created_at: string
          id: string
          kind: string
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          kind: string
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "applicant_upload_grants_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_resume_tokens: {
        Row: {
          application_id: string
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          application_id: string
          created_at?: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          application_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_resume_tokens_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
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
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string | null
          current_step: string | null
          deposit_amount: number | null
          deposit_paid: number | null
          deposit_status: string
          dob: string | null
          doc_request_note: string | null
          doc_request_sent_at: string | null
          drive_type: string | null
          earnings_verified_status: string
          email: string
          expected_duration: string | null
          full_coverage_insurance: boolean | null
          full_name: string
          gclid: string | null
          gig_status: string | null
          how_heard: string | null
          id: string
          incident_count: number
          insurance_answer: string | null
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
          reviewed_at: string | null
          reviewed_by: string | null
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
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string
          email: string
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name: string
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string
          incident_count?: number
          insurance_answer?: string | null
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
          reviewed_at?: string | null
          reviewed_by?: string | null
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
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string
          email?: string
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name?: string
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string
          incident_count?: number
          insurance_answer?: string | null
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
          reviewed_at?: string | null
          reviewed_by?: string | null
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
          {
            foreignKeyName: "applications_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip: string | null
          metadata: Json
          summary: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip?: string | null
          metadata?: Json
          summary: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip?: string | null
          metadata?: Json
          summary?: string
          user_agent?: string | null
        }
        Relationships: []
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
            foreignKeyName: "condition_media_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
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
          {
            foreignKeyName: "condition_media_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
      document_vehicle_links: {
        Row: {
          created_at: string
          created_by: string | null
          document_id: string
          id: string
          page: number | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_id: string
          id?: string
          page?: number | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_id?: string
          id?: string
          page?: number | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_vehicle_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_vehicle_links_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_vehicle_links_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          category: string
          content_sha256: string | null
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
          page_count: number | null
          partner_id: string | null
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          size_bytes: number | null
          source: string | null
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
          content_sha256?: string | null
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
          page_count?: number | null
          partner_id?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number | null
          source?: string | null
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
          content_sha256?: string | null
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
          page_count?: number | null
          partner_id?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number | null
          source?: string | null
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
          {
            foreignKeyName: "documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
      email_deliveries: {
        Row: {
          accepted_at: string | null
          bounced_at: string | null
          complained_at: string | null
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          id: string
          provider_reason: string | null
          recipient: string
          resend_message_id: string | null
          state: string
          updated_at: string
          workflow: string
        }
        Insert: {
          accepted_at?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          id?: string
          provider_reason?: string | null
          recipient: string
          resend_message_id?: string | null
          state?: string
          updated_at?: string
          workflow: string
        }
        Update: {
          accepted_at?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          id?: string
          provider_reason?: string | null
          recipient?: string
          resend_message_id?: string | null
          state?: string
          updated_at?: string
          workflow?: string
        }
        Relationships: []
      }
      esign_recipients: {
        Row: {
          auth_method: string | null
          created_at: string
          document_id: string
          email: string | null
          id: string
          ip: string | null
          name: string | null
          phone: string | null
          role: string
          sent_at: string | null
          signed_at: string | null
          signing_order: number
          status: string
          token_expires_at: string | null
          token_hash: string | null
          token_revoked_at: string | null
          updated_at: string
          user_agent: string | null
          viewed_at: string | null
        }
        Insert: {
          auth_method?: string | null
          created_at?: string
          document_id: string
          email?: string | null
          id?: string
          ip?: string | null
          name?: string | null
          phone?: string | null
          role?: string
          sent_at?: string | null
          signed_at?: string | null
          signing_order?: number
          status?: string
          token_expires_at?: string | null
          token_hash?: string | null
          token_revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          viewed_at?: string | null
        }
        Update: {
          auth_method?: string | null
          created_at?: string
          document_id?: string
          email?: string | null
          id?: string
          ip?: string | null
          name?: string | null
          phone?: string | null
          role?: string
          sent_at?: string | null
          signed_at?: string | null
          signing_order?: number
          status?: string
          token_expires_at?: string | null
          token_hash?: string | null
          token_revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esign_recipients_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      fleet_import_finance_facts: {
        Row: {
          confidence: string | null
          created_at: string
          field: string
          id: string
          item_id: string
          page: number | null
          proposal_id: string | null
          value: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          field: string
          id?: string
          item_id: string
          page?: number | null
          proposal_id?: string | null
          value: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          field?: string
          id?: string
          item_id?: string
          page?: number | null
          proposal_id?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_import_finance_facts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "fleet_import_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_import_finance_facts_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "fleet_import_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_import_items: {
        Row: {
          analyzed_at: string | null
          attempts: number
          batch_id: string
          class_confidence: string | null
          classified_manually: boolean
          content_sha256: string | null
          created_at: string
          doc_class: string | null
          document_id: string | null
          duplicate_of_document_id: string | null
          error: string | null
          extraction: Json | null
          file_name: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          status: string
          updated_at: string
          warnings: Json
        }
        Insert: {
          analyzed_at?: string | null
          attempts?: number
          batch_id: string
          class_confidence?: string | null
          classified_manually?: boolean
          content_sha256?: string | null
          created_at?: string
          doc_class?: string | null
          document_id?: string | null
          duplicate_of_document_id?: string | null
          error?: string | null
          extraction?: Json | null
          file_name: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          status?: string
          updated_at?: string
          warnings?: Json
        }
        Update: {
          analyzed_at?: string | null
          attempts?: number
          batch_id?: string
          class_confidence?: string | null
          classified_manually?: boolean
          content_sha256?: string | null
          created_at?: string
          doc_class?: string | null
          document_id?: string | null
          duplicate_of_document_id?: string | null
          error?: string | null
          extraction?: Json | null
          file_name?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          status?: string
          updated_at?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "fleet_import_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "fleet_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_import_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_import_items_duplicate_of_document_id_fkey"
            columns: ["duplicate_of_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_import_proposals: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          applied_vehicle_id: string | null
          batch_id: string
          changes: Json
          created_at: string
          entry_index: number
          fields: Json
          id: string
          identity: Json
          issues: Json
          item_id: string
          kind: string
          match_basis: string | null
          match_vehicle_id: string | null
          page: number | null
          result: Json | null
          status: string
          updated_at: string
          vin: string | null
          vin_check: Json | null
          vin_raw: string | null
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          applied_vehicle_id?: string | null
          batch_id: string
          changes?: Json
          created_at?: string
          entry_index: number
          fields?: Json
          id?: string
          identity?: Json
          issues?: Json
          item_id: string
          kind: string
          match_basis?: string | null
          match_vehicle_id?: string | null
          page?: number | null
          result?: Json | null
          status?: string
          updated_at?: string
          vin?: string | null
          vin_check?: Json | null
          vin_raw?: string | null
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          applied_vehicle_id?: string | null
          batch_id?: string
          changes?: Json
          created_at?: string
          entry_index?: number
          fields?: Json
          id?: string
          identity?: Json
          issues?: Json
          item_id?: string
          kind?: string
          match_basis?: string | null
          match_vehicle_id?: string | null
          page?: number | null
          result?: Json | null
          status?: string
          updated_at?: string
          vin?: string | null
          vin_check?: Json | null
          vin_raw?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_import_proposals_applied_vehicle_id_fkey"
            columns: ["applied_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_import_proposals_applied_vehicle_id_fkey"
            columns: ["applied_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_import_proposals_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "fleet_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_import_proposals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "fleet_import_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_import_proposals_match_vehicle_id_fkey"
            columns: ["match_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_import_proposals_match_vehicle_id_fkey"
            columns: ["match_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
            foreignKeyName: "incidents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
          {
            foreignKeyName: "inspections_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
          {
            foreignKeyName: "issues_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
            foreignKeyName: "maintenance_records_schedule_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "maintenance_schedules"
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
          {
            foreignKeyName: "maintenance_records_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_records_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
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
          {
            foreignKeyName: "maintenance_schedules_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
            foreignKeyName: "outbound_messages_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
      payment_refunds: {
        Row: {
          amount: number
          created_at: string
          id: string
          payment_ids: string[]
          status: string | null
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          stripe_refund_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          payment_ids?: string[]
          status?: string | null
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          payment_ids?: string[]
          status?: string | null
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          attempt_count: number
          balance_due: number
          created_at: string
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number
          refunded_at: string | null
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
          attempt_count?: number
          balance_due?: number
          created_at?: string
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number
          refunded_at?: string | null
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
          attempt_count?: number
          balance_due?: number
          created_at?: string
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number
          refunded_at?: string | null
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
          {
            foreignKeyName: "payments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
          {
            foreignKeyName: "rentals_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
      staff_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          invited_by_email: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          invited_by_email?: string | null
          revoked_at?: string | null
          role: Database["public"]["Enums"]["app_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          invited_by_email?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token_hash?: string
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
          {
            foreignKeyName: "toll_charges_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
      vehicle_expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          incurred_on: string
          is_recurring: boolean
          notes: string | null
          payment_method: string | null
          receipt_mime: string | null
          receipt_name: string | null
          receipt_path: string | null
          reference: string | null
          rental_id: string | null
          updated_at: string
          vehicle_id: string
          vendor_id: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          incurred_on?: string
          is_recurring?: boolean
          notes?: string | null
          payment_method?: string | null
          receipt_mime?: string | null
          receipt_name?: string | null
          receipt_path?: string | null
          reference?: string | null
          rental_id?: string | null
          updated_at?: string
          vehicle_id: string
          vendor_id?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          incurred_on?: string
          is_recurring?: boolean
          notes?: string | null
          payment_method?: string | null
          receipt_mime?: string | null
          receipt_name?: string | null
          receipt_path?: string | null
          reference?: string | null
          rental_id?: string | null
          updated_at?: string
          vehicle_id?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_expenses_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_expenses_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_expenses_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_expenses_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_field_provenance: {
        Row: {
          authority: number
          confidence: string | null
          confirmed_at: string
          confirmed_by: string | null
          doc_class: string | null
          document_id: string | null
          extracted_at: string | null
          field: string
          id: string
          method: string
          page: number | null
          proposal_id: string | null
          raw_value: string | null
          value: string | null
          vehicle_id: string
        }
        Insert: {
          authority?: number
          confidence?: string | null
          confirmed_at?: string
          confirmed_by?: string | null
          doc_class?: string | null
          document_id?: string | null
          extracted_at?: string | null
          field: string
          id?: string
          method?: string
          page?: number | null
          proposal_id?: string | null
          raw_value?: string | null
          value?: string | null
          vehicle_id: string
        }
        Update: {
          authority?: number
          confidence?: string | null
          confirmed_at?: string
          confirmed_by?: string | null
          doc_class?: string | null
          document_id?: string | null
          extracted_at?: string | null
          field?: string
          id?: string
          method?: string
          page?: number | null
          proposal_id?: string | null
          raw_value?: string | null
          value?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_field_provenance_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_field_provenance_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "fleet_import_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_field_provenance_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_field_provenance_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_finance: {
        Row: {
          created_at: string
          legal_owner: string | null
          lienholder: string | null
          loan_maturity_date: string | null
          loan_reference: string | null
          monthly_payment: number | null
          ownership_type: string | null
          payoff_amount: number | null
          purchase_date: string | null
          purchase_price: number | null
          seller_dealer: string | null
          updated_at: string
          updated_by: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          legal_owner?: string | null
          lienholder?: string | null
          loan_maturity_date?: string | null
          loan_reference?: string | null
          monthly_payment?: number | null
          ownership_type?: string | null
          payoff_amount?: number | null
          purchase_date?: string | null
          purchase_price?: number | null
          seller_dealer?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          legal_owner?: string | null
          lienholder?: string | null
          loan_maturity_date?: string | null
          loan_reference?: string | null
          monthly_payment?: number | null
          ownership_type?: string | null
          payoff_amount?: number | null
          purchase_date?: string | null
          purchase_price?: number | null
          seller_dealer?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_finance_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: true
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_finance_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: true
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_media: {
        Row: {
          caption: string | null
          created_at: string
          derived_from_id: string | null
          enhancement_mode: string | null
          enhancement_provider: string | null
          file_name: string | null
          id: string
          is_primary: boolean
          kind: string
          mime_type: string | null
          provenance: string
          published: boolean
          size_bytes: number | null
          sort_order: number
          storage_bucket: string
          storage_path: string
          uploaded_by: string | null
          vehicle_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          derived_from_id?: string | null
          enhancement_mode?: string | null
          enhancement_provider?: string | null
          file_name?: string | null
          id?: string
          is_primary?: boolean
          kind: string
          mime_type?: string | null
          provenance?: string
          published?: boolean
          size_bytes?: number | null
          sort_order?: number
          storage_bucket?: string
          storage_path: string
          uploaded_by?: string | null
          vehicle_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          derived_from_id?: string | null
          enhancement_mode?: string | null
          enhancement_provider?: string | null
          file_name?: string | null
          id?: string
          is_primary?: boolean
          kind?: string
          mime_type?: string | null
          provenance?: string
          published?: boolean
          size_bytes?: number | null
          sort_order?: number
          storage_bucket?: string
          storage_path?: string
          uploaded_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_media_derived_from_id_fkey"
            columns: ["derived_from_id"]
            isOneToOne: false
            referencedRelation: "vehicle_media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_media_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_media_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          badges: string[] | null
          body_type: string | null
          color: string | null
          created_at: string | null
          current_odometer: number | null
          deposit: number | null
          description: string | null
          doors: number | null
          fuel_type: string
          gps_battery: string | null
          gps_device_id: string | null
          gps_geofence_status: string | null
          gps_imei: string | null
          gps_install_notes: string | null
          gps_installed_on: string | null
          gps_last_location: Json | null
          gps_last_ping_at: string | null
          gps_odometer: number | null
          gps_provider: string | null
          gps_serial: string | null
          gps_sim: string | null
          gps_status: string | null
          gps_tracking_url: string | null
          id: string
          insurance_agent_email: string | null
          insurance_agent_name: string | null
          insurance_agent_phone: string | null
          insurance_carrier: string | null
          insurance_coverage: string | null
          insurance_effective_on: string | null
          insurance_expires_on: string | null
          insurance_policy_number: string | null
          insurance_status: string | null
          internal_notes: string | null
          key_count: number | null
          key_location: string | null
          key_notes: string | null
          key_tag: string | null
          key_type: string | null
          last_brake_inspection_date: string | null
          last_oil_change_miles: number | null
          last_tire_date: string | null
          license_plate: string | null
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
          registration_expires_on: string | null
          registration_number: string | null
          registration_state: string | null
          seats: number | null
          spare_key: boolean | null
          status: string
          title_number: string | null
          title_status: string | null
          toll_account: string | null
          toll_transponder_id: string | null
          trim: string | null
          uber_eligibility: string[] | null
          unit_number: string | null
          vin: string | null
          weekly_rate: number
          year: number
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          badges?: string[] | null
          body_type?: string | null
          color?: string | null
          created_at?: string | null
          current_odometer?: number | null
          deposit?: number | null
          description?: string | null
          doors?: number | null
          fuel_type?: string
          gps_battery?: string | null
          gps_device_id?: string | null
          gps_geofence_status?: string | null
          gps_imei?: string | null
          gps_install_notes?: string | null
          gps_installed_on?: string | null
          gps_last_location?: Json | null
          gps_last_ping_at?: string | null
          gps_odometer?: number | null
          gps_provider?: string | null
          gps_serial?: string | null
          gps_sim?: string | null
          gps_status?: string | null
          gps_tracking_url?: string | null
          id?: string
          insurance_agent_email?: string | null
          insurance_agent_name?: string | null
          insurance_agent_phone?: string | null
          insurance_carrier?: string | null
          insurance_coverage?: string | null
          insurance_effective_on?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_status?: string | null
          internal_notes?: string | null
          key_count?: number | null
          key_location?: string | null
          key_notes?: string | null
          key_tag?: string | null
          key_type?: string | null
          last_brake_inspection_date?: string | null
          last_oil_change_miles?: number | null
          last_tire_date?: string | null
          license_plate?: string | null
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
          registration_expires_on?: string | null
          registration_number?: string | null
          registration_state?: string | null
          seats?: number | null
          spare_key?: boolean | null
          status?: string
          title_number?: string | null
          title_status?: string | null
          toll_account?: string | null
          toll_transponder_id?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          unit_number?: string | null
          vin?: string | null
          weekly_rate: number
          year: number
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          badges?: string[] | null
          body_type?: string | null
          color?: string | null
          created_at?: string | null
          current_odometer?: number | null
          deposit?: number | null
          description?: string | null
          doors?: number | null
          fuel_type?: string
          gps_battery?: string | null
          gps_device_id?: string | null
          gps_geofence_status?: string | null
          gps_imei?: string | null
          gps_install_notes?: string | null
          gps_installed_on?: string | null
          gps_last_location?: Json | null
          gps_last_ping_at?: string | null
          gps_odometer?: number | null
          gps_provider?: string | null
          gps_serial?: string | null
          gps_sim?: string | null
          gps_status?: string | null
          gps_tracking_url?: string | null
          id?: string
          insurance_agent_email?: string | null
          insurance_agent_name?: string | null
          insurance_agent_phone?: string | null
          insurance_carrier?: string | null
          insurance_coverage?: string | null
          insurance_effective_on?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_status?: string | null
          internal_notes?: string | null
          key_count?: number | null
          key_location?: string | null
          key_notes?: string | null
          key_tag?: string | null
          key_type?: string | null
          last_brake_inspection_date?: string | null
          last_oil_change_miles?: number | null
          last_tire_date?: string | null
          license_plate?: string | null
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
          registration_expires_on?: string | null
          registration_number?: string | null
          registration_state?: string | null
          seats?: number | null
          spare_key?: boolean | null
          status?: string
          title_number?: string | null
          title_status?: string | null
          toll_account?: string | null
          toll_transponder_id?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          unit_number?: string | null
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
          city: string | null
          created_at: string
          driver_status: string | null
          email: string
          full_name: string
          gclid: string | null
          id: string
          market_id: string | null
          notified_at: string | null
          phone: string | null
          pickup_date: string | null
          promoted_application_id: string | null
          promoted_at: string | null
          source: string
          state: string | null
          status: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          driver_status?: string | null
          email: string
          full_name: string
          gclid?: string | null
          id?: string
          market_id?: string | null
          notified_at?: string | null
          phone?: string | null
          pickup_date?: string | null
          promoted_application_id?: string | null
          promoted_at?: string | null
          source?: string
          state?: string | null
          status?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          driver_status?: string | null
          email?: string
          full_name?: string
          gclid?: string | null
          id?: string
          market_id?: string | null
          notified_at?: string | null
          phone?: string | null
          pickup_date?: string | null
          promoted_application_id?: string | null
          promoted_at?: string | null
          source?: string
          state?: string | null
          status?: string
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
          {
            foreignKeyName: "waitlist_promoted_application_id_fkey"
            columns: ["promoted_application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      vehicles_public: {
        Row: {
          badges: string[] | null
          body_type: string | null
          color: string | null
          description: string | null
          doors: number | null
          fuel_type: string | null
          id: string | null
          make: string | null
          miles_per_tank: number | null
          model: string | null
          monthly_rate: number | null
          mpg: number | null
          photos: string[] | null
          seats: number | null
          status: string | null
          trim: string | null
          uber_eligibility: string[] | null
          weekly_rate: number | null
          year: number | null
        }
        Insert: {
          badges?: string[] | null
          body_type?: string | null
          color?: string | null
          description?: string | null
          doors?: number | null
          fuel_type?: string | null
          id?: string | null
          make?: string | null
          miles_per_tank?: number | null
          model?: string | null
          monthly_rate?: number | null
          mpg?: number | null
          photos?: string[] | null
          seats?: number | null
          status?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          weekly_rate?: number | null
          year?: number | null
        }
        Update: {
          badges?: string[] | null
          body_type?: string | null
          color?: string | null
          description?: string | null
          doors?: number | null
          fuel_type?: string | null
          id?: string | null
          make?: string | null
          miles_per_tank?: number | null
          model?: string | null
          monthly_rate?: number | null
          mpg?: number | null
          photos?: string[] | null
          seats?: number | null
          status?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          weekly_rate?: number | null
          year?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      activate_rental_tx: {
        Args: {
          _application_id: string
          _deposit: number
          _deposit_held: boolean
          _driver_id: string
          _end: string
          _start: string
          _vehicle_id: string
          _weekly_rate: number
        }
        Returns: string
      }
      application_accepts_uploads: {
        Args: { _application_id: string }
        Returns: boolean
      }
      apply_payment_refund: {
        Args: {
          _charge_id: string
          _cumulative: number
          _payment_ids: string[]
          _pi: string
          _refunds: Json
        }
        Returns: Json
      }
      cars_available: { Args: never; Returns: number }
      email_delivery_attach: {
        Args: { _id: string; _resend_id: string }
        Returns: undefined
      }
      email_delivery_event: {
        Args: {
          _reason: string
          _recipient: string
          _resend_id: string
          _state: string
        }
        Returns: string
      }
      email_state_rank: { Args: { _s: string }; Returns: number }
      end_rental_tx: {
        Args: { _end: string; _rental_id: string; _vehicle_status: string }
        Returns: string
      }
      esign_claim: {
        Args: { _id: string; _token_hash: string }
        Returns: string
      }
      esign_void: { Args: { _id: string }; Returns: string }
      get_cron_token: { Args: { _name: string }; Returns: string }
      next_unit_number: { Args: { _prefix?: string }; Returns: string }
      rental_at_time: {
        Args: { _at: string; _vehicle_id: string }
        Returns: string
      }
      submission_accepts_uploads: {
        Args: { _submission_id: string }
        Returns: boolean
      }
      sync_vehicle_photos: { Args: { _vehicle_id: string }; Returns: undefined }
      vehicle_pl: {
        Args: { _from?: string; _to?: string }
        Returns: {
          days_on_rent: number
          expenses: number
          license_plate: string
          maintenance: number
          make: string
          model: string
          net: number
          revenue: number
          status: string
          vehicle_id: string
          year: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user" | "partner" | "driver" | "team" | "coordinator"
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
      app_role: ["admin", "user", "partner", "driver", "team", "coordinator"],
    },
  },
} as const
