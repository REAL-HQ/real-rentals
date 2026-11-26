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
      _backup_20261119_heather_repo_applications: {
        Row: {
          address: string | null
          ai_flags: Json | null
          ai_score: number | null
          ai_summary: string | null
          ai_tier: string | null
          background_check_status: string | null
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
          contact_follow_up_on: string | null
          contact_status: string | null
          contact_status_at: string | null
          contact_status_by: string | null
          contact_status_note: string | null
          contacted_at: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string | null
          current_step: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          deposit_amount: number | null
          deposit_paid: number | null
          deposit_status: string | null
          dob: string | null
          doc_request_note: string | null
          doc_request_sent_at: string | null
          drive_type: string | null
          earnings_verified_status: string | null
          email: string | null
          expected_duration: string | null
          full_coverage_insurance: boolean | null
          full_name: string | null
          gclid: string | null
          gig_status: string | null
          how_heard: string | null
          id: string | null
          incident_count: number | null
          income_proof_url: string | null
          insurance_answer: string | null
          insurance_carrier: string | null
          insurance_doc_url: string | null
          insurance_expires_on: string | null
          insurance_policy_number: string | null
          insurance_rideshare_endorsement: boolean | null
          insurance_status: string | null
          landing_page: string | null
          legal_hold: boolean | null
          license_expiration: string | null
          license_number: string | null
          license_photo_url: string | null
          license_state: string | null
          license_valid: boolean | null
          market_id: string | null
          mvr_status: string | null
          notes: string | null
          payment_method: string | null
          payment_status: string | null
          phone: string | null
          pickup_date: string | null
          pickup_time: string | null
          platform_active: boolean | null
          platform_status: string | null
          platforms: string[] | null
          primary_application_id: string | null
          profile_screenshot_url: string | null
          purged_at: string | null
          rating: number | null
          recovery_email_sent_24h: string | null
          recovery_email_sent_72h: string | null
          recovery_sent_at: string | null
          referrer: string | null
          rental_duration: string | null
          rental_duration_days: number | null
          rental_length: string | null
          rental_term: string | null
          renter_policy_status: string | null
          requested_docs: Json | null
          resubmission_count: number | null
          resubmission_history: Json | null
          return_date: string | null
          return_time: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rideshare_history_status: string | null
          score: number | null
          scored_at: string | null
          sms_consent: boolean | null
          sms_consent_at: string | null
          sms_consent_page: string | null
          sms_consent_phone: string | null
          sms_consent_source: string | null
          sms_consent_text: string | null
          sms_consent_version: string | null
          sms_opt_out_at: string | null
          source: string | null
          start_date: string | null
          start_timing: string | null
          state: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          trip_screenshots: string[] | null
          trips_completed: string | null
          updated_at: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          vehicle_id: string | null
          vehicle_size: string | null
          waitlist_signed_up_at: string | null
          waitlist_source: string | null
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
          background_check_status?: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string | null
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string | null
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string | null
          email?: string | null
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name?: string | null
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string | null
          incident_count?: number | null
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string | null
          landing_page?: string | null
          legal_hold?: boolean | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          phone?: string | null
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
          requested_docs?: Json | null
          resubmission_count?: number | null
          resubmission_history?: Json | null
          return_date?: string | null
          return_time?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rideshare_history_status?: string | null
          score?: number | null
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          trip_screenshots?: string[] | null
          trips_completed?: string | null
          updated_at?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
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
          background_check_status?: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string | null
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string | null
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string | null
          email?: string | null
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name?: string | null
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string | null
          incident_count?: number | null
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string | null
          landing_page?: string | null
          legal_hold?: boolean | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          phone?: string | null
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
          requested_docs?: Json | null
          resubmission_count?: number | null
          resubmission_history?: Json | null
          return_date?: string | null
          return_time?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rideshare_history_status?: string | null
          score?: number | null
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          trip_screenshots?: string[] | null
          trips_completed?: string | null
          updated_at?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
          weekly_hours?: number | null
          weekly_rent?: number | null
          years_licensed?: number | null
          zip?: string | null
        }
        Relationships: []
      }
      _backup_20261119_heather_repo_automation_enrollments: {
        Row: {
          application_id: string | null
          cancelled_reason: string | null
          completed_at: string | null
          created_at: string | null
          current_step: number | null
          enrolled_at: string | null
          id: string | null
          next_run_at: string | null
          rental_id: string | null
          status: string | null
          updated_at: string | null
          workflow_id: string | null
        }
        Insert: {
          application_id?: string | null
          cancelled_reason?: string | null
          completed_at?: string | null
          created_at?: string | null
          current_step?: number | null
          enrolled_at?: string | null
          id?: string | null
          next_run_at?: string | null
          rental_id?: string | null
          status?: string | null
          updated_at?: string | null
          workflow_id?: string | null
        }
        Update: {
          application_id?: string | null
          cancelled_reason?: string | null
          completed_at?: string | null
          created_at?: string | null
          current_step?: number | null
          enrolled_at?: string | null
          id?: string | null
          next_run_at?: string | null
          rental_id?: string | null
          status?: string | null
          updated_at?: string | null
          workflow_id?: string | null
        }
        Relationships: []
      }
      _backup_20261119_heather_repo_payment_text_pauses: {
        Row: {
          application_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          idempotency_key: string | null
          pause_until: string | null
          reason: string | null
          rental_id: string | null
          source: string | null
          starts_at: string | null
        }
        Insert: {
          application_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          idempotency_key?: string | null
          pause_until?: string | null
          reason?: string | null
          rental_id?: string | null
          source?: string | null
          starts_at?: string | null
        }
        Update: {
          application_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          idempotency_key?: string | null
          pause_until?: string | null
          reason?: string | null
          rental_id?: string | null
          source?: string | null
          starts_at?: string | null
        }
        Relationships: []
      }
      _backup_20261119_heather_repo_payments: {
        Row: {
          amount: number | null
          attempt_count: number | null
          balance_due: number | null
          created_at: string | null
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string | null
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number | null
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          rental_id: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          type: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      _backup_20261119_heather_repo_rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean | null
          balance_due_cents: number | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_held: boolean | null
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string | null
          driver_id: string | null
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          hold_by: string | null
          hold_reason: string | null
          hold_started_at: string | null
          id: string | null
          next_payment_due: string | null
          payment_status: string | null
          pickup_reading_id: string | null
          reservation_deposit_amount: number | null
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean | null
          reservation_deposit_status: string | null
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          weekly_rate: number | null
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261119_heather_repo_vehicles: {
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
          fuel_type: string | null
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
          id: string | null
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
          make: string | null
          market_id: string | null
          miles_per_tank: number | null
          model: string | null
          monthly_rate: number | null
          mpg: number | null
          odometer_updated_at: string | null
          oil_interval_miles: number | null
          partner_id: string | null
          photos: string[] | null
          plate_expires_on: string | null
          plate_state: string | null
          registration_expires_on: string | null
          registration_number: string | null
          registration_state: string | null
          seats: number | null
          spare_key: boolean | null
          status: string | null
          title_number: string | null
          title_on_file: boolean | null
          title_status: string | null
          toll_account: string | null
          toll_transponder_id: string | null
          trim: string | null
          uber_eligibility: string[] | null
          unit_number: string | null
          vin: string | null
          weekly_rate: number | null
          year: number | null
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
          fuel_type?: string | null
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
          id?: string | null
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
          make?: string | null
          market_id?: string | null
          miles_per_tank?: number | null
          model?: string | null
          monthly_rate?: number | null
          mpg?: number | null
          odometer_updated_at?: string | null
          oil_interval_miles?: number | null
          partner_id?: string | null
          photos?: string[] | null
          plate_expires_on?: string | null
          plate_state?: string | null
          registration_expires_on?: string | null
          registration_number?: string | null
          registration_state?: string | null
          seats?: number | null
          spare_key?: boolean | null
          status?: string | null
          title_number?: string | null
          title_on_file?: boolean | null
          title_status?: string | null
          toll_account?: string | null
          toll_transponder_id?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          unit_number?: string | null
          vin?: string | null
          weekly_rate?: number | null
          year?: number | null
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
          fuel_type?: string | null
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
          id?: string | null
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
          make?: string | null
          market_id?: string | null
          miles_per_tank?: number | null
          model?: string | null
          monthly_rate?: number | null
          mpg?: number | null
          odometer_updated_at?: string | null
          oil_interval_miles?: number | null
          partner_id?: string | null
          photos?: string[] | null
          plate_expires_on?: string | null
          plate_state?: string | null
          registration_expires_on?: string | null
          registration_number?: string | null
          registration_state?: string | null
          seats?: number | null
          spare_key?: boolean | null
          status?: string | null
          title_number?: string | null
          title_on_file?: boolean | null
          title_status?: string | null
          toll_account?: string | null
          toll_transponder_id?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          unit_number?: string | null
          vin?: string | null
          weekly_rate?: number | null
          year?: number | null
        }
        Relationships: []
      }
      _backup_20261119_jonathon_hold_payments: {
        Row: {
          amount: number | null
          attempt_count: number | null
          balance_due: number | null
          created_at: string | null
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string | null
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number | null
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          rental_id: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          type: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      _backup_20261119_jonathon_hold_rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean | null
          balance_due_cents: number | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_held: boolean | null
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string | null
          driver_id: string | null
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          id: string | null
          next_payment_due: string | null
          payment_status: string | null
          pickup_reading_id: string | null
          reservation_deposit_amount: number | null
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean | null
          reservation_deposit_status: string | null
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          weekly_rate: number | null
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261119_jonathon_hold_sends: {
        Row: {
          agreement_id: string | null
          application_id: string | null
          channel: string | null
          created_at: string | null
          detail: string | null
          key: string | null
          kind: string | null
          rental_id: string | null
          status: string | null
        }
        Insert: {
          agreement_id?: string | null
          application_id?: string | null
          channel?: string | null
          created_at?: string | null
          detail?: string | null
          key?: string | null
          kind?: string | null
          rental_id?: string | null
          status?: string | null
        }
        Update: {
          agreement_id?: string | null
          application_id?: string | null
          channel?: string | null
          created_at?: string | null
          detail?: string | null
          key?: string | null
          kind?: string | null
          rental_id?: string | null
          status?: string | null
        }
        Relationships: []
      }
      _backup_20261119_payments: {
        Row: {
          amount: number | null
          attempt_count: number | null
          backed_up_at: string | null
          balance_due: number | null
          created_at: string | null
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string | null
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number | null
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          rental_id: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          type: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number | null
          backed_up_at?: string | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number | null
          backed_up_at?: string | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      _backup_20261119_rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean | null
          backed_up_at: string | null
          balance_due_cents: number | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_held: boolean | null
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string | null
          driver_id: string | null
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          id: string | null
          next_payment_due: string | null
          payment_status: string | null
          pickup_reading_id: string | null
          reservation_deposit_amount: number | null
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean | null
          reservation_deposit_status: string | null
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          weekly_rate: number | null
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean | null
          backed_up_at?: string | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean | null
          backed_up_at?: string | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261119_renter_credits_backfill: {
        Row: {
          amount: number | null
          attempt_count: number | null
          balance_due: number | null
          created_at: string | null
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string | null
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number | null
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          rental_id: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          type: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_applications: {
        Row: {
          address: string | null
          ai_flags: Json | null
          ai_score: number | null
          ai_summary: string | null
          ai_tier: string | null
          background_check_status: string | null
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
          contact_follow_up_on: string | null
          contact_status: string | null
          contact_status_at: string | null
          contact_status_by: string | null
          contact_status_note: string | null
          contacted_at: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string | null
          current_step: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          deposit_amount: number | null
          deposit_paid: number | null
          deposit_status: string | null
          dob: string | null
          doc_request_note: string | null
          doc_request_sent_at: string | null
          drive_type: string | null
          earnings_verified_status: string | null
          email: string | null
          expected_duration: string | null
          full_coverage_insurance: boolean | null
          full_name: string | null
          gclid: string | null
          gig_status: string | null
          how_heard: string | null
          id: string | null
          incident_count: number | null
          income_proof_url: string | null
          insurance_answer: string | null
          insurance_carrier: string | null
          insurance_doc_url: string | null
          insurance_expires_on: string | null
          insurance_policy_number: string | null
          insurance_rideshare_endorsement: boolean | null
          insurance_status: string | null
          landing_page: string | null
          legal_hold: boolean | null
          license_expiration: string | null
          license_number: string | null
          license_photo_url: string | null
          license_state: string | null
          license_valid: boolean | null
          market_id: string | null
          mvr_status: string | null
          notes: string | null
          payment_method: string | null
          payment_status: string | null
          phone: string | null
          pickup_date: string | null
          pickup_time: string | null
          platform_active: boolean | null
          platform_status: string | null
          platforms: string[] | null
          primary_application_id: string | null
          profile_screenshot_url: string | null
          purged_at: string | null
          rating: number | null
          recovery_email_sent_24h: string | null
          recovery_email_sent_72h: string | null
          recovery_sent_at: string | null
          referrer: string | null
          rental_duration: string | null
          rental_duration_days: number | null
          rental_length: string | null
          rental_term: string | null
          renter_policy_status: string | null
          requested_docs: Json | null
          resubmission_count: number | null
          resubmission_history: Json | null
          return_date: string | null
          return_time: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rideshare_history_status: string | null
          score: number | null
          scored_at: string | null
          sms_consent: boolean | null
          sms_consent_at: string | null
          sms_consent_page: string | null
          sms_consent_phone: string | null
          sms_consent_source: string | null
          sms_consent_text: string | null
          sms_consent_version: string | null
          sms_opt_out_at: string | null
          source: string | null
          start_date: string | null
          start_timing: string | null
          state: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          trip_screenshots: string[] | null
          trips_completed: string | null
          updated_at: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          vehicle_id: string | null
          vehicle_size: string | null
          waitlist_signed_up_at: string | null
          waitlist_source: string | null
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
          background_check_status?: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string | null
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string | null
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string | null
          email?: string | null
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name?: string | null
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string | null
          incident_count?: number | null
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string | null
          landing_page?: string | null
          legal_hold?: boolean | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          phone?: string | null
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
          requested_docs?: Json | null
          resubmission_count?: number | null
          resubmission_history?: Json | null
          return_date?: string | null
          return_time?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rideshare_history_status?: string | null
          score?: number | null
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          trip_screenshots?: string[] | null
          trips_completed?: string | null
          updated_at?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
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
          background_check_status?: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string | null
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string | null
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string | null
          email?: string | null
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name?: string | null
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string | null
          incident_count?: number | null
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string | null
          landing_page?: string | null
          legal_hold?: boolean | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          phone?: string | null
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
          requested_docs?: Json | null
          resubmission_count?: number | null
          resubmission_history?: Json | null
          return_date?: string | null
          return_time?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rideshare_history_status?: string | null
          score?: number | null
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          trip_screenshots?: string[] | null
          trips_completed?: string | null
          updated_at?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
          weekly_hours?: number | null
          weekly_rent?: number | null
          years_licensed?: number | null
          zip?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_contact_leads: {
        Row: {
          created_at: string | null
          email: string | null
          id: string | null
          message: string | null
          name: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          message?: string | null
          name?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          message?: string | null
          name?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_driver_addresses: {
        Row: {
          application_id: string | null
          city: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          is_primary: boolean | null
          label: string | null
          line1: string | null
          line2: string | null
          source: string | null
          state: string | null
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          application_id?: string | null
          city?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          is_primary?: boolean | null
          label?: string | null
          line1?: string | null
          line2?: string | null
          source?: string | null
          state?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          application_id?: string | null
          city?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          is_primary?: boolean | null
          label?: string | null
          line1?: string | null
          line2?: string | null
          source?: string | null
          state?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_driver_contacts: {
        Row: {
          application_id: string | null
          consented_at: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          is_primary: boolean | null
          kind: string | null
          label: string | null
          receives_messages: boolean | null
          updated_at: string | null
          value: string | null
        }
        Insert: {
          application_id?: string | null
          consented_at?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          is_primary?: boolean | null
          kind?: string | null
          label?: string | null
          receives_messages?: boolean | null
          updated_at?: string | null
          value?: string | null
        }
        Update: {
          application_id?: string | null
          consented_at?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          is_primary?: boolean | null
          kind?: string | null
          label?: string | null
          receives_messages?: boolean | null
          updated_at?: string | null
          value?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_enrich_fleet_review_decisions: {
        Row: {
          application_id: string | null
          assessment: Json | null
          created_at: string | null
          decided_by: string | null
          decision: string | null
          escalation_codes: string[] | null
          id: string | null
          idempotency_key: string | null
          reason: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          application_id?: string | null
          assessment?: Json | null
          created_at?: string | null
          decided_by?: string | null
          decision?: string | null
          escalation_codes?: string[] | null
          id?: string | null
          idempotency_key?: string | null
          reason?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          application_id?: string | null
          assessment?: Json | null
          created_at?: string | null
          decided_by?: string | null
          decision?: string | null
          escalation_codes?: string[] | null
          id?: string | null
          idempotency_key?: string | null
          reason?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_enrich_identifiers: {
        Row: {
          blacklist_id: string | null
          id: string | null
          kind: string | null
          value_norm: string | null
        }
        Insert: {
          blacklist_id?: string | null
          id?: string | null
          kind?: string | null
          value_norm?: string | null
        }
        Update: {
          blacklist_id?: string | null
          id?: string | null
          kind?: string | null
          value_norm?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_enrich_matches: {
        Row: {
          blacklist_id: string | null
          clear_note: string | null
          cleared_at: string | null
          cleared_by: string | null
          cleared_by_label: string | null
          created_at: string | null
          id: string | null
          matched_kinds: string[] | null
          matched_name: string | null
          source_id: string | null
          source_table: string | null
          updated_at: string | null
        }
        Insert: {
          blacklist_id?: string | null
          clear_note?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_by_label?: string | null
          created_at?: string | null
          id?: string | null
          matched_kinds?: string[] | null
          matched_name?: string | null
          source_id?: string | null
          source_table?: string | null
          updated_at?: string | null
        }
        Update: {
          blacklist_id?: string | null
          clear_note?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_by_label?: string | null
          created_at?: string | null
          id?: string | null
          matched_kinds?: string[] | null
          matched_name?: string | null
          source_id?: string | null
          source_table?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_enrich_waitlist: {
        Row: {
          city: string | null
          created_at: string | null
          driver_status: string | null
          email: string | null
          full_name: string | null
          gclid: string | null
          id: string | null
          market_id: string | null
          notified_at: string | null
          phone: string | null
          pickup_date: string | null
          promoted_application_id: string | null
          promoted_at: string | null
          review_flagged_at: string | null
          review_reason: string | null
          sms_consent: boolean | null
          sms_consent_at: string | null
          sms_consent_page: string | null
          sms_consent_phone: string | null
          sms_consent_source: string | null
          sms_consent_text: string | null
          sms_consent_version: string | null
          source: string | null
          state: string | null
          status: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          driver_status?: string | null
          email?: string | null
          full_name?: string | null
          gclid?: string | null
          id?: string | null
          market_id?: string | null
          notified_at?: string | null
          phone?: string | null
          pickup_date?: string | null
          promoted_application_id?: string | null
          promoted_at?: string | null
          review_flagged_at?: string | null
          review_reason?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string | null
          driver_status?: string | null
          email?: string | null
          full_name?: string | null
          gclid?: string | null
          id?: string | null
          market_id?: string | null
          notified_at?: string | null
          phone?: string | null
          pickup_date?: string | null
          promoted_application_id?: string | null
          promoted_at?: string | null
          review_flagged_at?: string | null
          review_reason?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_fleet_review_decisions: {
        Row: {
          application_id: string | null
          assessment: Json | null
          created_at: string | null
          decided_by: string | null
          decision: string | null
          escalation_codes: string[] | null
          id: string | null
          idempotency_key: string | null
          reason: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          application_id?: string | null
          assessment?: Json | null
          created_at?: string | null
          decided_by?: string | null
          decision?: string | null
          escalation_codes?: string[] | null
          id?: string | null
          idempotency_key?: string | null
          reason?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          application_id?: string | null
          assessment?: Json | null
          created_at?: string | null
          decided_by?: string | null
          decision?: string | null
          escalation_codes?: string[] | null
          id?: string | null
          idempotency_key?: string | null
          reason?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_payments: {
        Row: {
          amount: number | null
          attempt_count: number | null
          balance_due: number | null
          created_at: string | null
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string | null
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number | null
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          rental_id: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          type: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean | null
          balance_due_cents: number | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_held: boolean | null
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string | null
          driver_id: string | null
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          hold_by: string | null
          hold_reason: string | null
          hold_started_at: string | null
          id: string | null
          next_payment_due: string | null
          payment_status: string | null
          pickup_reading_id: string | null
          reservation_deposit_amount: number | null
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean | null
          reservation_deposit_status: string | null
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          weekly_rate: number | null
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_renter_blacklist: {
        Row: {
          added_by: string | null
          added_by_label: string | null
          application_id: string | null
          blacklisted_on: string | null
          created_at: string | null
          full_name: string | null
          id: string | null
          note: string | null
          reason_code: string | null
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          removed_by_label: string | null
        }
        Insert: {
          added_by?: string | null
          added_by_label?: string | null
          application_id?: string | null
          blacklisted_on?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          note?: string | null
          reason_code?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_by_label?: string | null
        }
        Update: {
          added_by?: string | null
          added_by_label?: string | null
          application_id?: string | null
          blacklisted_on?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          note?: string | null
          reason_code?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_by_label?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_renter_blacklist_clearances: {
        Row: {
          application_id: string | null
          blacklist_id: string | null
          cleared_by: string | null
          cleared_by_label: string | null
          created_at: string | null
          id: string | null
          note: string | null
        }
        Insert: {
          application_id?: string | null
          blacklist_id?: string | null
          cleared_by?: string | null
          cleared_by_label?: string | null
          created_at?: string | null
          id?: string | null
          note?: string | null
        }
        Update: {
          application_id?: string | null
          blacklist_id?: string | null
          cleared_by?: string | null
          cleared_by_label?: string | null
          created_at?: string | null
          id?: string | null
          note?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_renter_blacklist_identifiers: {
        Row: {
          blacklist_id: string | null
          id: string | null
          kind: string | null
          value_norm: string | null
        }
        Insert: {
          blacklist_id?: string | null
          id?: string | null
          kind?: string | null
          value_norm?: string | null
        }
        Update: {
          blacklist_id?: string | null
          id?: string | null
          kind?: string | null
          value_norm?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_renter_blacklist_matches: {
        Row: {
          blacklist_id: string | null
          clear_note: string | null
          cleared_at: string | null
          cleared_by: string | null
          cleared_by_label: string | null
          created_at: string | null
          id: string | null
          matched_kinds: string[] | null
          matched_name: string | null
          source_id: string | null
          source_table: string | null
          updated_at: string | null
        }
        Insert: {
          blacklist_id?: string | null
          clear_note?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_by_label?: string | null
          created_at?: string | null
          id?: string | null
          matched_kinds?: string[] | null
          matched_name?: string | null
          source_id?: string | null
          source_table?: string | null
          updated_at?: string | null
        }
        Update: {
          blacklist_id?: string | null
          clear_note?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_by_label?: string | null
          created_at?: string | null
          id?: string | null
          matched_kinds?: string[] | null
          matched_name?: string | null
          source_id?: string | null
          source_table?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_20261120_blacklist_waitlist: {
        Row: {
          city: string | null
          created_at: string | null
          driver_status: string | null
          email: string | null
          full_name: string | null
          gclid: string | null
          id: string | null
          market_id: string | null
          notified_at: string | null
          phone: string | null
          pickup_date: string | null
          promoted_application_id: string | null
          promoted_at: string | null
          review_flagged_at: string | null
          review_reason: string | null
          sms_consent: boolean | null
          sms_consent_at: string | null
          sms_consent_page: string | null
          sms_consent_phone: string | null
          sms_consent_source: string | null
          sms_consent_text: string | null
          sms_consent_version: string | null
          source: string | null
          state: string | null
          status: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          driver_status?: string | null
          email?: string | null
          full_name?: string | null
          gclid?: string | null
          id?: string | null
          market_id?: string | null
          notified_at?: string | null
          phone?: string | null
          pickup_date?: string | null
          promoted_application_id?: string | null
          promoted_at?: string | null
          review_flagged_at?: string | null
          review_reason?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string | null
          driver_status?: string | null
          email?: string | null
          full_name?: string | null
          gclid?: string | null
          id?: string | null
          market_id?: string | null
          notified_at?: string | null
          phone?: string | null
          pickup_date?: string | null
          promoted_application_id?: string | null
          promoted_at?: string | null
          review_flagged_at?: string | null
          review_reason?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      _backup_20261120_insdocs_vehicle_expenses: {
        Row: {
          amount: number | null
          category: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string | null
          incurred_on: string | null
          is_recurring: boolean | null
          maintenance_record_id: string | null
          notes: string | null
          payment_method: string | null
          receipt_mime: string | null
          receipt_name: string | null
          receipt_path: string | null
          reference: string | null
          rental_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          vendor_id: string | null
        }
        Insert: {
          amount?: number | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          incurred_on?: string | null
          is_recurring?: boolean | null
          maintenance_record_id?: string | null
          notes?: string | null
          payment_method?: string | null
          receipt_mime?: string | null
          receipt_name?: string | null
          receipt_path?: string | null
          reference?: string | null
          rental_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          vendor_id?: string | null
        }
        Update: {
          amount?: number | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          incurred_on?: string | null
          is_recurring?: boolean | null
          maintenance_record_id?: string | null
          notes?: string | null
          payment_method?: string | null
          receipt_mime?: string | null
          receipt_name?: string | null
          receipt_path?: string | null
          reference?: string | null
          rental_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          vendor_id?: string | null
        }
        Relationships: []
      }
      _backup_20261120_virginia_income_docs: {
        Row: {
          category: string | null
          content_sha256: string | null
          created_at: string | null
          driver_id: string | null
          evidence_class: string | null
          expires_at: string | null
          file_name: string | null
          id: string | null
          is_current: boolean | null
          kind: string | null
          label: string | null
          mime_type: string | null
          notes: string | null
          page_count: number | null
          partner_id: string | null
          review_note: string | null
          review_status: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          size_bytes: number | null
          source: string | null
          storage_bucket: string | null
          storage_path: string | null
          superseded_by: string | null
          updated_at: string | null
          uploaded_by: string | null
          uploaded_by_role: string | null
          vehicle_id: string | null
          visibility: string[] | null
        }
        Insert: {
          category?: string | null
          content_sha256?: string | null
          created_at?: string | null
          driver_id?: string | null
          evidence_class?: string | null
          expires_at?: string | null
          file_name?: string | null
          id?: string | null
          is_current?: boolean | null
          kind?: string | null
          label?: string | null
          mime_type?: string | null
          notes?: string | null
          page_count?: number | null
          partner_id?: string | null
          review_note?: string | null
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number | null
          source?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          superseded_by?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
          uploaded_by_role?: string | null
          vehicle_id?: string | null
          visibility?: string[] | null
        }
        Update: {
          category?: string | null
          content_sha256?: string | null
          created_at?: string | null
          driver_id?: string | null
          evidence_class?: string | null
          expires_at?: string | null
          file_name?: string | null
          id?: string | null
          is_current?: boolean | null
          kind?: string | null
          label?: string | null
          mime_type?: string | null
          notes?: string | null
          page_count?: number | null
          partner_id?: string | null
          review_note?: string | null
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number | null
          source?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          superseded_by?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
          uploaded_by_role?: string | null
          vehicle_id?: string | null
          visibility?: string[] | null
        }
        Relationships: []
      }
      _backup_20261121_damayia_decline: {
        Row: {
          address: string | null
          ai_flags: Json | null
          ai_score: number | null
          ai_summary: string | null
          ai_tier: string | null
          backed_up_at: string | null
          background_check_status: string | null
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
          contact_follow_up_on: string | null
          contact_status: string | null
          contact_status_at: string | null
          contact_status_by: string | null
          contact_status_note: string | null
          contacted_at: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string | null
          current_step: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          deposit_amount: number | null
          deposit_paid: number | null
          deposit_status: string | null
          dob: string | null
          doc_request_note: string | null
          doc_request_sent_at: string | null
          drive_type: string | null
          earnings_verified_status: string | null
          email: string | null
          expected_duration: string | null
          full_coverage_insurance: boolean | null
          full_name: string | null
          gclid: string | null
          gig_status: string | null
          how_heard: string | null
          id: string | null
          incident_count: number | null
          income_proof_url: string | null
          insurance_answer: string | null
          insurance_carrier: string | null
          insurance_doc_url: string | null
          insurance_expires_on: string | null
          insurance_policy_number: string | null
          insurance_rideshare_endorsement: boolean | null
          insurance_status: string | null
          landing_page: string | null
          legal_hold: boolean | null
          license_expiration: string | null
          license_number: string | null
          license_photo_url: string | null
          license_state: string | null
          license_valid: boolean | null
          market_id: string | null
          mvr_status: string | null
          notes: string | null
          payment_method: string | null
          payment_status: string | null
          phone: string | null
          pickup_date: string | null
          pickup_time: string | null
          platform_active: boolean | null
          platform_status: string | null
          platforms: string[] | null
          primary_application_id: string | null
          profile_screenshot_url: string | null
          purged_at: string | null
          rating: number | null
          recovery_email_sent_24h: string | null
          recovery_email_sent_72h: string | null
          recovery_sent_at: string | null
          referrer: string | null
          rental_duration: string | null
          rental_duration_days: number | null
          rental_length: string | null
          rental_term: string | null
          renter_policy_status: string | null
          requested_docs: Json | null
          resubmission_count: number | null
          resubmission_history: Json | null
          return_date: string | null
          return_time: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rideshare_history_status: string | null
          score: number | null
          scored_at: string | null
          sms_consent: boolean | null
          sms_consent_at: string | null
          sms_consent_page: string | null
          sms_consent_phone: string | null
          sms_consent_source: string | null
          sms_consent_text: string | null
          sms_consent_version: string | null
          sms_opt_out_at: string | null
          source: string | null
          start_date: string | null
          start_timing: string | null
          state: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          trip_screenshots: string[] | null
          trips_completed: string | null
          updated_at: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          vehicle_id: string | null
          vehicle_size: string | null
          waitlist_signed_up_at: string | null
          waitlist_source: string | null
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
          backed_up_at?: string | null
          background_check_status?: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string | null
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string | null
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string | null
          email?: string | null
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name?: string | null
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string | null
          incident_count?: number | null
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string | null
          landing_page?: string | null
          legal_hold?: boolean | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          phone?: string | null
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
          requested_docs?: Json | null
          resubmission_count?: number | null
          resubmission_history?: Json | null
          return_date?: string | null
          return_time?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rideshare_history_status?: string | null
          score?: number | null
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          trip_screenshots?: string[] | null
          trips_completed?: string | null
          updated_at?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
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
          backed_up_at?: string | null
          background_check_status?: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string | null
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string | null
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string | null
          email?: string | null
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name?: string | null
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string | null
          incident_count?: number | null
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string | null
          landing_page?: string | null
          legal_hold?: boolean | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          phone?: string | null
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
          requested_docs?: Json | null
          resubmission_count?: number | null
          resubmission_history?: Json | null
          return_date?: string | null
          return_time?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rideshare_history_status?: string | null
          score?: number | null
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          trip_screenshots?: string[] | null
          trips_completed?: string | null
          updated_at?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
          weekly_hours?: number | null
          weekly_rent?: number | null
          years_licensed?: number | null
          zip?: string | null
        }
        Relationships: []
      }
      _backup_20261121_regina_app_settings: {
        Row: {
          key: string | null
          updated_at: string | null
          value: Json | null
        }
        Insert: {
          key?: string | null
          updated_at?: string | null
          value?: Json | null
        }
        Update: {
          key?: string | null
          updated_at?: string | null
          value?: Json | null
        }
        Relationships: []
      }
      _backup_20261121_regina_payments: {
        Row: {
          amount: number | null
          attempt_count: number | null
          balance_due: number | null
          created_at: string | null
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string | null
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number | null
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          rental_id: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          type: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      _backup_20261121_regina_rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean | null
          balance_due_cents: number | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_held: boolean | null
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string | null
          driver_id: string | null
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          hold_by: string | null
          hold_reason: string | null
          hold_started_at: string | null
          id: string | null
          next_payment_due: string | null
          payment_status: string | null
          pickup_reading_id: string | null
          reservation_deposit_amount: number | null
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean | null
          reservation_deposit_status: string | null
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          weekly_rate: number | null
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261122_applications_test_invalid: {
        Row: {
          address: string | null
          ai_flags: Json | null
          ai_score: number | null
          ai_summary: string | null
          ai_tier: string | null
          background_check_status: string | null
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
          contact_follow_up_on: string | null
          contact_status: string | null
          contact_status_at: string | null
          contact_status_by: string | null
          contact_status_note: string | null
          contacted_at: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string | null
          current_step: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          deposit_amount: number | null
          deposit_paid: number | null
          deposit_status: string | null
          dob: string | null
          doc_request_note: string | null
          doc_request_sent_at: string | null
          drive_type: string | null
          earnings_verified_status: string | null
          email: string | null
          expected_duration: string | null
          full_coverage_insurance: boolean | null
          full_name: string | null
          gclid: string | null
          gig_status: string | null
          how_heard: string | null
          id: string | null
          incident_count: number | null
          income_proof_url: string | null
          insurance_answer: string | null
          insurance_carrier: string | null
          insurance_doc_url: string | null
          insurance_expires_on: string | null
          insurance_policy_number: string | null
          insurance_rideshare_endorsement: boolean | null
          insurance_status: string | null
          landing_page: string | null
          legal_hold: boolean | null
          license_expiration: string | null
          license_number: string | null
          license_photo_url: string | null
          license_state: string | null
          license_valid: boolean | null
          market_id: string | null
          mvr_status: string | null
          notes: string | null
          payment_method: string | null
          payment_status: string | null
          phone: string | null
          pickup_date: string | null
          pickup_time: string | null
          platform_active: boolean | null
          platform_status: string | null
          platforms: string[] | null
          primary_application_id: string | null
          profile_screenshot_url: string | null
          purged_at: string | null
          rating: number | null
          recovery_email_sent_24h: string | null
          recovery_email_sent_72h: string | null
          recovery_sent_at: string | null
          referrer: string | null
          rental_duration: string | null
          rental_duration_days: number | null
          rental_length: string | null
          rental_term: string | null
          renter_policy_status: string | null
          requested_docs: Json | null
          resubmission_count: number | null
          resubmission_history: Json | null
          return_date: string | null
          return_time: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rideshare_history_status: string | null
          score: number | null
          scored_at: string | null
          sms_consent: boolean | null
          sms_consent_at: string | null
          sms_consent_page: string | null
          sms_consent_phone: string | null
          sms_consent_source: string | null
          sms_consent_text: string | null
          sms_consent_version: string | null
          sms_opt_out_at: string | null
          source: string | null
          start_date: string | null
          start_timing: string | null
          state: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          trip_screenshots: string[] | null
          trips_completed: string | null
          updated_at: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          vehicle_id: string | null
          vehicle_size: string | null
          waitlist_signed_up_at: string | null
          waitlist_source: string | null
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
          background_check_status?: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string | null
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string | null
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string | null
          email?: string | null
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name?: string | null
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string | null
          incident_count?: number | null
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string | null
          landing_page?: string | null
          legal_hold?: boolean | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          phone?: string | null
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
          requested_docs?: Json | null
          resubmission_count?: number | null
          resubmission_history?: Json | null
          return_date?: string | null
          return_time?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rideshare_history_status?: string | null
          score?: number | null
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          trip_screenshots?: string[] | null
          trips_completed?: string | null
          updated_at?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
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
          background_check_status?: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string | null
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string | null
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string | null
          email?: string | null
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name?: string | null
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string | null
          incident_count?: number | null
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string | null
          landing_page?: string | null
          legal_hold?: boolean | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          phone?: string | null
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
          requested_docs?: Json | null
          resubmission_count?: number | null
          resubmission_history?: Json | null
          return_date?: string | null
          return_time?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rideshare_history_status?: string | null
          score?: number | null
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          trip_screenshots?: string[] | null
          trips_completed?: string | null
          updated_at?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
          weekly_hours?: number | null
          weekly_rent?: number | null
          years_licensed?: number | null
          zip?: string | null
        }
        Relationships: []
      }
      _backup_20261122_collections_rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean | null
          balance_due_cents: number | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_held: boolean | null
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string | null
          driver_id: string | null
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          hold_by: string | null
          hold_reason: string | null
          hold_started_at: string | null
          id: string | null
          next_payment_due: string | null
          payment_status: string | null
          pickup_reading_id: string | null
          reservation_deposit_amount: number | null
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean | null
          reservation_deposit_status: string | null
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          weekly_rate: number | null
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261122_damon_merge_payments: {
        Row: {
          amount: number | null
          attempt_count: number | null
          balance_due: number | null
          created_at: string | null
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string | null
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number | null
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          rental_id: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          type: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      _backup_20261122_damon_pay_payments: {
        Row: {
          amount: number | null
          attempt_count: number | null
          balance_due: number | null
          created_at: string | null
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string | null
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number | null
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          rental_id: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          type: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      _backup_20261122_damon_pay_rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean | null
          balance_due_cents: number | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_held: boolean | null
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string | null
          driver_id: string | null
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          hold_by: string | null
          hold_reason: string | null
          hold_started_at: string | null
          id: string | null
          next_payment_due: string | null
          payment_status: string | null
          pickup_reading_id: string | null
          reservation_deposit_amount: number | null
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean | null
          reservation_deposit_status: string | null
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          weekly_rate: number | null
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261122_damon_waive_payments: {
        Row: {
          amount: number | null
          attempt_count: number | null
          balance_due: number | null
          created_at: string | null
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string | null
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number | null
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          rental_id: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          type: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      _backup_20261122_damon_waive_rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean | null
          balance_due_cents: number | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_held: boolean | null
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string | null
          driver_id: string | null
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          hold_by: string | null
          hold_reason: string | null
          hold_started_at: string | null
          id: string | null
          next_payment_due: string | null
          payment_status: string | null
          pickup_reading_id: string | null
          reservation_deposit_amount: number | null
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean | null
          reservation_deposit_status: string | null
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          weekly_rate: number | null
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261122_damon_waive_waivers: {
        Row: {
          amount_waived: number | null
          created_at: string | null
          due_date: string | null
          id: string | null
          reason: string | null
          rental_id: string | null
          updated_at: string | null
          waived_by: string | null
          waived_by_email: string | null
          waived_through: string | null
        }
        Insert: {
          amount_waived?: number | null
          created_at?: string | null
          due_date?: string | null
          id?: string | null
          reason?: string | null
          rental_id?: string | null
          updated_at?: string | null
          waived_by?: string | null
          waived_by_email?: string | null
          waived_through?: string | null
        }
        Update: {
          amount_waived?: number | null
          created_at?: string | null
          due_date?: string | null
          id?: string | null
          reason?: string | null
          rental_id?: string | null
          updated_at?: string | null
          waived_by?: string | null
          waived_by_email?: string | null
          waived_through?: string | null
        }
        Relationships: []
      }
      _backup_20261122_email_deliveries_defs: {
        Row: {
          definition: string | null
          kind: string | null
          name: string | null
          taken_at: string | null
        }
        Insert: {
          definition?: string | null
          kind?: string | null
          name?: string | null
          taken_at?: string | null
        }
        Update: {
          definition?: string | null
          kind?: string | null
          name?: string | null
          taken_at?: string | null
        }
        Relationships: []
      }
      _backup_20261122_email_deliveries_leadalert_cleanup: {
        Row: {
          accepted_at: string | null
          bounced_at: string | null
          complained_at: string | null
          created_at: string | null
          delivered_at: string | null
          failed_at: string | null
          id: string | null
          provider_reason: string | null
          recipient: string | null
          resend_message_id: string | null
          state: string | null
          updated_at: string | null
          workflow: string | null
        }
        Insert: {
          accepted_at?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          failed_at?: string | null
          id?: string | null
          provider_reason?: string | null
          recipient?: string | null
          resend_message_id?: string | null
          state?: string | null
          updated_at?: string | null
          workflow?: string | null
        }
        Update: {
          accepted_at?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          failed_at?: string | null
          id?: string | null
          provider_reason?: string | null
          recipient?: string | null
          resend_message_id?: string | null
          state?: string | null
          updated_at?: string | null
          workflow?: string | null
        }
        Relationships: []
      }
      _backup_20261122_james_swap_agreements: {
        Row: {
          application_id: string | null
          archive_attempts: number | null
          archive_error: string | null
          archive_last_attempt_at: string | null
          archive_status: string | null
          auth_method: string | null
          body: string | null
          body_sha256: string | null
          company_signer_name: string | null
          company_signer_title: string | null
          completed_at: string | null
          completed_document_id: string | null
          created_at: string | null
          created_by: string | null
          document_id: string | null
          email_attempted_at: string | null
          email_error: string | null
          email_status: string | null
          expires_at: string | null
          id: string | null
          merge_data: Json | null
          metadata: Json | null
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
          sms_status: string | null
          source: string | null
          status: string | null
          template_id: string | null
          title: string | null
          token_expires_at: string | null
          token_hash: string | null
          updated_at: string | null
          vehicle_id: string | null
          viewed_at: string | null
          voided_at: string | null
        }
        Insert: {
          application_id?: string | null
          archive_attempts?: number | null
          archive_error?: string | null
          archive_last_attempt_at?: string | null
          archive_status?: string | null
          auth_method?: string | null
          body?: string | null
          body_sha256?: string | null
          company_signer_name?: string | null
          company_signer_title?: string | null
          completed_at?: string | null
          completed_document_id?: string | null
          created_at?: string | null
          created_by?: string | null
          document_id?: string | null
          email_attempted_at?: string | null
          email_error?: string | null
          email_status?: string | null
          expires_at?: string | null
          id?: string | null
          merge_data?: Json | null
          metadata?: Json | null
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
          sms_status?: string | null
          source?: string | null
          status?: string | null
          template_id?: string | null
          title?: string | null
          token_expires_at?: string | null
          token_hash?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          viewed_at?: string | null
          voided_at?: string | null
        }
        Update: {
          application_id?: string | null
          archive_attempts?: number | null
          archive_error?: string | null
          archive_last_attempt_at?: string | null
          archive_status?: string | null
          auth_method?: string | null
          body?: string | null
          body_sha256?: string | null
          company_signer_name?: string | null
          company_signer_title?: string | null
          completed_at?: string | null
          completed_document_id?: string | null
          created_at?: string | null
          created_by?: string | null
          document_id?: string | null
          email_attempted_at?: string | null
          email_error?: string | null
          email_status?: string | null
          expires_at?: string | null
          id?: string | null
          merge_data?: Json | null
          metadata?: Json | null
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
          sms_status?: string | null
          source?: string | null
          status?: string | null
          template_id?: string | null
          title?: string | null
          token_expires_at?: string | null
          token_hash?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          viewed_at?: string | null
          voided_at?: string | null
        }
        Relationships: []
      }
      _backup_20261122_james_swap_applications: {
        Row: {
          address: string | null
          ai_flags: Json | null
          ai_score: number | null
          ai_summary: string | null
          ai_tier: string | null
          background_check_status: string | null
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
          contact_follow_up_on: string | null
          contact_status: string | null
          contact_status_at: string | null
          contact_status_by: string | null
          contact_status_note: string | null
          contacted_at: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string | null
          current_step: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          deposit_amount: number | null
          deposit_paid: number | null
          deposit_status: string | null
          dob: string | null
          doc_request_note: string | null
          doc_request_sent_at: string | null
          drive_type: string | null
          earnings_verified_status: string | null
          email: string | null
          expected_duration: string | null
          full_coverage_insurance: boolean | null
          full_name: string | null
          gclid: string | null
          gig_status: string | null
          how_heard: string | null
          id: string | null
          incident_count: number | null
          income_proof_url: string | null
          insurance_answer: string | null
          insurance_carrier: string | null
          insurance_doc_url: string | null
          insurance_expires_on: string | null
          insurance_policy_number: string | null
          insurance_rideshare_endorsement: boolean | null
          insurance_status: string | null
          landing_page: string | null
          legal_hold: boolean | null
          license_expiration: string | null
          license_number: string | null
          license_photo_url: string | null
          license_state: string | null
          license_valid: boolean | null
          market_id: string | null
          mvr_status: string | null
          notes: string | null
          payment_method: string | null
          payment_status: string | null
          phone: string | null
          pickup_date: string | null
          pickup_time: string | null
          platform_active: boolean | null
          platform_status: string | null
          platforms: string[] | null
          primary_application_id: string | null
          profile_screenshot_url: string | null
          purged_at: string | null
          rating: number | null
          recovery_email_sent_24h: string | null
          recovery_email_sent_72h: string | null
          recovery_sent_at: string | null
          referrer: string | null
          rental_duration: string | null
          rental_duration_days: number | null
          rental_length: string | null
          rental_term: string | null
          renter_policy_status: string | null
          requested_docs: Json | null
          resubmission_count: number | null
          resubmission_history: Json | null
          return_date: string | null
          return_time: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rideshare_history_status: string | null
          score: number | null
          scored_at: string | null
          sms_consent: boolean | null
          sms_consent_at: string | null
          sms_consent_page: string | null
          sms_consent_phone: string | null
          sms_consent_source: string | null
          sms_consent_text: string | null
          sms_consent_version: string | null
          sms_opt_out_at: string | null
          source: string | null
          start_date: string | null
          start_timing: string | null
          state: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          trip_screenshots: string[] | null
          trips_completed: string | null
          updated_at: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          vehicle_id: string | null
          vehicle_size: string | null
          waitlist_signed_up_at: string | null
          waitlist_source: string | null
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
          background_check_status?: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string | null
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string | null
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string | null
          email?: string | null
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name?: string | null
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string | null
          incident_count?: number | null
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string | null
          landing_page?: string | null
          legal_hold?: boolean | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          phone?: string | null
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
          requested_docs?: Json | null
          resubmission_count?: number | null
          resubmission_history?: Json | null
          return_date?: string | null
          return_time?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rideshare_history_status?: string | null
          score?: number | null
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          trip_screenshots?: string[] | null
          trips_completed?: string | null
          updated_at?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
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
          background_check_status?: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string | null
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: number | null
          deposit_status?: string | null
          dob?: string | null
          doc_request_note?: string | null
          doc_request_sent_at?: string | null
          drive_type?: string | null
          earnings_verified_status?: string | null
          email?: string | null
          expected_duration?: string | null
          full_coverage_insurance?: boolean | null
          full_name?: string | null
          gclid?: string | null
          gig_status?: string | null
          how_heard?: string | null
          id?: string | null
          incident_count?: number | null
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string | null
          landing_page?: string | null
          legal_hold?: boolean | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_url?: string | null
          license_state?: string | null
          license_valid?: boolean | null
          market_id?: string | null
          mvr_status?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          phone?: string | null
          pickup_date?: string | null
          pickup_time?: string | null
          platform_active?: boolean | null
          platform_status?: string | null
          platforms?: string[] | null
          primary_application_id?: string | null
          profile_screenshot_url?: string | null
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
          requested_docs?: Json | null
          resubmission_count?: number | null
          resubmission_history?: Json | null
          return_date?: string | null
          return_time?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rideshare_history_status?: string | null
          score?: number | null
          scored_at?: string | null
          sms_consent?: boolean | null
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
          sms_opt_out_at?: string | null
          source?: string | null
          start_date?: string | null
          start_timing?: string | null
          state?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          trip_screenshots?: string[] | null
          trips_completed?: string | null
          updated_at?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle_id?: string | null
          vehicle_size?: string | null
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
          weekly_hours?: number | null
          weekly_rent?: number | null
          years_licensed?: number | null
          zip?: string | null
        }
        Relationships: []
      }
      _backup_20261122_james_swap_payments: {
        Row: {
          amount: number | null
          attempt_count: number | null
          balance_due: number | null
          created_at: string | null
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string | null
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number | null
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          rental_id: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          type: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      _backup_20261122_james_swap_rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean | null
          balance_due_cents: number | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_held: boolean | null
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string | null
          driver_id: string | null
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          hold_by: string | null
          hold_reason: string | null
          hold_started_at: string | null
          id: string | null
          next_payment_due: string | null
          payment_status: string | null
          pickup_reading_id: string | null
          reservation_deposit_amount: number | null
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean | null
          reservation_deposit_status: string | null
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          weekly_rate: number | null
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261122_james_swap_swaps: {
        Row: {
          agreement_id: string | null
          application_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          from_vehicle_id: string | null
          from_vehicle_status: string | null
          id: string | null
          idempotency_key: string | null
          insurance_override_at: string | null
          insurance_override_by: string | null
          insurance_override_reason: string | null
          note: string | null
          pickup_fuel: string | null
          pickup_mileage: number | null
          pickup_reading_id: string | null
          previous_agreement_id: string | null
          previous_document_id: string | null
          reason: string | null
          reason_code: string | null
          rental_id: string | null
          replaced_pickup_reading_id: string | null
          requested_by: string | null
          requested_by_label: string | null
          return_fuel: string | null
          return_mileage: number | null
          return_reading_id: string | null
          signed_at: string | null
          status: string | null
          swap_number: number | null
          to_vehicle_id: string | null
          updated_at: string | null
          weekly_rate: number | null
        }
        Insert: {
          agreement_id?: string | null
          application_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          from_vehicle_id?: string | null
          from_vehicle_status?: string | null
          id?: string | null
          idempotency_key?: string | null
          insurance_override_at?: string | null
          insurance_override_by?: string | null
          insurance_override_reason?: string | null
          note?: string | null
          pickup_fuel?: string | null
          pickup_mileage?: number | null
          pickup_reading_id?: string | null
          previous_agreement_id?: string | null
          previous_document_id?: string | null
          reason?: string | null
          reason_code?: string | null
          rental_id?: string | null
          replaced_pickup_reading_id?: string | null
          requested_by?: string | null
          requested_by_label?: string | null
          return_fuel?: string | null
          return_mileage?: number | null
          return_reading_id?: string | null
          signed_at?: string | null
          status?: string | null
          swap_number?: number | null
          to_vehicle_id?: string | null
          updated_at?: string | null
          weekly_rate?: number | null
        }
        Update: {
          agreement_id?: string | null
          application_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          from_vehicle_id?: string | null
          from_vehicle_status?: string | null
          id?: string | null
          idempotency_key?: string | null
          insurance_override_at?: string | null
          insurance_override_by?: string | null
          insurance_override_reason?: string | null
          note?: string | null
          pickup_fuel?: string | null
          pickup_mileage?: number | null
          pickup_reading_id?: string | null
          previous_agreement_id?: string | null
          previous_document_id?: string | null
          reason?: string | null
          reason_code?: string | null
          rental_id?: string | null
          replaced_pickup_reading_id?: string | null
          requested_by?: string | null
          requested_by_label?: string | null
          return_fuel?: string | null
          return_mileage?: number | null
          return_reading_id?: string | null
          signed_at?: string | null
          status?: string | null
          swap_number?: number | null
          to_vehicle_id?: string | null
          updated_at?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261122_james_swap_vehicles: {
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
          fuel_type: string | null
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
          id: string | null
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
          make: string | null
          market_id: string | null
          miles_per_tank: number | null
          model: string | null
          monthly_rate: number | null
          mpg: number | null
          odometer_updated_at: string | null
          oil_interval_miles: number | null
          partner_id: string | null
          photos: string[] | null
          plate_expires_on: string | null
          plate_state: string | null
          registration_expires_on: string | null
          registration_number: string | null
          registration_state: string | null
          seats: number | null
          spare_key: boolean | null
          status: string | null
          title_number: string | null
          title_on_file: boolean | null
          title_status: string | null
          toll_account: string | null
          toll_transponder_id: string | null
          trim: string | null
          uber_eligibility: string[] | null
          unit_number: string | null
          vin: string | null
          weekly_rate: number | null
          year: number | null
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
          fuel_type?: string | null
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
          id?: string | null
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
          make?: string | null
          market_id?: string | null
          miles_per_tank?: number | null
          model?: string | null
          monthly_rate?: number | null
          mpg?: number | null
          odometer_updated_at?: string | null
          oil_interval_miles?: number | null
          partner_id?: string | null
          photos?: string[] | null
          plate_expires_on?: string | null
          plate_state?: string | null
          registration_expires_on?: string | null
          registration_number?: string | null
          registration_state?: string | null
          seats?: number | null
          spare_key?: boolean | null
          status?: string | null
          title_number?: string | null
          title_on_file?: boolean | null
          title_status?: string | null
          toll_account?: string | null
          toll_transponder_id?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          unit_number?: string | null
          vin?: string | null
          weekly_rate?: number | null
          year?: number | null
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
          fuel_type?: string | null
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
          id?: string | null
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
          make?: string | null
          market_id?: string | null
          miles_per_tank?: number | null
          model?: string | null
          monthly_rate?: number | null
          mpg?: number | null
          odometer_updated_at?: string | null
          oil_interval_miles?: number | null
          partner_id?: string | null
          photos?: string[] | null
          plate_expires_on?: string | null
          plate_state?: string | null
          registration_expires_on?: string | null
          registration_number?: string | null
          registration_state?: string | null
          seats?: number | null
          spare_key?: boolean | null
          status?: string | null
          title_number?: string | null
          title_on_file?: boolean | null
          title_status?: string | null
          toll_account?: string | null
          toll_transponder_id?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          unit_number?: string | null
          vin?: string | null
          weekly_rate?: number | null
          year?: number | null
        }
        Relationships: []
      }
      _backup_20261123_automation_controls: {
        Row: {
          key: string | null
          updated_at: string | null
          value: Json | null
        }
        Insert: {
          key?: string | null
          updated_at?: string | null
          value?: Json | null
        }
        Update: {
          key?: string | null
          updated_at?: string | null
          value?: Json | null
        }
        Relationships: []
      }
      _backup_20261123_maintenance_schedule_roll_next_fn: {
        Row: {
          backed_up_at: string | null
          definition: string | null
        }
        Insert: {
          backed_up_at?: string | null
          definition?: string | null
        }
        Update: {
          backed_up_at?: string | null
          definition?: string | null
        }
        Relationships: []
      }
      _backup_20261123_maintenance_schedules: {
        Row: {
          category: string | null
          created_at: string | null
          default_id: string | null
          id: string | null
          interval_days: number | null
          interval_miles: number | null
          is_active: boolean | null
          is_override: boolean | null
          item: string | null
          last_done_miles: number | null
          last_done_on: string | null
          next_due_miles: number | null
          next_due_on: string | null
          notes: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          default_id?: string | null
          id?: string | null
          interval_days?: number | null
          interval_miles?: number | null
          is_active?: boolean | null
          is_override?: boolean | null
          item?: string | null
          last_done_miles?: number | null
          last_done_on?: string | null
          next_due_miles?: number | null
          next_due_on?: string | null
          notes?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          default_id?: string | null
          id?: string | null
          interval_days?: number | null
          interval_miles?: number | null
          is_active?: boolean | null
          is_override?: boolean | null
          item?: string | null
          last_done_miles?: number | null
          last_done_on?: string | null
          next_due_miles?: number | null
          next_due_on?: string | null
          notes?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      _backup_20261123_regina_app_settings: {
        Row: {
          key: string | null
          updated_at: string | null
          value: Json | null
        }
        Insert: {
          key?: string | null
          updated_at?: string | null
          value?: Json | null
        }
        Update: {
          key?: string | null
          updated_at?: string | null
          value?: Json | null
        }
        Relationships: []
      }
      _backup_20261123_regina_autopay_rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean | null
          balance_due_cents: number | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          close_reason: string | null
          created_at: string | null
          days_late_at_repo: number | null
          deposit_amount: number | null
          deposit_held: boolean | null
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string | null
          driver_id: string | null
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          hold_by: string | null
          hold_reason: string | null
          hold_started_at: string | null
          id: string | null
          next_payment_due: string | null
          payment_status: string | null
          pickup_reading_id: string | null
          repossessed_on: string | null
          reservation_deposit_amount: number | null
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean | null
          reservation_deposit_status: string | null
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          weekly_rate: number | null
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          close_reason?: string | null
          created_at?: string | null
          days_late_at_repo?: number | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          repossessed_on?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          close_reason?: string | null
          created_at?: string | null
          days_late_at_repo?: number | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          repossessed_on?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261123_regina_enddate_rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean | null
          balance_due_cents: number | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          close_reason: string | null
          created_at: string | null
          days_late_at_repo: number | null
          deposit_amount: number | null
          deposit_held: boolean | null
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string | null
          driver_id: string | null
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          hold_by: string | null
          hold_reason: string | null
          hold_started_at: string | null
          id: string | null
          next_payment_due: string | null
          payment_status: string | null
          pickup_reading_id: string | null
          repossessed_on: string | null
          reservation_deposit_amount: number | null
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean | null
          reservation_deposit_status: string | null
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          weekly_rate: number | null
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          close_reason?: string | null
          created_at?: string | null
          days_late_at_repo?: number | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          repossessed_on?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean | null
          balance_due_cents?: number | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          close_reason?: string | null
          created_at?: string | null
          days_late_at_repo?: number | null
          deposit_amount?: number | null
          deposit_held?: boolean | null
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string | null
          driver_id?: string | null
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string | null
          next_payment_due?: string | null
          payment_status?: string | null
          pickup_reading_id?: string | null
          repossessed_on?: string | null
          reservation_deposit_amount?: number | null
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean | null
          reservation_deposit_status?: string | null
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      _backup_20261123_regina_payments: {
        Row: {
          amount: number | null
          attempt_count: number | null
          balance_due: number | null
          created_at: string | null
          driver_id: string | null
          due_date: string | null
          failure_reason: string | null
          id: string | null
          last_attempt_at: string | null
          late_fee_applied_through: string | null
          late_fees: number | null
          net_collected: number | null
          notes: string | null
          notified_status: string | null
          paid_date: string | null
          payment_method: string | null
          reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          rental_id: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          type: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number | null
          balance_due?: number | null
          created_at?: string | null
          driver_id?: string | null
          due_date?: string | null
          failure_reason?: string | null
          id?: string | null
          last_attempt_at?: string | null
          late_fee_applied_through?: string | null
          late_fees?: number | null
          net_collected?: number | null
          notes?: string | null
          notified_status?: string | null
          paid_date?: string | null
          payment_method?: string | null
          reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          rental_id?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
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
      agreement_terms_confirmations: {
        Row: {
          agreement_id: string | null
          agreement_sent_at: string | null
          application_id: string
          call_id: string | null
          channel: string
          confirmed_at: string
          created_at: string
          deposit: number
          id: string
          idempotency_key: string | null
          message_id: string | null
          recorded_by: string
          staff_event_id: string | null
          start_date: string
          summary: string
          vehicle_id: string
          vehicle_label: string | null
          weekly_rate: number
        }
        Insert: {
          agreement_id?: string | null
          agreement_sent_at?: string | null
          application_id: string
          call_id?: string | null
          channel: string
          confirmed_at: string
          created_at?: string
          deposit: number
          id?: string
          idempotency_key?: string | null
          message_id?: string | null
          recorded_by: string
          staff_event_id?: string | null
          start_date: string
          summary: string
          vehicle_id: string
          vehicle_label?: string | null
          weekly_rate: number
        }
        Update: {
          agreement_id?: string | null
          agreement_sent_at?: string | null
          application_id?: string
          call_id?: string | null
          channel?: string
          confirmed_at?: string
          created_at?: string
          deposit?: number
          id?: string
          idempotency_key?: string | null
          message_id?: string | null
          recorded_by?: string
          staff_event_id?: string | null
          start_date?: string
          summary?: string
          vehicle_id?: string
          vehicle_label?: string | null
          weekly_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "agreement_terms_confirmations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_terms_confirmations_staff_event_id_fkey"
            columns: ["staff_event_id"]
            isOneToOne: false
            referencedRelation: "staff_terms_confirmations"
            referencedColumns: ["id"]
          },
        ]
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
      applicant_autoclose: {
        Row: {
          application_id: string
          channels: string[]
          closed_at: string
          error: string | null
          id: string
          last_message_at: string | null
          prior_status: string
          reopened: boolean | null
          reopened_at: string | null
        }
        Insert: {
          application_id: string
          channels?: string[]
          closed_at?: string
          error?: string | null
          id?: string
          last_message_at?: string | null
          prior_status: string
          reopened?: boolean | null
          reopened_at?: string | null
        }
        Update: {
          application_id?: string
          channels?: string[]
          closed_at?: string
          error?: string | null
          id?: string
          last_message_at?: string | null
          prior_status?: string
          reopened?: boolean | null
          reopened_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applicant_autoclose_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applicant_outreach_log: {
        Row: {
          application_id: string
          channels: string[]
          created_at: string
          error: string | null
          id: string
          items: string[]
          missing_key: string
          source: string
          step: number
        }
        Insert: {
          application_id: string
          channels?: string[]
          created_at?: string
          error?: string | null
          id?: string
          items?: string[]
          missing_key: string
          source: string
          step: number
        }
        Update: {
          application_id?: string
          channels?: string[]
          created_at?: string
          error?: string | null
          id?: string
          items?: string[]
          missing_key?: string
          source?: string
          step?: number
        }
        Relationships: [
          {
            foreignKeyName: "applicant_outreach_log_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
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
      application_identity_reviews: {
        Row: {
          application_id: string
          created_at: string
          id: string
          kind: string
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          source: string | null
          status: string
          submitted_email: string | null
          submitted_full_name: string | null
          submitted_phone: string | null
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          kind: string
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source?: string | null
          status?: string
          submitted_email?: string | null
          submitted_full_name?: string | null
          submitted_phone?: string | null
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          kind?: string
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source?: string | null
          status?: string
          submitted_email?: string | null
          submitted_full_name?: string | null
          submitted_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_identity_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_recovery_attempts: {
        Row: {
          application_id: string
          created_at: string
          finished_at: string | null
          id: string
          provider_id: string | null
          status: string
          token_id: string | null
        }
        Insert: {
          application_id: string
          created_at?: string
          finished_at?: string | null
          id?: string
          provider_id?: string | null
          status?: string
          token_id?: string | null
        }
        Update: {
          application_id?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          provider_id?: string | null
          status?: string
          token_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_recovery_attempts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_recovery_attempts_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "application_resume_tokens"
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
      application_status_changes: {
        Row: {
          application_id: string
          changed_at: string
          from_status: string | null
          id: string
          to_status: string
        }
        Insert: {
          application_id: string
          changed_at?: string
          from_status?: string | null
          id?: string
          to_status: string
        }
        Update: {
          application_id?: string
          changed_at?: string
          from_status?: string | null
          id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_status_changes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_waitlist_holds: {
        Row: {
          added_at: string
          added_by: string
          application_id: string
          id: string
          removed_at: string | null
          removed_by: string | null
        }
        Insert: {
          added_at?: string
          added_by: string
          application_id: string
          id?: string
          removed_at?: string | null
          removed_by?: string | null
        }
        Update: {
          added_at?: string
          added_by?: string
          application_id?: string
          id?: string
          removed_at?: string | null
          removed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_waitlist_holds_application_id_fkey"
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
          contact_follow_up_on: string | null
          contact_status: string
          contact_status_at: string | null
          contact_status_by: string | null
          contact_status_note: string | null
          contacted_at: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string | null
          current_step: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
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
          income_proof_url: string | null
          insurance_answer: string | null
          insurance_carrier: string | null
          insurance_doc_url: string | null
          insurance_expires_on: string | null
          insurance_policy_number: string | null
          insurance_rideshare_endorsement: boolean | null
          insurance_status: string
          landing_page: string | null
          legal_hold: boolean
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
          purged_at: string | null
          rating: number | null
          recovery_email_sent_24h: string | null
          recovery_email_sent_72h: string | null
          recovery_sent_at: string | null
          referrer: string | null
          rental_duration: string | null
          rental_duration_days: number | null
          rental_length: string | null
          rental_term: string | null
          renter_policy_status: string | null
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
          sms_consent_at: string | null
          sms_consent_page: string | null
          sms_consent_phone: string | null
          sms_consent_source: string | null
          sms_consent_text: string | null
          sms_consent_version: string | null
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
          waitlist_signed_up_at: string | null
          waitlist_source: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
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
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string
          landing_page?: string | null
          legal_hold?: boolean
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
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
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
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
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
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
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
          contact_follow_up_on?: string | null
          contact_status?: string
          contact_status_at?: string | null
          contact_status_by?: string | null
          contact_status_note?: string | null
          contacted_at?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          current_step?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
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
          income_proof_url?: string | null
          insurance_answer?: string | null
          insurance_carrier?: string | null
          insurance_doc_url?: string | null
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_rideshare_endorsement?: boolean | null
          insurance_status?: string
          landing_page?: string | null
          legal_hold?: boolean
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
          purged_at?: string | null
          rating?: number | null
          recovery_email_sent_24h?: string | null
          recovery_email_sent_72h?: string | null
          recovery_sent_at?: string | null
          referrer?: string | null
          rental_duration?: string | null
          rental_duration_days?: number | null
          rental_length?: string | null
          rental_term?: string | null
          renter_policy_status?: string | null
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
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
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
          waitlist_signed_up_at?: string | null
          waitlist_source?: string | null
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
          body_not_driving: string | null
          channel: string
          created_at: string
          delay_minutes: number
          id: string
          is_active: boolean
          skip_when_profile_complete: boolean
          step_order: number
          subject: string | null
          subject_not_driving: string | null
          updated_at: string
          workflow_id: string
        }
        Insert: {
          body: string
          body_not_driving?: string | null
          channel?: string
          created_at?: string
          delay_minutes?: number
          id?: string
          is_active?: boolean
          skip_when_profile_complete?: boolean
          step_order?: number
          subject?: string | null
          subject_not_driving?: string | null
          updated_at?: string
          workflow_id: string
        }
        Update: {
          body?: string
          body_not_driving?: string | null
          channel?: string
          created_at?: string
          delay_minutes?: number
          id?: string
          is_active?: boolean
          skip_when_profile_complete?: boolean
          step_order?: number
          subject?: string | null
          subject_not_driving?: string | null
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
      background_report_documents: {
        Row: {
          added_at: string
          document_id: string
          report_id: string
        }
        Insert: {
          added_at?: string
          document_id: string
          report_id: string
        }
        Update: {
          added_at?: string
          document_id?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "background_report_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_report_documents_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "background_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      background_reports: {
        Row: {
          application_id: string
          checked_at: string | null
          created_at: string
          criminal_case_count: number | null
          criminal_cases: Json
          criminal_record: string | null
          id: string
          idempotency_key: string | null
          identity_result: string | null
          license_state: string | null
          license_status: string | null
          note: string | null
          order_key: string | null
          ordered_at: string | null
          products: string[]
          provider: string
          provider_name: string | null
          recorded_by: string | null
          recorded_by_label: string | null
          reference: string | null
          renter_name: string | null
          report_ref: string | null
          report_type: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          checked_at?: string | null
          created_at?: string
          criminal_case_count?: number | null
          criminal_cases?: Json
          criminal_record?: string | null
          id?: string
          idempotency_key?: string | null
          identity_result?: string | null
          license_state?: string | null
          license_status?: string | null
          note?: string | null
          order_key?: string | null
          ordered_at?: string | null
          products?: string[]
          provider: string
          provider_name?: string | null
          recorded_by?: string | null
          recorded_by_label?: string | null
          reference?: string | null
          renter_name?: string | null
          report_ref?: string | null
          report_type: string
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          checked_at?: string | null
          created_at?: string
          criminal_case_count?: number | null
          criminal_cases?: Json
          criminal_record?: string | null
          id?: string
          idempotency_key?: string | null
          identity_result?: string | null
          license_state?: string | null
          license_status?: string | null
          note?: string | null
          order_key?: string | null
          ordered_at?: string | null
          products?: string[]
          provider?: string
          provider_name?: string | null
          recorded_by?: string | null
          recorded_by_label?: string | null
          reference?: string | null
          renter_name?: string | null
          report_ref?: string | null
          report_type?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "background_reports_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_evidence_events: {
        Row: {
          actor_id: string
          actor_role: string
          application_id: string
          created_at: string
          field: string
          id: string
          idempotency_key: string
          note: string
          revision: number
          source: string | null
          state: string
          supersedes_id: string | null
        }
        Insert: {
          actor_id: string
          actor_role: string
          application_id: string
          created_at?: string
          field: string
          id?: string
          idempotency_key: string
          note?: string
          revision: number
          source?: string | null
          state: string
          supersedes_id?: string | null
        }
        Update: {
          actor_id?: string
          actor_role?: string
          application_id?: string
          created_at?: string
          field?: string
          id?: string
          idempotency_key?: string
          note?: string
          revision?: number
          source?: string | null
          state?: string
          supersedes_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_evidence_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_evidence_events_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "checklist_evidence_events"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_item_attachments: {
        Row: {
          created_at: string
          file_name: string | null
          id: string
          item_id: string
          mime_type: string | null
          storage_bucket: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          id?: string
          item_id: string
          mime_type?: string | null
          storage_bucket?: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string | null
          id?: string
          item_id?: string
          mime_type?: string | null
          storage_bucket?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_item_attachments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "collection_items"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_item_events: {
        Row: {
          actor_label: string | null
          actor_user_id: string | null
          amount: number | null
          created_at: string
          from_status: string | null
          id: string
          item_id: string
          kind: string
          note: string | null
          payment_id: string | null
          to_status: string | null
        }
        Insert: {
          actor_label?: string | null
          actor_user_id?: string | null
          amount?: number | null
          created_at?: string
          from_status?: string | null
          id?: string
          item_id: string
          kind: string
          note?: string | null
          payment_id?: string | null
          to_status?: string | null
        }
        Update: {
          actor_label?: string | null
          actor_user_id?: string | null
          amount?: number | null
          created_at?: string
          from_status?: string | null
          id?: string
          item_id?: string
          kind?: string
          note?: string | null
          payment_id?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_item_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "collection_items"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_items: {
        Row: {
          amount: number
          amount_paid: number
          application_id: string
          closed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          incurred_on: string | null
          notes: string | null
          original_amount: number | null
          proration: Json | null
          reason: string
          rental_id: string | null
          source_kind: string
          source_payment_id: string | null
          status: string
          stripe_invoice_id: string | null
          updated_at: string
          vehicle_id: string | null
          week_start: string | null
        }
        Insert: {
          amount: number
          amount_paid?: number
          application_id: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          incurred_on?: string | null
          notes?: string | null
          original_amount?: number | null
          proration?: Json | null
          reason: string
          rental_id?: string | null
          source_kind?: string
          source_payment_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
          week_start?: string | null
        }
        Update: {
          amount?: number
          amount_paid?: number
          application_id?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          incurred_on?: string | null
          notes?: string | null
          original_amount?: number | null
          proration?: Json | null
          reason?: string
          rental_id?: string | null
          source_kind?: string
          source_payment_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
          week_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_items_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_items_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_items_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_items_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_items_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_payment_allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          item_id: string
          payment_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          item_id: string
          payment_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          item_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_payment_allocations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "collection_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
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
          gps_lat: number | null
          gps_lng: number | null
          id: string
          incident_id: string | null
          inspection_id: string | null
          media_type: string
          mime_type: string | null
          phase: string
          rental_id: string | null
          share_path: string | null
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          taken_at: string | null
          taken_at_source: string | null
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
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          incident_id?: string | null
          inspection_id?: string | null
          media_type?: string
          mime_type?: string | null
          phase?: string
          rental_id?: string | null
          share_path?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path: string
          taken_at?: string | null
          taken_at_source?: string | null
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
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          incident_id?: string | null
          inspection_id?: string | null
          media_type?: string
          mime_type?: string | null
          phase?: string
          rental_id?: string | null
          share_path?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          taken_at?: string | null
          taken_at_source?: string | null
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
      deletion_events: {
        Row: {
          action: string
          actor: string | null
          application_id: string
          created_at: string
          details: Json
          id: string
        }
        Insert: {
          action: string
          actor?: string | null
          application_id: string
          created_at?: string
          details?: Json
          id?: string
        }
        Update: {
          action?: string
          actor?: string | null
          application_id?: string
          created_at?: string
          details?: Json
          id?: string
        }
        Relationships: []
      }
      deletion_file_jobs: {
        Row: {
          application_id: string
          attempts: number
          bucket: string
          created_at: string
          id: string
          last_error: string | null
          path: string
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          attempts?: number
          bucket: string
          created_at?: string
          id?: string
          last_error?: string | null
          path: string
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          attempts?: number
          bucket?: string
          created_at?: string
          id?: string
          last_error?: string | null
          path?: string
          status?: string
          updated_at?: string
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
          evidence_class: string
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
          evidence_class?: string
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
          evidence_class?: string
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
      driver_addresses: {
        Row: {
          application_id: string
          city: string | null
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
          label: string | null
          line1: string
          line2: string | null
          source: string
          state: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          application_id: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          line1?: string
          line2?: string | null
          source?: string
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          application_id?: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          line1?: string
          line2?: string | null
          source?: string
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_addresses_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_contacts: {
        Row: {
          application_id: string
          consented_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
          kind: string
          label: string | null
          receives_messages: boolean
          updated_at: string
          value: string
        }
        Insert: {
          application_id: string
          consented_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          kind: string
          label?: string | null
          receives_messages?: boolean
          updated_at?: string
          value: string
        }
        Update: {
          application_id?: string
          consented_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          kind?: string
          label?: string | null
          receives_messages?: boolean
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_contacts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
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
          meta: Json | null
          provider_reason: string | null
          recipient: string
          resend_message_id: string | null
          state: string
          subject: string | null
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
          meta?: Json | null
          provider_reason?: string | null
          recipient: string
          resend_message_id?: string | null
          state?: string
          subject?: string | null
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
          meta?: Json | null
          provider_reason?: string | null
          recipient?: string
          resend_message_id?: string | null
          state?: string
          subject?: string | null
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
          last_viewed_at: string | null
          link_channel: string | null
          link_email_status: string | null
          link_sms_status: string | null
          link_token: string | null
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
          last_viewed_at?: string | null
          link_channel?: string | null
          link_email_status?: string | null
          link_sms_status?: string | null
          link_token?: string | null
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
          last_viewed_at?: string | null
          link_channel?: string | null
          link_email_status?: string | null
          link_sms_status?: string | null
          link_token?: string | null
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
      financial_settlements: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          obligation_id: string
          payment_txn_id: string
          reverse_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          idempotency_key: string
          obligation_id: string
          payment_txn_id: string
          reverse_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          obligation_id?: string
          payment_txn_id?: string
          reverse_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_settlements_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "financial_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_settlements_payment_txn_id_fkey"
            columns: ["payment_txn_id"]
            isOneToOne: false
            referencedRelation: "financial_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_transaction_events: {
        Row: {
          actor: string | null
          after: Json | null
          before: Json | null
          created_at: string
          event: string
          from_status: string | null
          id: number
          reason: string | null
          to_status: string | null
          transaction_id: string
        }
        Insert: {
          actor?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          event: string
          from_status?: string | null
          id?: never
          reason?: string | null
          to_status?: string | null
          transaction_id: string
        }
        Update: {
          actor?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          event?: string
          from_status?: string | null
          id?: never
          reason?: string | null
          to_status?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_transaction_events_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "financial_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_transaction_evidence: {
        Row: {
          confidence: string | null
          created_at: string
          created_by: string | null
          document_id: string | null
          field: string | null
          id: string
          import_item_id: string | null
          page: number | null
          raw_text: string | null
          service_transaction_id: string | null
          transaction_id: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          field?: string | null
          id?: string
          import_item_id?: string | null
          page?: number | null
          raw_text?: string | null
          service_transaction_id?: string | null
          transaction_id: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          field?: string | null
          id?: string
          import_item_id?: string | null
          page?: number | null
          raw_text?: string | null
          service_transaction_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_transaction_evidence_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transaction_evidence_import_item_id_fkey"
            columns: ["import_item_id"]
            isOneToOne: false
            referencedRelation: "fleet_import_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transaction_evidence_service_transaction_id_fkey"
            columns: ["service_transaction_id"]
            isOneToOne: false
            referencedRelation: "fleet_service_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transaction_evidence_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "financial_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_transactions: {
        Row: {
          amount: number
          basis: string
          cash_date: string | null
          category: string
          close_reason: string | null
          closed_at: string | null
          closed_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          corrects_id: string | null
          created_at: string
          created_by: string
          currency: string
          deposit_source_id: string | null
          direction: string
          document_date: string | null
          due_date: string | null
          expense_id: string | null
          id: string
          idempotency_key: string
          interest_amount: number | null
          memo: string | null
          payee_raw: string | null
          payment_id: string | null
          payment_method: string | null
          posted_at: string | null
          posted_by: string | null
          recognition_date: string | null
          reference_norm: string | null
          reference_raw: string | null
          rental_id: string | null
          reverses_id: string | null
          sensitivity: string
          service_date: string | null
          source_type: string
          status: string
          txn_type: string
          updated_at: string
          vehicle_hint_id: string | null
          vendor_id: string | null
        }
        Insert: {
          amount: number
          basis: string
          cash_date?: string | null
          category: string
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          corrects_id?: string | null
          created_at?: string
          created_by: string
          currency?: string
          deposit_source_id?: string | null
          direction: string
          document_date?: string | null
          due_date?: string | null
          expense_id?: string | null
          id?: string
          idempotency_key: string
          interest_amount?: number | null
          memo?: string | null
          payee_raw?: string | null
          payment_id?: string | null
          payment_method?: string | null
          posted_at?: string | null
          posted_by?: string | null
          recognition_date?: string | null
          reference_norm?: string | null
          reference_raw?: string | null
          rental_id?: string | null
          reverses_id?: string | null
          sensitivity?: string
          service_date?: string | null
          source_type: string
          status?: string
          txn_type: string
          updated_at?: string
          vehicle_hint_id?: string | null
          vendor_id?: string | null
        }
        Update: {
          amount?: number
          basis?: string
          cash_date?: string | null
          category?: string
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          corrects_id?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          deposit_source_id?: string | null
          direction?: string
          document_date?: string | null
          due_date?: string | null
          expense_id?: string | null
          id?: string
          idempotency_key?: string
          interest_amount?: number | null
          memo?: string | null
          payee_raw?: string | null
          payment_id?: string | null
          payment_method?: string | null
          posted_at?: string | null
          posted_by?: string | null
          recognition_date?: string | null
          reference_norm?: string | null
          reference_raw?: string | null
          rental_id?: string | null
          reverses_id?: string | null
          sensitivity?: string
          service_date?: string | null
          source_type?: string
          status?: string
          txn_type?: string
          updated_at?: string
          vehicle_hint_id?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_transactions_corrects_id_fkey"
            columns: ["corrects_id"]
            isOneToOne: true
            referencedRelation: "financial_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_deposit_source_id_fkey"
            columns: ["deposit_source_id"]
            isOneToOne: false
            referencedRelation: "financial_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "vehicle_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: true
            referencedRelation: "financial_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_vehicle_hint_id_fkey"
            columns: ["vehicle_hint_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_vehicle_hint_id_fkey"
            columns: ["vehicle_hint_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          inbound_email_id: string | null
          label: string
          source_channel: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          inbound_email_id?: string | null
          label: string
          source_channel?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          inbound_email_id?: string | null
          label?: string
          source_channel?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_import_batches_inbound_email_id_fkey"
            columns: ["inbound_email_id"]
            isOneToOne: false
            referencedRelation: "inbound_emails"
            referencedColumns: ["id"]
          },
        ]
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
          inbound_email_id: string | null
          mime_type: string | null
          size_bytes: number | null
          source_attachment_id: string | null
          source_channel: string
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
          inbound_email_id?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          source_attachment_id?: string | null
          source_channel?: string
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
          inbound_email_id?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          source_attachment_id?: string | null
          source_channel?: string
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
          {
            foreignKeyName: "fleet_import_items_inbound_email_id_fkey"
            columns: ["inbound_email_id"]
            isOneToOne: false
            referencedRelation: "inbound_emails"
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
      fleet_inbox_jobs: {
        Row: {
          attempts: number
          batch_id: string
          created_at: string
          finished_at: string | null
          id: string
          item_id: string
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          max_attempts: number
          next_run_at: string
          source: string
          state: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          batch_id: string
          created_at?: string
          finished_at?: string | null
          id?: string
          item_id: string
          kind?: string
          last_error?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          next_run_at?: string
          source?: string
          state?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          batch_id?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          item_id?: string
          kind?: string
          last_error?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          next_run_at?: string
          source?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_inbox_jobs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "fleet_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_inbox_jobs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "fleet_import_items"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_inbox_worker_state: {
        Row: {
          id: number
          last_run_at: string | null
          last_run_summary: Json | null
          lease_until: string | null
          paused_at: string | null
          paused_reason: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          last_run_at?: string | null
          last_run_summary?: Json | null
          lease_until?: string | null
          paused_at?: string | null
          paused_reason?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          last_run_at?: string | null
          last_run_summary?: Json | null
          lease_until?: string | null
          paused_at?: string | null
          paused_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fleet_license_readings: {
        Row: {
          address_city: string | null
          address_line1: string | null
          address_state: string | null
          address_zip: string | null
          application_id: string
          applied_fields: string[]
          confidence: number | null
          conflicts: Json
          created_at: string
          dob: string | null
          document_id: string | null
          id: string
          idempotency_key: string | null
          license_expiration: string | null
          license_number: string | null
          license_state: string | null
          note: string | null
          read_by: string
          source_label: string
        }
        Insert: {
          address_city?: string | null
          address_line1?: string | null
          address_state?: string | null
          address_zip?: string | null
          application_id: string
          applied_fields?: string[]
          confidence?: number | null
          conflicts?: Json
          created_at?: string
          dob?: string | null
          document_id?: string | null
          id?: string
          idempotency_key?: string | null
          license_expiration?: string | null
          license_number?: string | null
          license_state?: string | null
          note?: string | null
          read_by?: string
          source_label?: string
        }
        Update: {
          address_city?: string | null
          address_line1?: string | null
          address_state?: string | null
          address_zip?: string | null
          application_id?: string
          applied_fields?: string[]
          confidence?: number | null
          conflicts?: Json
          created_at?: string
          dob?: string | null
          document_id?: string | null
          id?: string
          idempotency_key?: string | null
          license_expiration?: string | null
          license_number?: string | null
          license_state?: string | null
          note?: string | null
          read_by?: string
          source_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_license_readings_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_license_readings_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
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
      fleet_review_decisions: {
        Row: {
          application_id: string
          assessment: Json
          created_at: string
          decided_by: string
          decision: string
          escalation_codes: string[]
          id: string
          idempotency_key: string | null
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          application_id: string
          assessment?: Json
          created_at?: string
          decided_by?: string
          decision: string
          escalation_codes?: string[]
          id?: string
          idempotency_key?: string | null
          reason: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          application_id?: string
          assessment?: Json
          created_at?: string
          decided_by?: string
          decision?: string
          escalation_codes?: string[]
          id?: string
          idempotency_key?: string | null
          reason?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_review_decisions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_service_transactions: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          applied_vehicle_id: string | null
          batch_id: string
          created_at: string
          evidence: Json
          financial: Json
          group_key: string
          id: string
          item_ids: string[]
          kind: string
          match_basis: string | null
          match_vehicle_id: string | null
          operational: Json
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          applied_vehicle_id?: string | null
          batch_id: string
          created_at?: string
          evidence?: Json
          financial?: Json
          group_key: string
          id?: string
          item_ids?: string[]
          kind?: string
          match_basis?: string | null
          match_vehicle_id?: string | null
          operational?: Json
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          applied_vehicle_id?: string | null
          batch_id?: string
          created_at?: string
          evidence?: Json
          financial?: Json
          group_key?: string
          id?: string
          item_ids?: string[]
          kind?: string
          match_basis?: string | null
          match_vehicle_id?: string | null
          operational?: Json
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_service_transactions_applied_vehicle_id_fkey"
            columns: ["applied_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_service_transactions_applied_vehicle_id_fkey"
            columns: ["applied_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_service_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "fleet_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_service_transactions_match_vehicle_id_fkey"
            columns: ["match_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_service_transactions_match_vehicle_id_fkey"
            columns: ["match_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_webhook_deliveries: {
        Row: {
          application_id: string | null
          attempts: number
          created_at: string
          dedupe_key: string
          delivered_at: string | null
          event_type: string
          id: string
          last_error: string | null
          last_status_code: number | null
          next_attempt_at: string
          payload: Json
          quo_event_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          attempts?: number
          created_at?: string
          dedupe_key: string
          delivered_at?: string | null
          event_type: string
          id?: string
          last_error?: string | null
          last_status_code?: number | null
          next_attempt_at?: string
          payload?: Json
          quo_event_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          attempts?: number
          created_at?: string
          dedupe_key?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          last_error?: string | null
          last_status_code?: number | null
          next_attempt_at?: string
          payload?: Json
          quo_event_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_webhook_deliveries_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      held_notices: {
        Row: {
          amount: number
          attempts: number
          created_at: string
          id: string
          kind: string
          last_note: string | null
          outcome: string
          payment_ids: string[]
          reason: string | null
          rental_id: string | null
          source_ref: string
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          attempts?: number
          created_at?: string
          id?: string
          kind: string
          last_note?: string | null
          outcome: string
          payment_ids?: string[]
          reason?: string | null
          rental_id?: string | null
          source_ref: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          attempts?: number
          created_at?: string
          id?: string
          kind?: string
          last_note?: string | null
          outcome?: string
          payment_ids?: string[]
          reason?: string | null
          rental_id?: string | null
          source_ref?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      inbound_emails: {
        Row: {
          attachments: Json
          batch_id: string | null
          created_at: string
          error: string | null
          from_address: string | null
          from_name: string | null
          html_sanitized: string | null
          id: string
          in_reply_to: string | null
          intake_address: string | null
          message_id: string | null
          provider: string
          provider_email_id: string
          provider_event_id: string | null
          received_at: string
          references_header: string | null
          status: string
          subject: string | null
          text_body: string | null
          to_addresses: string[]
          updated_at: string
        }
        Insert: {
          attachments?: Json
          batch_id?: string | null
          created_at?: string
          error?: string | null
          from_address?: string | null
          from_name?: string | null
          html_sanitized?: string | null
          id?: string
          in_reply_to?: string | null
          intake_address?: string | null
          message_id?: string | null
          provider?: string
          provider_email_id: string
          provider_event_id?: string | null
          received_at?: string
          references_header?: string | null
          status?: string
          subject?: string | null
          text_body?: string | null
          to_addresses?: string[]
          updated_at?: string
        }
        Update: {
          attachments?: Json
          batch_id?: string | null
          created_at?: string
          error?: string | null
          from_address?: string | null
          from_name?: string | null
          html_sanitized?: string | null
          id?: string
          in_reply_to?: string | null
          intake_address?: string | null
          message_id?: string | null
          provider?: string
          provider_email_id?: string
          provider_event_id?: string | null
          received_at?: string
          references_header?: string | null
          status?: string
          subject?: string | null
          text_body?: string | null
          to_addresses?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_emails_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "fleet_import_batches"
            referencedColumns: ["id"]
          },
        ]
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
      maintenance_defaults: {
        Row: {
          category: string
          created_at: string
          id: string
          interval_days: number | null
          interval_miles: number | null
          is_active: boolean
          item: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          interval_days?: number | null
          interval_miles?: number | null
          is_active?: boolean
          item: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          interval_days?: number | null
          interval_miles?: number | null
          is_active?: boolean
          item?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      maintenance_record_items: {
        Row: {
          amount: number | null
          category: string
          charge_type: string | null
          created_at: string
          customer_request: string | null
          description: string
          details: Json | null
          id: string
          labor_amount: number | null
          original_heading: string | null
          parts_amount: number | null
          quantity: number | null
          record_id: string
          sort_order: number
          technician_notes: string | null
          work_performed: string | null
        }
        Insert: {
          amount?: number | null
          category?: string
          charge_type?: string | null
          created_at?: string
          customer_request?: string | null
          description: string
          details?: Json | null
          id?: string
          labor_amount?: number | null
          original_heading?: string | null
          parts_amount?: number | null
          quantity?: number | null
          record_id: string
          sort_order?: number
          technician_notes?: string | null
          work_performed?: string | null
        }
        Update: {
          amount?: number | null
          category?: string
          charge_type?: string | null
          created_at?: string
          customer_request?: string | null
          description?: string
          details?: Json | null
          id?: string
          labor_amount?: number | null
          original_heading?: string | null
          parts_amount?: number | null
          quantity?: number | null
          record_id?: string
          sort_order?: number
          technician_notes?: string | null
          work_performed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_record_items_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "maintenance_records"
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
          created_by: string | null
          description: string | null
          document_id: string | null
          document_page: number | null
          driver_id: string | null
          due_date: string | null
          due_mileage: number | null
          id: string
          invoice_number: string | null
          item: string
          labor_cost: number | null
          mileage_in: number | null
          mileage_out: number | null
          notes: string | null
          odometer: number | null
          original_extraction: Json | null
          other_cost: number | null
          partner_id: string | null
          partner_share: number
          parts_cost: number | null
          payment_method: string | null
          payment_status: string | null
          performed_on: string | null
          priority: string | null
          proposal_id: string | null
          rental_id: string | null
          schedule_id: string | null
          shop_id: string | null
          source: string
          status: string
          tax_amount: number | null
          total_cost: number
          transaction_id: string | null
          updated_at: string
          updated_by: string | null
          vehicle_id: string
          vendor_credit: number | null
          vendor_id: string | null
          vendor_name_raw: string | null
          warranty_covered: number | null
        }
        Insert: {
          category?: string
          company_share?: number
          completed_at?: string | null
          cost_split?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_id?: string | null
          document_page?: number | null
          driver_id?: string | null
          due_date?: string | null
          due_mileage?: number | null
          id?: string
          invoice_number?: string | null
          item: string
          labor_cost?: number | null
          mileage_in?: number | null
          mileage_out?: number | null
          notes?: string | null
          odometer?: number | null
          original_extraction?: Json | null
          other_cost?: number | null
          partner_id?: string | null
          partner_share?: number
          parts_cost?: number | null
          payment_method?: string | null
          payment_status?: string | null
          performed_on?: string | null
          priority?: string | null
          proposal_id?: string | null
          rental_id?: string | null
          schedule_id?: string | null
          shop_id?: string | null
          source?: string
          status?: string
          tax_amount?: number | null
          total_cost?: number
          transaction_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
          vendor_credit?: number | null
          vendor_id?: string | null
          vendor_name_raw?: string | null
          warranty_covered?: number | null
        }
        Update: {
          category?: string
          company_share?: number
          completed_at?: string | null
          cost_split?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_id?: string | null
          document_page?: number | null
          driver_id?: string | null
          due_date?: string | null
          due_mileage?: number | null
          id?: string
          invoice_number?: string | null
          item?: string
          labor_cost?: number | null
          mileage_in?: number | null
          mileage_out?: number | null
          notes?: string | null
          odometer?: number | null
          original_extraction?: Json | null
          other_cost?: number | null
          partner_id?: string | null
          partner_share?: number
          parts_cost?: number | null
          payment_method?: string | null
          payment_status?: string | null
          performed_on?: string | null
          priority?: string | null
          proposal_id?: string | null
          rental_id?: string | null
          schedule_id?: string | null
          shop_id?: string | null
          source?: string
          status?: string
          tax_amount?: number | null
          total_cost?: number
          transaction_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
          vendor_credit?: number | null
          vendor_id?: string | null
          vendor_name_raw?: string | null
          warranty_covered?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_records_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "maintenance_records_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "fleet_service_transactions"
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
          default_id: string | null
          id: string
          interval_days: number | null
          interval_miles: number | null
          is_active: boolean
          is_override: boolean
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
          default_id?: string | null
          id?: string
          interval_days?: number | null
          interval_miles?: number | null
          is_active?: boolean
          is_override?: boolean
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
          default_id?: string | null
          id?: string
          interval_days?: number | null
          interval_miles?: number | null
          is_active?: boolean
          is_override?: boolean
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
            foreignKeyName: "maintenance_schedules_default_id_fkey"
            columns: ["default_id"]
            isOneToOne: false
            referencedRelation: "maintenance_defaults"
            referencedColumns: ["id"]
          },
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
          application_id: string | null
          body: string
          channel: string
          created_at: string
          delivery_error: string | null
          delivery_state: string | null
          direction: string
          driver_id: string | null
          email_delivery_id: string | null
          id: string
          kind: string
          partner_id: string | null
          read: boolean
          recipient_id: string | null
          sender_id: string | null
          subject: string | null
          thread_id: string
          to_address: string | null
        }
        Insert: {
          application_id?: string | null
          body: string
          channel?: string
          created_at?: string
          delivery_error?: string | null
          delivery_state?: string | null
          direction?: string
          driver_id?: string | null
          email_delivery_id?: string | null
          id?: string
          kind?: string
          partner_id?: string | null
          read?: boolean
          recipient_id?: string | null
          sender_id?: string | null
          subject?: string | null
          thread_id?: string
          to_address?: string | null
        }
        Update: {
          application_id?: string | null
          body?: string
          channel?: string
          created_at?: string
          delivery_error?: string | null
          delivery_state?: string | null
          direction?: string
          driver_id?: string | null
          email_delivery_id?: string | null
          id?: string
          kind?: string
          partner_id?: string | null
          read?: boolean
          recipient_id?: string | null
          sender_id?: string | null
          subject?: string | null
          thread_id?: string
          to_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_email_delivery_id_fkey"
            columns: ["email_delivery_id"]
            isOneToOne: false
            referencedRelation: "email_deliveries"
            referencedColumns: ["id"]
          },
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
      odometer_readings: {
        Row: {
          created_at: string
          document_id: string | null
          document_page: number | null
          driver_id: string | null
          entered_by: string | null
          evidence_key: string | null
          id: string
          mileage: number
          note: string | null
          observed_at: string | null
          observed_on: string
          rental_id: string | null
          source_id: string | null
          source_type: string
          status: string
          supersedes_id: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          document_page?: number | null
          driver_id?: string | null
          entered_by?: string | null
          evidence_key?: string | null
          id?: string
          mileage: number
          note?: string | null
          observed_at?: string | null
          observed_on: string
          rental_id?: string | null
          source_id?: string | null
          source_type: string
          status?: string
          supersedes_id?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          document_page?: number | null
          driver_id?: string | null
          entered_by?: string | null
          evidence_key?: string | null
          id?: string
          mileage?: number
          note?: string | null
          observed_at?: string | null
          observed_on?: string
          rental_id?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          supersedes_id?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "odometer_readings_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odometer_readings_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odometer_readings_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "odometer_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odometer_readings_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odometer_readings_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
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
      payment_text_pauses: {
        Row: {
          application_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string
          id: string
          idempotency_key: string | null
          pause_until: string
          reason: string
          rental_id: string
          source: string
          starts_at: string
        }
        Insert: {
          application_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          idempotency_key?: string | null
          pause_until: string
          reason: string
          rental_id: string
          source?: string
          starts_at?: string
        }
        Update: {
          application_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string | null
          pause_until?: string
          reason?: string
          rental_id?: string
          source?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_text_pauses_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_text_pauses_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
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
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
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
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
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
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
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
      payments_stripe_paid_at_unpaid_backup_20261116: {
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
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_number: string | null
          stripe_invoice_pdf_url: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
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
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
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
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_number?: string | null
          stripe_invoice_pdf_url?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          type?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: []
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
      photo_enhance_events: {
        Row: {
          actor_id: string | null
          cost_cents: number
          created_at: string
          error: string | null
          id: string
          mode: string
          processing_ms: number | null
          result_media_id: string | null
          source_media_id: string | null
          status: string
          vehicle_id: string
        }
        Insert: {
          actor_id?: string | null
          cost_cents?: number
          created_at?: string
          error?: string | null
          id?: string
          mode: string
          processing_ms?: number | null
          result_media_id?: string | null
          source_media_id?: string | null
          status: string
          vehicle_id: string
        }
        Update: {
          actor_id?: string | null
          cost_cents?: number
          created_at?: string
          error?: string | null
          id?: string
          mode?: string
          processing_ms?: number | null
          result_media_id?: string | null
          source_media_id?: string | null
          status?: string
          vehicle_id?: string
        }
        Relationships: []
      }
      photo_enhance_settings: {
        Row: {
          daily_limit: number
          enabled: boolean
          id: boolean
          monthly_paid_cap_cents: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          daily_limit?: number
          enabled?: boolean
          id?: boolean
          monthly_paid_cap_cents?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          daily_limit?: number
          enabled?: boolean
          id?: boolean
          monthly_paid_cap_cents?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      photo_studio_spend: {
        Row: {
          cost_cents: number
          created_at: string
          created_by: string | null
          id: string
          model: string
          outcome: string
          provider: string
          shot_slot: string | null
          vehicle_id: string | null
        }
        Insert: {
          cost_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          model: string
          outcome: string
          provider: string
          shot_slot?: string | null
          vehicle_id?: string | null
        }
        Update: {
          cost_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string
          outcome?: string
          provider?: string
          shot_slot?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "photo_studio_spend_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_studio_spend_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_handovers: {
        Row: {
          activated_rental_id: string | null
          activation_detail: string | null
          activation_status: string
          application_id: string
          completed_at: string
          completed_by: string
          created_at: string
          fuel_level: string
          odometer: number
          rental_id: string
          renter_signature_ip: string | null
          renter_signature_name: string
          renter_signature_user_agent: string | null
          renter_signed_at: string
          vehicle_id: string
        }
        Insert: {
          activated_rental_id?: string | null
          activation_detail?: string | null
          activation_status?: string
          application_id: string
          completed_at?: string
          completed_by: string
          created_at?: string
          fuel_level: string
          odometer: number
          rental_id: string
          renter_signature_ip?: string | null
          renter_signature_name: string
          renter_signature_user_agent?: string | null
          renter_signed_at: string
          vehicle_id: string
        }
        Update: {
          activated_rental_id?: string | null
          activation_detail?: string | null
          activation_status?: string
          application_id?: string
          completed_at?: string
          completed_by?: string
          created_at?: string
          fuel_level?: string
          odometer?: number
          rental_id?: string
          renter_signature_ip?: string | null
          renter_signature_name?: string
          renter_signature_user_agent?: string | null
          renter_signed_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_handovers_activated_rental_id_fkey"
            columns: ["activated_rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_handovers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_handovers_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: true
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_handovers_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_handovers_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_signin_challenges: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          eligible: boolean
          email: string
          expires_at: string
          id: string
          ip_hash: string | null
          link_hash: string
          send_state: string
          used_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          eligible?: boolean
          email: string
          expires_at: string
          id?: string
          ip_hash?: string | null
          link_hash: string
          send_state?: string
          used_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          eligible?: boolean
          email?: string
          expires_at?: string
          id?: string
          ip_hash?: string | null
          link_hash?: string
          send_state?: string
          used_at?: string | null
        }
        Relationships: []
      }
      quo_events: {
        Row: {
          application_id: string | null
          body: string | null
          call_id: string | null
          conversation_id: string | null
          created_at: string
          direction: string | null
          duration_seconds: number | null
          event_type: string
          from_e164: string | null
          id: string
          line_e164: string
          line_label: string
          occurred_at: string | null
          phone_number_id: string
          quo_event_id: string
          quo_resource_id: string | null
          raw: Json
          recording_url: string | null
          to_e164: string | null
          transcript: string | null
          voicemail_url: string | null
        }
        Insert: {
          application_id?: string | null
          body?: string | null
          call_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string | null
          duration_seconds?: number | null
          event_type: string
          from_e164?: string | null
          id?: string
          line_e164: string
          line_label: string
          occurred_at?: string | null
          phone_number_id: string
          quo_event_id: string
          quo_resource_id?: string | null
          raw?: Json
          recording_url?: string | null
          to_e164?: string | null
          transcript?: string | null
          voicemail_url?: string | null
        }
        Update: {
          application_id?: string | null
          body?: string | null
          call_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string | null
          duration_seconds?: number | null
          event_type?: string
          from_e164?: string | null
          id?: string
          line_e164?: string
          line_label?: string
          occurred_at?: string | null
          phone_number_id?: string
          quo_event_id?: string
          quo_resource_id?: string | null
          raw?: Json
          recording_url?: string | null
          to_e164?: string | null
          transcript?: string | null
          voicemail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quo_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
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
      rent_late_fee_waivers: {
        Row: {
          amount_waived: number | null
          created_at: string
          due_date: string
          id: string
          reason: string | null
          rental_id: string
          updated_at: string
          waived_by: string | null
          waived_by_email: string | null
          waived_through: string | null
        }
        Insert: {
          amount_waived?: number | null
          created_at?: string
          due_date: string
          id?: string
          reason?: string | null
          rental_id: string
          updated_at?: string
          waived_by?: string | null
          waived_by_email?: string | null
          waived_through?: string | null
        }
        Update: {
          amount_waived?: number | null
          created_at?: string
          due_date?: string
          id?: string
          reason?: string | null
          rental_id?: string
          updated_at?: string
          waived_by?: string | null
          waived_by_email?: string | null
          waived_through?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rent_late_fee_waivers_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rent_reminder_log: {
        Row: {
          channel: string
          created_at: string
          detail: string | null
          due_date: string
          id: string
          outcome: string
          rental_id: string
          source: string
          stage: string
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          detail?: string | null
          due_date: string
          id?: string
          outcome?: string
          rental_id: string
          source?: string
          stage: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          detail?: string | null
          due_date?: string
          id?: string
          outcome?: string
          rental_id?: string
          source?: string
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rent_reminder_log_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_additional_drivers: {
        Row: {
          application_id: string | null
          approved_at: string | null
          created_at: string
          dob: string | null
          email: string | null
          id: string
          insurance_added_at: string | null
          license_expiration: string | null
          license_number: string | null
          license_photo_path: string | null
          license_state: string | null
          name: string
          phone: string | null
          relationship: string | null
          removed_at: string | null
          rental_id: string | null
          screening_status: string
          signed_at: string | null
          sms_consent: boolean
          stripe_subscription_item_id: string | null
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          approved_at?: string | null
          created_at?: string
          dob?: string | null
          email?: string | null
          id?: string
          insurance_added_at?: string | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_path?: string | null
          license_state?: string | null
          name: string
          phone?: string | null
          relationship?: string | null
          removed_at?: string | null
          rental_id?: string | null
          screening_status?: string
          signed_at?: string | null
          sms_consent?: boolean
          stripe_subscription_item_id?: string | null
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          approved_at?: string | null
          created_at?: string
          dob?: string | null
          email?: string | null
          id?: string
          insurance_added_at?: string | null
          license_expiration?: string | null
          license_number?: string | null
          license_photo_path?: string | null
          license_state?: string | null
          name?: string
          phone?: string | null
          relationship?: string | null
          removed_at?: string | null
          rental_id?: string | null
          screening_status?: string
          signed_at?: string | null
          sms_consent?: boolean
          stripe_subscription_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_additional_drivers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_additional_drivers_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_rate_amendments: {
        Row: {
          agreement_id: string | null
          application_id: string
          applied_at: string | null
          apply_on: string | null
          created_at: string
          effective_date: string
          id: string
          idempotency_key: string | null
          new_weekly_rate: number
          note: string | null
          old_weekly_rate: number
          out_of_bounds_ack: boolean
          previous_agreement_id: string | null
          reason: string
          rental_id: string
          renter_consent: Json | null
          requested_by: string
          requested_by_user: string | null
          signed_at: string | null
          source: string
          status: string
          stripe_update_required: boolean
          updated_at: string
        }
        Insert: {
          agreement_id?: string | null
          application_id: string
          applied_at?: string | null
          apply_on?: string | null
          created_at?: string
          effective_date: string
          id?: string
          idempotency_key?: string | null
          new_weekly_rate: number
          note?: string | null
          old_weekly_rate: number
          out_of_bounds_ack?: boolean
          previous_agreement_id?: string | null
          reason: string
          rental_id: string
          renter_consent?: Json | null
          requested_by: string
          requested_by_user?: string | null
          signed_at?: string | null
          source: string
          status?: string
          stripe_update_required?: boolean
          updated_at?: string
        }
        Update: {
          agreement_id?: string | null
          application_id?: string
          applied_at?: string | null
          apply_on?: string | null
          created_at?: string
          effective_date?: string
          id?: string
          idempotency_key?: string | null
          new_weekly_rate?: number
          note?: string | null
          old_weekly_rate?: number
          out_of_bounds_ack?: boolean
          previous_agreement_id?: string | null
          reason?: string
          rental_id?: string
          renter_consent?: Json | null
          requested_by?: string
          requested_by_user?: string | null
          signed_at?: string | null
          source?: string
          status?: string
          stripe_update_required?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_rate_amendments_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_rate_amendments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_rate_amendments_previous_agreement_id_fkey"
            columns: ["previous_agreement_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_rate_amendments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_vehicle_swap_documents: {
        Row: {
          created_at: string
          doc_kind: string
          document_id: string
          id: string
          swap_id: string
          uploaded_by: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          doc_kind: string
          document_id: string
          id?: string
          swap_id: string
          uploaded_by?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          doc_kind?: string
          document_id?: string
          id?: string
          swap_id?: string
          uploaded_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_vehicle_swap_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swap_documents_swap_id_fkey"
            columns: ["swap_id"]
            isOneToOne: false
            referencedRelation: "rental_vehicle_swaps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swap_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swap_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_vehicle_swap_photos: {
        Row: {
          created_at: string
          file_name: string | null
          id: string
          mime_type: string
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          swap_id: string
          uploaded_by: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          id?: string
          mime_type: string
          size_bytes?: number | null
          storage_bucket?: string
          storage_path: string
          swap_id: string
          uploaded_by?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          id?: string
          mime_type?: string
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          swap_id?: string
          uploaded_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_vehicle_swap_photos_swap_id_fkey"
            columns: ["swap_id"]
            isOneToOne: false
            referencedRelation: "rental_vehicle_swaps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swap_photos_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swap_photos_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_vehicle_swaps: {
        Row: {
          agreement_id: string | null
          application_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          from_vehicle_id: string
          from_vehicle_status: string | null
          id: string
          idempotency_key: string | null
          insurance_override_at: string | null
          insurance_override_by: string | null
          insurance_override_reason: string | null
          note: string | null
          pickup_fuel: string | null
          pickup_mileage: number | null
          pickup_reading_id: string | null
          previous_agreement_id: string | null
          previous_document_id: string | null
          reason: string
          reason_code: string
          rental_id: string
          replaced_pickup_reading_id: string | null
          requested_by: string | null
          requested_by_label: string
          return_fuel: string | null
          return_mileage: number | null
          return_reading_id: string | null
          signed_at: string | null
          status: string
          swap_number: number
          to_vehicle_id: string
          updated_at: string
          weekly_rate: number
        }
        Insert: {
          agreement_id?: string | null
          application_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          from_vehicle_id: string
          from_vehicle_status?: string | null
          id?: string
          idempotency_key?: string | null
          insurance_override_at?: string | null
          insurance_override_by?: string | null
          insurance_override_reason?: string | null
          note?: string | null
          pickup_fuel?: string | null
          pickup_mileage?: number | null
          pickup_reading_id?: string | null
          previous_agreement_id?: string | null
          previous_document_id?: string | null
          reason: string
          reason_code: string
          rental_id: string
          replaced_pickup_reading_id?: string | null
          requested_by?: string | null
          requested_by_label: string
          return_fuel?: string | null
          return_mileage?: number | null
          return_reading_id?: string | null
          signed_at?: string | null
          status?: string
          swap_number?: number
          to_vehicle_id: string
          updated_at?: string
          weekly_rate: number
        }
        Update: {
          agreement_id?: string | null
          application_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          from_vehicle_id?: string
          from_vehicle_status?: string | null
          id?: string
          idempotency_key?: string | null
          insurance_override_at?: string | null
          insurance_override_by?: string | null
          insurance_override_reason?: string | null
          note?: string | null
          pickup_fuel?: string | null
          pickup_mileage?: number | null
          pickup_reading_id?: string | null
          previous_agreement_id?: string | null
          previous_document_id?: string | null
          reason?: string
          reason_code?: string
          rental_id?: string
          replaced_pickup_reading_id?: string | null
          requested_by?: string | null
          requested_by_label?: string
          return_fuel?: string | null
          return_mileage?: number | null
          return_reading_id?: string | null
          signed_at?: string | null
          status?: string
          swap_number?: number
          to_vehicle_id?: string
          updated_at?: string
          weekly_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "rental_vehicle_swaps_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swaps_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swaps_from_vehicle_id_fkey"
            columns: ["from_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swaps_from_vehicle_id_fkey"
            columns: ["from_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swaps_pickup_reading_id_fkey"
            columns: ["pickup_reading_id"]
            isOneToOne: false
            referencedRelation: "odometer_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swaps_previous_agreement_id_fkey"
            columns: ["previous_agreement_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swaps_previous_document_id_fkey"
            columns: ["previous_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swaps_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swaps_replaced_pickup_reading_id_fkey"
            columns: ["replaced_pickup_reading_id"]
            isOneToOne: false
            referencedRelation: "odometer_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swaps_return_reading_id_fkey"
            columns: ["return_reading_id"]
            isOneToOne: false
            referencedRelation: "odometer_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swaps_to_vehicle_id_fkey"
            columns: ["to_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_vehicle_swaps_to_vehicle_id_fkey"
            columns: ["to_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      rentals: {
        Row: {
          application_id: string | null
          autopay_active: boolean
          balance_due_cents: number
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_on_file_at: string | null
          close_reason: string | null
          created_at: string
          days_late_at_repo: number | null
          deposit_amount: number
          deposit_held: boolean
          deposit_notes: string | null
          deposit_refund_amount: number | null
          deposit_settled_at: string | null
          deposit_status: string
          driver_id: string
          end_date: string | null
          final_invoice_id: string | null
          final_invoice_url: string | null
          hold_by: string | null
          hold_reason: string | null
          hold_started_at: string | null
          id: string
          next_payment_due: string | null
          payment_status: string
          pickup_reading_id: string | null
          repossessed_on: string | null
          reservation_deposit_amount: number
          reservation_deposit_payment_id: string | null
          reservation_deposit_required: boolean
          reservation_deposit_status: string
          reservation_note: string | null
          return_photos_skipped_reason: string | null
          return_reading_id: string | null
          start_date: string
          status: string
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          vehicle_id: string | null
          weekly_rate: number
        }
        Insert: {
          application_id?: string | null
          autopay_active?: boolean
          balance_due_cents?: number
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          close_reason?: string | null
          created_at?: string
          days_late_at_repo?: number | null
          deposit_amount?: number
          deposit_held?: boolean
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string
          driver_id: string
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string
          next_payment_due?: string | null
          payment_status?: string
          pickup_reading_id?: string | null
          repossessed_on?: string | null
          reservation_deposit_amount?: number
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean
          reservation_deposit_status?: string
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
          weekly_rate?: number
        }
        Update: {
          application_id?: string | null
          autopay_active?: boolean
          balance_due_cents?: number
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_on_file_at?: string | null
          close_reason?: string | null
          created_at?: string
          days_late_at_repo?: number | null
          deposit_amount?: number
          deposit_held?: boolean
          deposit_notes?: string | null
          deposit_refund_amount?: number | null
          deposit_settled_at?: string | null
          deposit_status?: string
          driver_id?: string
          end_date?: string | null
          final_invoice_id?: string | null
          final_invoice_url?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          hold_started_at?: string | null
          id?: string
          next_payment_due?: string | null
          payment_status?: string
          pickup_reading_id?: string | null
          repossessed_on?: string | null
          reservation_deposit_amount?: number
          reservation_deposit_payment_id?: string | null
          reservation_deposit_required?: boolean
          reservation_deposit_status?: string
          reservation_note?: string | null
          return_photos_skipped_reason?: string | null
          return_reading_id?: string | null
          start_date?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
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
            foreignKeyName: "rentals_pickup_reading_id_fkey"
            columns: ["pickup_reading_id"]
            isOneToOne: false
            referencedRelation: "odometer_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_reservation_deposit_payment_id_fkey"
            columns: ["reservation_deposit_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_return_reading_id_fkey"
            columns: ["return_reading_id"]
            isOneToOne: false
            referencedRelation: "odometer_readings"
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
      renter_blacklist: {
        Row: {
          added_by: string | null
          added_by_label: string
          application_id: string | null
          blacklisted_on: string
          created_at: string
          full_name: string | null
          id: string
          note: string
          reason_code: string
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          removed_by_label: string | null
        }
        Insert: {
          added_by?: string | null
          added_by_label: string
          application_id?: string | null
          blacklisted_on: string
          created_at?: string
          full_name?: string | null
          id?: string
          note: string
          reason_code: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_by_label?: string | null
        }
        Update: {
          added_by?: string | null
          added_by_label?: string
          application_id?: string | null
          blacklisted_on?: string
          created_at?: string
          full_name?: string | null
          id?: string
          note?: string
          reason_code?: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_by_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "renter_blacklist_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      renter_blacklist_clearances: {
        Row: {
          application_id: string
          blacklist_id: string
          cleared_by: string | null
          cleared_by_label: string
          created_at: string
          id: string
          note: string | null
        }
        Insert: {
          application_id: string
          blacklist_id: string
          cleared_by?: string | null
          cleared_by_label: string
          created_at?: string
          id?: string
          note?: string | null
        }
        Update: {
          application_id?: string
          blacklist_id?: string
          cleared_by?: string | null
          cleared_by_label?: string
          created_at?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "renter_blacklist_clearances_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renter_blacklist_clearances_blacklist_id_fkey"
            columns: ["blacklist_id"]
            isOneToOne: false
            referencedRelation: "renter_blacklist"
            referencedColumns: ["id"]
          },
        ]
      }
      renter_blacklist_identifiers: {
        Row: {
          blacklist_id: string
          id: string
          kind: string
          value_norm: string
        }
        Insert: {
          blacklist_id: string
          id?: string
          kind: string
          value_norm: string
        }
        Update: {
          blacklist_id?: string
          id?: string
          kind?: string
          value_norm?: string
        }
        Relationships: [
          {
            foreignKeyName: "renter_blacklist_identifiers_blacklist_id_fkey"
            columns: ["blacklist_id"]
            isOneToOne: false
            referencedRelation: "renter_blacklist"
            referencedColumns: ["id"]
          },
        ]
      }
      renter_blacklist_matches: {
        Row: {
          blacklist_id: string
          clear_note: string | null
          cleared_at: string | null
          cleared_by: string | null
          cleared_by_label: string | null
          created_at: string
          id: string
          matched_kinds: string[]
          matched_name: string | null
          source_id: string
          source_table: string
          updated_at: string
        }
        Insert: {
          blacklist_id: string
          clear_note?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_by_label?: string | null
          created_at?: string
          id?: string
          matched_kinds: string[]
          matched_name?: string | null
          source_id: string
          source_table: string
          updated_at?: string
        }
        Update: {
          blacklist_id?: string
          clear_note?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_by_label?: string | null
          created_at?: string
          id?: string
          matched_kinds?: string[]
          matched_name?: string | null
          source_id?: string
          source_table?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "renter_blacklist_matches_blacklist_id_fkey"
            columns: ["blacklist_id"]
            isOneToOne: false
            referencedRelation: "renter_blacklist"
            referencedColumns: ["id"]
          },
        ]
      }
      renter_credits: {
        Row: {
          amount: number
          application_id: string
          applied_at: string | null
          applied_to_rental_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          reason: string | null
          source_payment_id: string | null
          source_rental_id: string | null
          status: string
          updated_at: string
          void_reason: string | null
        }
        Insert: {
          amount: number
          application_id: string
          applied_at?: string | null
          applied_to_rental_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          reason?: string | null
          source_payment_id?: string | null
          source_rental_id?: string | null
          status?: string
          updated_at?: string
          void_reason?: string | null
        }
        Update: {
          amount?: number
          application_id?: string
          applied_at?: string | null
          applied_to_rental_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          reason?: string | null
          source_payment_id?: string | null
          source_rental_id?: string | null
          status?: string
          updated_at?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "renter_credits_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renter_credits_applied_to_rental_id_fkey"
            columns: ["applied_to_rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renter_credits_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renter_credits_source_rental_id_fkey"
            columns: ["source_rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      renter_portal_prefs: {
        Row: {
          updated_at: string
          user_id: string
          vendor_view: string
        }
        Insert: {
          updated_at?: string
          user_id: string
          vendor_view?: string
        }
        Update: {
          updated_at?: string
          user_id?: string
          vendor_view?: string
        }
        Relationships: []
      }
      renter_reimbursements: {
        Row: {
          amount: number
          application_id: string
          created_at: string
          created_by: string | null
          id: string
          method: string
          notes: string | null
          paid_on: string
          reason: string
          receipt_mime: string | null
          receipt_name: string | null
          receipt_path: string | null
          reference: string | null
          rental_id: string | null
          source_expense_id: string | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          amount: number
          application_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          method: string
          notes?: string | null
          paid_on: string
          reason: string
          receipt_mime?: string | null
          receipt_name?: string | null
          receipt_path?: string | null
          reference?: string | null
          rental_id?: string | null
          source_expense_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          amount?: number
          application_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          notes?: string | null
          paid_on?: string
          reason?: string
          receipt_mime?: string | null
          receipt_name?: string | null
          receipt_path?: string | null
          reference?: string | null
          rental_id?: string | null
          source_expense_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "renter_reimbursements_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renter_reimbursements_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renter_reimbursements_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renter_reimbursements_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      renter_reminder_sends: {
        Row: {
          agreement_id: string | null
          application_id: string | null
          channel: string | null
          created_at: string
          detail: string | null
          key: string
          kind: string
          rental_id: string | null
          status: string
        }
        Insert: {
          agreement_id?: string | null
          application_id?: string | null
          channel?: string | null
          created_at?: string
          detail?: string | null
          key: string
          kind: string
          rental_id?: string | null
          status?: string
        }
        Update: {
          agreement_id?: string | null
          application_id?: string | null
          channel?: string | null
          created_at?: string
          detail?: string | null
          key?: string
          kind?: string
          rental_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "renter_reminder_sends_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renter_reminder_sends_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renter_reminder_sends_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      renter_strikes: {
        Row: {
          added_by: string | null
          added_by_label: string
          application_id: string | null
          created_at: string
          id: string
          kind: string
          note: string
          occurred_on: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          voided_by_label: string | null
        }
        Insert: {
          added_by?: string | null
          added_by_label: string
          application_id?: string | null
          created_at?: string
          id?: string
          kind: string
          note: string
          occurred_on: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_label?: string | null
        }
        Update: {
          added_by?: string | null
          added_by_label?: string
          application_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          note?: string
          occurred_on?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "renter_strikes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      renter_vendors: {
        Row: {
          address: string | null
          category: string
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          notes: string | null
          phone: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          category: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Relationships: []
      }
      reservation_confirmations: {
        Row: {
          application_id: string | null
          confirmed_at: string
          created_at: string
          email_status: string | null
          notice_status: string
          notified_at: string | null
          payload: Json
          rental_id: string
          sms_status: string | null
        }
        Insert: {
          application_id?: string | null
          confirmed_at?: string
          created_at?: string
          email_status?: string | null
          notice_status: string
          notified_at?: string | null
          payload?: Json
          rental_id: string
          sms_status?: string | null
        }
        Update: {
          application_id?: string | null
          confirmed_at?: string
          created_at?: string
          email_status?: string | null
          notice_status?: string
          notified_at?: string | null
          payload?: Json
          rental_id?: string
          sms_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_confirmations_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: true
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_fee_refunds: {
        Row: {
          amount: number
          application_id: string | null
          id: string
          note: string | null
          payment_id: string
          reason: string
          refunded_at: string
          refunded_by: string | null
          refunded_by_email: string | null
          rental_id: string | null
          source: string
          stripe_payment_intent_id: string | null
          stripe_refund_id: string | null
        }
        Insert: {
          amount: number
          application_id?: string | null
          id?: string
          note?: string | null
          payment_id: string
          reason: string
          refunded_at?: string
          refunded_by?: string | null
          refunded_by_email?: string | null
          rental_id?: string | null
          source: string
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
        }
        Update: {
          amount?: number
          application_id?: string | null
          id?: string
          note?: string | null
          payment_id?: string
          reason?: string
          refunded_at?: string
          refunded_by?: string | null
          refunded_by_email?: string | null
          rental_id?: string | null
          source?: string
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_fee_refunds_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_fee_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_fee_refunds_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      return_checklist_items: {
        Row: {
          area: string
          checklist_id: string
          id: string
          item_key: string
          label: string
          notes: string | null
          result: string
        }
        Insert: {
          area: string
          checklist_id: string
          id?: string
          item_key: string
          label: string
          notes?: string | null
          result: string
        }
        Update: {
          area?: string
          checklist_id?: string
          id?: string
          item_key?: string
          label?: string
          notes?: string | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "return_checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      return_checklist_photos: {
        Row: {
          angle: string | null
          checklist_id: string
          created_at: string
          id: string
          storage_bucket: string
          storage_path: string
        }
        Insert: {
          angle?: string | null
          checklist_id: string
          created_at?: string
          id?: string
          storage_bucket?: string
          storage_path: string
        }
        Update: {
          angle?: string | null
          checklist_id?: string
          created_at?: string
          id?: string
          storage_bucket?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_checklist_photos_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "return_checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      return_checklists: {
        Row: {
          condition_notes: string | null
          created_at: string
          deposit_decision_needed: boolean
          deposit_decision_note: string | null
          fuel_or_charge: string
          id: string
          keys_returned: boolean
          odometer: number
          photos_skipped_reason: string | null
          recorded_by: string | null
          rental_id: string
          returned_at: string
          tolls_tickets_note: string | null
          vehicle_id: string
        }
        Insert: {
          condition_notes?: string | null
          created_at?: string
          deposit_decision_needed?: boolean
          deposit_decision_note?: string | null
          fuel_or_charge: string
          id?: string
          keys_returned: boolean
          odometer: number
          photos_skipped_reason?: string | null
          recorded_by?: string | null
          rental_id: string
          returned_at: string
          tolls_tickets_note?: string | null
          vehicle_id: string
        }
        Update: {
          condition_notes?: string | null
          created_at?: string
          deposit_decision_needed?: boolean
          deposit_decision_note?: string | null
          fuel_or_charge?: string
          id?: string
          keys_returned?: boolean
          odometer?: number
          photos_skipped_reason?: string | null
          recorded_by?: string | null
          rental_id?: string
          returned_at?: string
          tolls_tickets_note?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_checklists_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_checklists_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_checklists_vehicle_id_fkey"
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
      staff_schedule_exceptions: {
        Row: {
          created_at: string
          end_time: string | null
          exception_date: string
          id: string
          kind: string
          note: string | null
          staff_key: string
          start_time: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_time?: string | null
          exception_date: string
          id?: string
          kind: string
          note?: string | null
          staff_key: string
          start_time?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_time?: string | null
          exception_date?: string
          id?: string
          kind?: string
          note?: string | null
          staff_key?: string
          start_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_schedule_exceptions_staff_key_fkey"
            columns: ["staff_key"]
            isOneToOne: false
            referencedRelation: "staff_schedules"
            referencedColumns: ["staff_key"]
          },
        ]
      }
      staff_schedules: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          reach_via: string
          roles: string[]
          staff_key: string
          timezone: string
          updated_at: string
          weekly_windows: Json
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          reach_via?: string
          roles?: string[]
          staff_key: string
          timezone?: string
          updated_at?: string
          weekly_windows?: Json
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          reach_via?: string
          roles?: string[]
          staff_key?: string
          timezone?: string
          updated_at?: string
          weekly_windows?: Json
        }
        Relationships: []
      }
      staff_terms_confirmations: {
        Row: {
          application_id: string
          clicked_at: string
          clicked_by: string
          clicked_by_name: string
          created_at: string
          deposit: number
          fleet_delivery_id: string | null
          id: string
          reservation_fee: number
          start_date: string
          terms_key: string
          vehicle_id: string
          vehicle_label: string | null
          weekly_rate: number
        }
        Insert: {
          application_id: string
          clicked_at?: string
          clicked_by: string
          clicked_by_name: string
          created_at?: string
          deposit: number
          fleet_delivery_id?: string | null
          id?: string
          reservation_fee?: number
          start_date: string
          terms_key: string
          vehicle_id: string
          vehicle_label?: string | null
          weekly_rate: number
        }
        Update: {
          application_id?: string
          clicked_at?: string
          clicked_by?: string
          clicked_by_name?: string
          created_at?: string
          deposit?: number
          fleet_delivery_id?: string | null
          id?: string
          reservation_fee?: number
          start_date?: string
          terms_key?: string
          vehicle_id?: string
          vehicle_label?: string | null
          weekly_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_terms_confirmations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      team_alert_sends: {
        Row: {
          created_at: string
          detail: string | null
          key: string
          kind: string
          rental_id: string | null
          status: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: string | null
          key: string
          kind: string
          rental_id?: string | null
          status?: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: string | null
          key?: string
          kind?: string
          rental_id?: string | null
          status?: string
          vehicle_id?: string | null
        }
        Relationships: []
      }
      toll_charges: {
        Row: {
          admin_fee: number
          agency: string | null
          agency_due_date: string | null
          amount: number
          application_id: string | null
          charge_type: string
          created_at: string
          created_by: string | null
          escalated_at: string | null
          escalation: string
          id: string
          location: string | null
          notes: string | null
          occurred_at: string
          payment_id: string | null
          reference_number: string | null
          rental_id: string | null
          renter_pay_by: string | null
          source: string
          status: string
          stripe_payment_link_id: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          admin_fee?: number
          agency?: string | null
          agency_due_date?: string | null
          amount?: number
          application_id?: string | null
          charge_type?: string
          created_at?: string
          created_by?: string | null
          escalated_at?: string | null
          escalation?: string
          id?: string
          location?: string | null
          notes?: string | null
          occurred_at: string
          payment_id?: string | null
          reference_number?: string | null
          rental_id?: string | null
          renter_pay_by?: string | null
          source?: string
          status?: string
          stripe_payment_link_id?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          admin_fee?: number
          agency?: string | null
          agency_due_date?: string | null
          amount?: number
          application_id?: string | null
          charge_type?: string
          created_at?: string
          created_by?: string | null
          escalated_at?: string | null
          escalation?: string
          id?: string
          location?: string | null
          notes?: string | null
          occurred_at?: string
          payment_id?: string | null
          reference_number?: string | null
          rental_id?: string | null
          renter_pay_by?: string | null
          source?: string
          status?: string
          stripe_payment_link_id?: string | null
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
      unmatched_stripe_payments: {
        Row: {
          amount_cents: number
          assigned_by: string | null
          created_at: string
          currency: string
          dismissed_by: string | null
          email: string | null
          id: string
          note: string | null
          payment_id: string | null
          rental_id: string | null
          renter_name: string | null
          status: string
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
          why: string
        }
        Insert: {
          amount_cents: number
          assigned_by?: string | null
          created_at?: string
          currency?: string
          dismissed_by?: string | null
          email?: string | null
          id?: string
          note?: string | null
          payment_id?: string | null
          rental_id?: string | null
          renter_name?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          why: string
        }
        Update: {
          amount_cents?: number
          assigned_by?: string | null
          created_at?: string
          currency?: string
          dismissed_by?: string | null
          email?: string | null
          id?: string
          note?: string | null
          payment_id?: string | null
          rental_id?: string | null
          renter_name?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          why?: string
        }
        Relationships: [
          {
            foreignKeyName: "unmatched_stripe_payments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unmatched_stripe_payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
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
      vehicle_autofill_events: {
        Row: {
          actor: string
          batch_id: string | null
          confidence: string
          created_at: string
          doc_class: string | null
          document_id: string | null
          evidence_raw: string | null
          field: string
          id: string
          new_value: string
          page: number | null
          previous_value: string | null
          proposal_id: string | null
          undo_result: string | null
          undone_at: string | null
          undone_by: string | null
          vehicle_id: string
        }
        Insert: {
          actor?: string
          batch_id?: string | null
          confidence: string
          created_at?: string
          doc_class?: string | null
          document_id?: string | null
          evidence_raw?: string | null
          field: string
          id?: string
          new_value: string
          page?: number | null
          previous_value?: string | null
          proposal_id?: string | null
          undo_result?: string | null
          undone_at?: string | null
          undone_by?: string | null
          vehicle_id: string
        }
        Update: {
          actor?: string
          batch_id?: string | null
          confidence?: string
          created_at?: string
          doc_class?: string | null
          document_id?: string | null
          evidence_raw?: string | null
          field?: string
          id?: string
          new_value?: string
          page?: number | null
          previous_value?: string | null
          proposal_id?: string | null
          undo_result?: string | null
          undone_at?: string | null
          undone_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_autofill_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_autofill_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_defaults: {
        Row: {
          body_type: string
          created_at: string
          deposit: number | null
          monthly_rate: number | null
          updated_at: string
          updated_by: string | null
          weekly_rate: number | null
        }
        Insert: {
          body_type: string
          created_at?: string
          deposit?: number | null
          monthly_rate?: number | null
          updated_at?: string
          updated_by?: string | null
          weekly_rate?: number | null
        }
        Update: {
          body_type?: string
          created_at?: string
          deposit?: number | null
          monthly_rate?: number | null
          updated_at?: string
          updated_by?: string | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      vehicle_downtime: {
        Row: {
          created_at: string
          ended_at: string | null
          ended_by: string | null
          id: string
          maintenance_record_id: string | null
          reason: string
          started_at: string
          started_by: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          maintenance_record_id?: string | null
          reason?: string
          started_at?: string
          started_by?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          maintenance_record_id?: string | null
          reason?: string
          started_at?: string
          started_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_downtime_maintenance_record_id_fkey"
            columns: ["maintenance_record_id"]
            isOneToOne: false
            referencedRelation: "maintenance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_downtime_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_downtime_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_public"
            referencedColumns: ["id"]
          },
        ]
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
          maintenance_record_id: string | null
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
          maintenance_record_id?: string | null
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
          maintenance_record_id?: string | null
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
            foreignKeyName: "vehicle_expenses_maintenance_record_id_fkey"
            columns: ["maintenance_record_id"]
            isOneToOne: false
            referencedRelation: "maintenance_records"
            referencedColumns: ["id"]
          },
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
          approved_at: string | null
          approved_by: string | null
          caption: string | null
          created_at: string
          derived_from_id: string | null
          enhancement_mode: string | null
          enhancement_provider: string | null
          file_name: string | null
          fleet_inbox_item_id: string | null
          generation_model: string | null
          id: string
          is_primary: boolean
          kind: string
          mime_type: string | null
          photo_class: string | null
          processing_ms: number | null
          provenance: string
          published: boolean
          quality_flags: Json
          review_status: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shot_slot: string | null
          size_bytes: number | null
          sort_order: number
          source_media_ids: string[]
          storage_bucket: string
          storage_path: string
          studio_check: Json | null
          studio_review_status: string | null
          uploaded_by: string | null
          vehicle_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          caption?: string | null
          created_at?: string
          derived_from_id?: string | null
          enhancement_mode?: string | null
          enhancement_provider?: string | null
          file_name?: string | null
          fleet_inbox_item_id?: string | null
          generation_model?: string | null
          id?: string
          is_primary?: boolean
          kind: string
          mime_type?: string | null
          photo_class?: string | null
          processing_ms?: number | null
          provenance?: string
          published?: boolean
          quality_flags?: Json
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shot_slot?: string | null
          size_bytes?: number | null
          sort_order?: number
          source_media_ids?: string[]
          storage_bucket?: string
          storage_path: string
          studio_check?: Json | null
          studio_review_status?: string | null
          uploaded_by?: string | null
          vehicle_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          caption?: string | null
          created_at?: string
          derived_from_id?: string | null
          enhancement_mode?: string | null
          enhancement_provider?: string | null
          file_name?: string | null
          fleet_inbox_item_id?: string | null
          generation_model?: string | null
          id?: string
          is_primary?: boolean
          kind?: string
          mime_type?: string | null
          photo_class?: string | null
          processing_ms?: number | null
          provenance?: string
          published?: boolean
          quality_flags?: Json
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shot_slot?: string | null
          size_bytes?: number | null
          sort_order?: number
          source_media_ids?: string[]
          storage_bucket?: string
          storage_path?: string
          studio_check?: Json | null
          studio_review_status?: string | null
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
      vehicle_titles: {
        Row: {
          title_number: string | null
          title_status: string | null
          updated_at: string
          updated_by: string | null
          vehicle_id: string
        }
        Insert: {
          title_number?: string | null
          title_status?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
        }
        Update: {
          title_number?: string | null
          title_status?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_titles_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: true
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_titles_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: true
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
          title_on_file: boolean
          title_status: string | null
          toll_account: string | null
          toll_transponder_id: string | null
          trim: string | null
          uber_eligibility: string[] | null
          unit_number: string | null
          vin: string | null
          weekly_rate: number | null
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
          title_on_file?: boolean
          title_status?: string | null
          toll_account?: string | null
          toll_transponder_id?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          unit_number?: string | null
          vin?: string | null
          weekly_rate?: number | null
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
          title_on_file?: boolean
          title_status?: string | null
          toll_account?: string | null
          toll_transponder_id?: string | null
          trim?: string | null
          uber_eligibility?: string[] | null
          unit_number?: string | null
          vin?: string | null
          weekly_rate?: number | null
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
          name_key: string | null
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
          name_key?: string | null
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
          name_key?: string | null
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
          review_flagged_at: string | null
          review_reason: string | null
          sms_consent: boolean
          sms_consent_at: string | null
          sms_consent_page: string | null
          sms_consent_phone: string | null
          sms_consent_source: string | null
          sms_consent_text: string | null
          sms_consent_version: string | null
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
          review_flagged_at?: string | null
          review_reason?: string | null
          sms_consent?: boolean
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
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
          review_flagged_at?: string | null
          review_reason?: string | null
          sms_consent?: boolean
          sms_consent_at?: string | null
          sms_consent_page?: string | null
          sms_consent_phone?: string | null
          sms_consent_source?: string | null
          sms_consent_text?: string | null
          sms_consent_version?: string | null
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
      lead_activity: {
        Row: {
          activity_type: string | null
          application_id: string | null
          direction: string | null
          line_e164: string | null
          line_label: string | null
          occurred_at: string | null
          phone_number_id: string | null
          recording_url: string | null
          source_id: string | null
          source_table: string | null
          status: string | null
          summary: string | null
          template: string | null
        }
        Relationships: []
      }
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
      activate_rental_checked_tx: {
        Args: {
          _actor: string
          _application_id: string
          _audit: Json
          _deposit: number
          _deposit_held: boolean
          _driver_id: string
          _end: string
          _insurance_exception_ack: boolean
          _pickup_miles: number
          _start: string
          _vehicle_id: string
          _weekly_rate: number
        }
        Returns: Json
      }
      activate_rental_tx: {
        Args: {
          _actor?: string
          _application_id: string
          _deposit: number
          _deposit_held: boolean
          _driver_id: string
          _end: string
          _pickup_miles?: number
          _start: string
          _vehicle_id: string
          _weekly_rate: number
        }
        Returns: string
      }
      add_collection_attachment: {
        Args: {
          _actor: string
          _file_name: string
          _item_id: string
          _mime: string
          _path: string
        }
        Returns: string
      }
      add_collection_item: {
        Args: {
          _actor: string
          _amount: number
          _application_id: string
          _description: string
          _incurred_on: string
          _notes: string
          _reason: string
          _rental_id: string
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
      apply_payment_to_collections: {
        Args: { _payment_id: string }
        Returns: number
      }
      apply_rental_rate_amendment: {
        Args: { _id: string; _today: string }
        Returns: string
      }
      automation_cron_health: {
        Args: never
        Returns: {
          active: boolean
          jobname: string
          last_run_at: string
          last_status: string
        }[]
      }
      cars_available: { Args: never; Returns: number }
      collection_actor_label: { Args: { _actor: string }; Returns: string }
      collection_log: {
        Args: {
          _actor: string
          _amount: number
          _from: string
          _item: string
          _kind: string
          _note: string
          _payment: string
          _to: string
        }
        Returns: undefined
      }
      collection_reason_for_payment: {
        Args: { _reason: string; _type: string }
        Returns: string
      }
      collection_recalc_item: {
        Args: { _actor?: string; _item: string }
        Returns: undefined
      }
      collection_rent_row_covered: {
        Args: { _payment: string }
        Returns: boolean
      }
      collection_status_is_open: { Args: { _s: string }; Returns: boolean }
      collections_apply_proration: {
        Args: { _actor?: string; _rental_id: string }
        Returns: number
      }
      complete_rental_vehicle_swap_tx: {
        Args: {
          _actor: string
          _from_vehicle_status: string
          _pickup_fuel: string
          _pickup_miles: number
          _return_fuel: string
          _return_miles: number
          _swap_id: string
        }
        Returns: Json
      }
      driver_deletion_blocker: { Args: { _id: string }; Returns: string }
      email_delivery_attach: {
        Args: { _id: string; _resend_id: string }
        Returns: undefined
      }
      email_delivery_claim_pending: {
        Args: {
          _recipient: string
          _resend_id: string
          _sent_at: string
          _subject: string
        }
        Returns: string
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
        Args: {
          _actor?: string
          _end: string
          _rental_id: string
          _return_miles?: number
          _vehicle_status: string
        }
        Returns: string
      }
      esign_claim: {
        Args: { _id: string; _token_hash: string }
        Returns: string
      }
      esign_void: { Args: { _id: string }; Returns: string }
      fin__basis: { Args: { _type: string }; Returns: string }
      fin__insert: {
        Args: {
          _corrects: string
          _idem: string
          _p: Json
          _reverses: string
          _status: string
        }
        Returns: string
      }
      fin__log: {
        Args: {
          _after: Json
          _before: Json
          _event: string
          _from: string
          _id: string
          _reason: string
          _to: string
        }
        Returns: undefined
      }
      fin__require: { Args: { _sensitivity: string }; Returns: undefined }
      fin__reverse: {
        Args: { _final: string; _id: string; _idem: string; _reason: string }
        Returns: string
      }
      fin_add_evidence: { Args: { _e: Json; _id: string }; Returns: string }
      fin_confirm: { Args: { _id: string }; Returns: string }
      fin_correct: {
        Args: { _id: string; _idem: string; _p: Json; _reason: string }
        Returns: string
      }
      fin_discard: { Args: { _id: string; _reason: string }; Returns: string }
      fin_post: {
        Args: { _cash: string; _id: string; _recognition: string }
        Returns: string
      }
      fin_propose: { Args: { _idem: string; _p: Json }; Returns: string }
      fin_reverse: {
        Args: { _id: string; _idem: string; _reason: string }
        Returns: string
      }
      fin_settle: {
        Args: {
          _amount: number
          _idem: string
          _obligation: string
          _payment: string
        }
        Returns: string
      }
      fin_unsettle: {
        Args: { _reason: string; _settlement: string }
        Returns: string
      }
      finish_application_recovery: {
        Args: { _attempt_id: string; _provider_id?: string; _status: string }
        Returns: undefined
      }
      fleet_inbox_acquire_lease: {
        Args: { _seconds: number }
        Returns: boolean
      }
      fleet_inbox_claim_jobs: {
        Args: { _lease_seconds: number; _limit: number }
        Returns: {
          attempts: number
          batch_id: string
          created_at: string
          finished_at: string | null
          id: string
          item_id: string
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          max_attempts: number
          next_run_at: string
          source: string
          state: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "fleet_inbox_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fleet_inbox_disarm_if_idle: { Args: never; Returns: boolean }
      fleet_inbox_release_lease: {
        Args: { _summary: Json }
        Returns: undefined
      }
      fleet_inbox_wake: { Args: never; Returns: undefined }
      get_cron_token: { Args: { _name: string }; Returns: string }
      move_payment_to_collections: {
        Args: { _actor?: string; _note?: string; _payment_id: string }
        Returns: number
      }
      move_rental_to_collections: {
        Args: { _actor?: string; _note?: string; _rental_id: string }
        Returns: number
      }
      next_unit_number: { Args: { _prefix?: string }; Returns: string }
      normalize_driver_email: { Args: { raw: string }; Returns: string }
      normalize_driver_phone: { Args: { raw: string }; Returns: string }
      normalize_driver_state: { Args: { raw: string }; Returns: string }
      normalize_driver_zip: { Args: { raw: string }; Returns: string }
      promote_waitlist_entry: { Args: { _entry: string }; Returns: Json }
      purge_application: { Args: { _id: string }; Returns: Json }
      record_checklist_evidence: {
        Args: {
          _application_id: string
          _expected_revision: number
          _field: string
          _idempotency_key: string
          _note: string
          _source: string
          _state: string
        }
        Returns: Json
      }
      record_rental_repossession: {
        Args: {
          _actor?: string
          _note?: string
          _rental_id: string
          _repo_date: string
        }
        Returns: Json
      }
      rental_at_time: {
        Args: { _at: string; _vehicle_id: string }
        Returns: string
      }
      renter_blacklist_check: {
        Args: { _application_id: string }
        Returns: Json
      }
      renter_blacklist_suppressed: {
        Args: { _application_id: string; _email: string; _phone: string }
        Returns: boolean
      }
      renter_portal_file: {
        Args: { _id: string; _kind: string }
        Returns: {
          storage_bucket: string
          storage_path: string
        }[]
      }
      renter_portal_summary: { Args: never; Returns: Json }
      reserve_application_recovery: {
        Args: { _application_id: string; _token_hash: string }
        Returns: Json
      }
      resolve_application_identity_review: {
        Args: { _note: string; _resolution: string; _review_id: string }
        Returns: Json
      }
      resolve_waitlist_phone_conflict: {
        Args: {
          _actor: string
          _actor_email: string
          _actor_role: string
          _application: string
          _entry: string
          _expected_application_phone: string
          _expected_waitlist_phone: string
          _reason: string
          _use_waitlist_phone: boolean
        }
        Returns: Json
      }
      restore_application: { Args: { _id: string }; Returns: Json }
      set_collection_item_status: {
        Args: {
          _actor: string
          _expected?: string
          _item_id: string
          _note?: string
          _to: string
        }
        Returns: string
      }
      set_insurance_verification: {
        Args: { _application_id: string; _note: string; _verified: boolean }
        Returns: Json
      }
      set_legal_hold: { Args: { _id: string; _on: boolean }; Returns: Json }
      set_rental_activation_insurance_exception: {
        Args: { _allow: boolean }
        Returns: Json
      }
      soft_delete_application: {
        Args: { _id: string; _reason: string }
        Returns: Json
      }
      submission_accepts_uploads: {
        Args: { _submission_id: string }
        Returns: boolean
      }
      sync_vehicle_photos: { Args: { _vehicle_id: string }; Returns: undefined }
      update_collection_item: {
        Args: {
          _actor: string
          _amount: number
          _description: string
          _item_id: string
          _notes: string
          _reason: string
        }
        Returns: undefined
      }
      vehicle_listing_ready_missing: {
        Args: { _vehicle_id: string }
        Returns: string[]
      }
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
      vehicle_rental_ready_missing: {
        Args: { _vehicle_id: string }
        Returns: string[]
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
