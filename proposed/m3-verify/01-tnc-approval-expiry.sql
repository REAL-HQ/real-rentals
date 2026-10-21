-- Verify for HOSTED-INSTALL step 1: proposed/m3-packet/01-tnc-approval-expiry.sql
-- Read-only. One row, ok true, after that step commits.

SELECT (
  (
    SELECT count(*)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'applications'
      AND c.column_name IN ('tnc_uber_approval_expires_on', 'tnc_lyft_approval_expires_on')
      AND c.data_type = 'date'
      AND c.is_nullable = 'YES'
      AND c.column_default IS NULL
  ) = 2
  AND (
    SELECT count(*)
    FROM pg_catalog.pg_description d
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = d.objoid
     AND a.attnum = d.objsubid
    WHERE d.objoid = 'public.applications'::regclass
      AND a.attname = 'tnc_uber_approval_expires_on'
      AND d.description = 'Calendar day the driver Uber (TNC) approval expires.'
  ) = 1
  AND (
    SELECT count(*)
    FROM pg_catalog.pg_description d
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = d.objoid
     AND a.attnum = d.objsubid
    WHERE d.objoid = 'public.applications'::regclass
      AND a.attname = 'tnc_lyft_approval_expires_on'
      AND d.description = 'Calendar day the driver Lyft (TNC) approval expires.'
  ) = 1
  AND (
    SELECT count(*)
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.applications'::regclass
      AND a.attname IN ('tnc_uber_approval_expires_on', 'tnc_lyft_approval_expires_on')
      AND a.attacl IS NULL
      AND a.attnotnull IS FALSE
  ) = 2
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'public.applications'::regclass
      AND p.polname ILIKE '%tnc%'
  )
  AND (
    SELECT c.data_type = 'date' AND c.is_nullable = 'YES'
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'applications'
      AND c.column_name = 'license_expiration'
  )
  AND (
    SELECT c.data_type = 'date' AND c.is_nullable = 'YES'
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'applications'
      AND c.column_name = 'insurance_expires_on'
  )
) AS ok;
