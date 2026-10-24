-- PROPOSED. Record Rental evidence gateway: the fixed-operation alternative to the
-- rr_evidence_transport TCP login, for hosts that cannot open a verified TLS socket to
-- Postgres (a Lovable Cloud Worker: cloudflare:sockets verifies against public roots
-- only, and Supabase Postgres certificates chain to Supabase's own CA).
-- Owner approval required. Run after M2 Window 2 has verified. One transaction.
--
-- What it is: two PostgREST RPCs, reached over the platform's public HTTPS endpoint
-- with the staff member's own JWT.
--   public.record_evidence_gateway_v1  owned by rr_evidence_issuer:
--     snapshot, issue, bind, identity, recover
--   public.record_license_gateway_v1   owned by rr_approval_executor:
--     licenseSnapshot, verifyLicense
-- Each call names one of those operations; its arguments are typed and passed to the
-- one fixed function for it. There is no statement text, no dynamic SQL, and no way
-- to name any other function, table or role: not a generic SQL endpoint.
--
-- Why a browser cannot use it: every request carries an HMAC-SHA256 over the
-- operation, the exact argument text, the staff actor and session that PostgREST
-- verified from the JWT, a millisecond timestamp and a single-use nonce. The key is a
-- server secret (RECORD_RENTAL_EVIDENCE_GATEWAY_KEY) held only by the Worker and in
-- private.record_gateway_key_v1. A request older than 60 s, replayed, signed for a
-- different actor or session, or without a valid MAC is refused before any work.
-- The M2 trust checks then run unchanged: private.approval_provider_actor accepts the
-- PostgREST gateway context (authenticator / authenticated, live session, Owner or
-- Manager), and the issuer functions see current_user = rr_evidence_issuer (or
-- rr_approval_executor) because the wrapper is SECURITY DEFINER owned by that role.
-- Holding the key is equivalent to holding the rr_evidence_transport password.
--
-- The key is inserted separately (02-set-gateway-key.sql), never in this file.
BEGIN;

CREATE TABLE private.record_gateway_key_v1 (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  key bytea NOT NULL CHECK (octet_length(key) >= 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE private.record_gateway_nonce_v1 (
  nonce uuid PRIMARY KEY,
  actor uuid NOT NULL,
  op text NOT NULL,
  used_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX record_gateway_nonce_v1_actor ON private.record_gateway_nonce_v1 (actor, used_at);
ALTER TABLE private.record_gateway_key_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.record_gateway_nonce_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.record_gateway_key_v1, private.record_gateway_nonce_v1 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.record_gateway_key_v1 TO rr_evidence_issuer, rr_approval_executor;
GRANT SELECT, INSERT, DELETE ON private.record_gateway_nonce_v1 TO rr_evidence_issuer, rr_approval_executor;
CREATE POLICY gateway_key_read ON private.record_gateway_key_v1 FOR SELECT TO rr_evidence_issuer, rr_approval_executor USING (true);
CREATE POLICY gateway_nonce_use ON private.record_gateway_nonce_v1 FOR ALL TO rr_evidence_issuer, rr_approval_executor USING (true) WITH CHECK (true);

-- HMAC-SHA256 (RFC 2104) over the built-in sha256(), so the gateway needs no extension
-- schema privileges. Keys longer than the 64-byte block are hashed first.
CREATE FUNCTION private.hmac_sha256_v1(k bytea, m bytea) RETURNS bytea
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE ipad bytea; opad bytea; i integer;
BEGIN
  IF octet_length(k) > 64 THEN k := pg_catalog.sha256(k); END IF;
  k := k || pg_catalog.decode(repeat('00', 64 - octet_length(k)), 'hex');
  ipad := k; opad := k;
  FOR i IN 0..63 LOOP
    ipad := set_byte(ipad, i, get_byte(k, i) # 54);
    opad := set_byte(opad, i, get_byte(k, i) # 92);
  END LOOP;
  RETURN pg_catalog.sha256(opad || pg_catalog.sha256(ipad || m));
END $$;
REVOKE ALL ON FUNCTION private.hmac_sha256_v1(bytea, bytea) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.hmac_sha256_v1(bytea, bytea) TO rr_evidence_issuer, rr_approval_executor;

-- Runs as the calling wrapper's owner (SECURITY INVOKER). Returns the parsed arguments.
CREATE FUNCTION private.record_gateway_check_v1(_op text, _args text, _issued_ms bigint, _nonce uuid, _mac text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE k bytea; caller uuid; sid uuid; msg text; a jsonb;
BEGIN
  -- The PostgREST-verified staff session: Owner or Manager, live, not a Coordinator.
  caller := private.approval_actor(); sid := private.record_session_v1();
  IF _issued_ms IS NULL OR abs(extract(epoch FROM clock_timestamp()) * 1000 - _issued_ms) > 60000 THEN
    RAISE EXCEPTION 'gateway_request_stale' USING ERRCODE = '42501'; END IF;
  SELECT key INTO k FROM private.record_gateway_key_v1;
  IF k IS NULL THEN RAISE EXCEPTION 'gateway_not_provisioned' USING ERRCODE = '42501'; END IF;
  msg := concat_ws(E'\n', 'record-evidence-gateway-v1', _op, caller::text, sid::text, _issued_ms::text, _nonce::text, _args);
  -- Compared through a second hash, so the comparison's timing says nothing about the MAC.
  IF _mac IS NULL OR _nonce IS NULL OR _args IS NULL OR _mac !~ '^[0-9a-f]{64}$'
     OR pg_catalog.sha256(convert_to(_mac, 'UTF8'))
        IS DISTINCT FROM pg_catalog.sha256(convert_to(encode(private.hmac_sha256_v1(k, convert_to(msg, 'UTF8')), 'hex'), 'UTF8')) THEN
    RAISE EXCEPTION 'gateway_signature_invalid' USING ERRCODE = '42501'; END IF;
  INSERT INTO private.record_gateway_nonce_v1 (nonce, actor, op) VALUES (_nonce, caller, _op) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'gateway_replay' USING ERRCODE = '42501'; END IF;
  -- At most 120 signed calls per staff member per minute (one recording uses about ten).
  IF (SELECT count(*) FROM private.record_gateway_nonce_v1 n WHERE n.actor = caller
      AND n.used_at > clock_timestamp() - interval '60 seconds') > 120 THEN
    RAISE EXCEPTION 'gateway_rate_limited' USING ERRCODE = '42501'; END IF;
  DELETE FROM private.record_gateway_nonce_v1 WHERE used_at < clock_timestamp() - interval '10 minutes';
  a := _args::jsonb;
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'gateway_arguments_invalid'; END IF;
  -- The same per-call scope the TCP transport sets; empty when absent, never inherited.
  PERFORM set_config('record.application_id', coalesce(a->>'scopeApplication', ''), true);
  PERFORM set_config('record.vehicle_id', coalesce(a->>'scopeVehicle', ''), true);
  RETURN a;
END $$;
REVOKE ALL ON FUNCTION private.record_gateway_check_v1(text, text, bigint, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.record_gateway_check_v1(text, text, bigint, uuid, text) TO rr_evidence_issuer, rr_approval_executor;

CREATE FUNCTION public.record_evidence_gateway_v1(_op text, _args text, _issued_ms bigint, _nonce uuid, _mac text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET "TimeZone" = 'UTC' AS $$
DECLARE a jsonb; r jsonb;
BEGIN
  IF current_user <> 'rr_evidence_issuer' THEN RAISE EXCEPTION 'gateway_owner_invalid'; END IF;
  a := private.record_gateway_check_v1(_op, _args, _issued_ms, _nonce, _mac);
  CASE _op
    WHEN 'snapshot' THEN r := private.record_snapshot_v1((a->>'a')::uuid, (a->>'v')::uuid, (a->>'g')::uuid, (a->>'d')::uuid);
    WHEN 'issue' THEN r := to_jsonb(private.issue_record_evidence_v1(a->'req', a->'verified', a->'snapshot'));
    WHEN 'bind' THEN r := private.bind_document_integrity_v1((a->>'document')::uuid, a->'expected', a->>'sha', a->>'path', (a->>'agreement')::uuid);
    WHEN 'identity' THEN r := private.record_identity_reader_v2((a->>'application')::uuid);
    WHEN 'recover' THEN r := to_jsonb(private.recover_record_evidence_v1((a->>'operation')::uuid));
    ELSE RAISE EXCEPTION 'gateway_operation_refused' USING ERRCODE = '42501';
  END CASE;
  RETURN jsonb_build_object('value', r);
END $$;

CREATE FUNCTION public.record_license_gateway_v1(_op text, _args text, _issued_ms bigint, _nonce uuid, _mac text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET "TimeZone" = 'UTC' AS $$
DECLARE a jsonb; r jsonb;
BEGIN
  IF current_user <> 'rr_approval_executor' THEN RAISE EXCEPTION 'gateway_owner_invalid'; END IF;
  a := private.record_gateway_check_v1(_op, _args, _issued_ms, _nonce, _mac);
  CASE _op
    WHEN 'licenseSnapshot' THEN r := private.license_snapshot_v1((a->>'application')::uuid);
    WHEN 'verifyLicense' THEN r := to_jsonb(private.verify_license_v1((a->>'application')::uuid, a->'expected'));
    ELSE RAISE EXCEPTION 'gateway_operation_refused' USING ERRCODE = '42501';
  END CASE;
  RETURN jsonb_build_object('value', r);
END $$;

-- Ownership. On hosted Supabase the installer (postgres) is not a superuser, so ALTER
-- OWNER needs SET ROLE to the new owner, and the owner needs CREATE on the schema. Both
-- are lent for these two statements only and taken back in this transaction. Checked on
-- the hosted rehearsal project (PG 17): without the loan ALTER OWNER is refused; after
-- the revoke the installer keeps only its implicit creator grant (ADMIN, no SET/INHERIT).
DO $$ BEGIN EXECUTE format('GRANT rr_evidence_issuer, rr_approval_executor TO %I WITH INHERIT FALSE, SET TRUE', current_user); END $$;
GRANT CREATE ON SCHEMA public TO rr_evidence_issuer, rr_approval_executor;
ALTER FUNCTION public.record_evidence_gateway_v1(text, text, bigint, uuid, text) OWNER TO rr_evidence_issuer;
ALTER FUNCTION public.record_license_gateway_v1(text, text, bigint, uuid, text) OWNER TO rr_approval_executor;
REVOKE CREATE ON SCHEMA public FROM rr_evidence_issuer, rr_approval_executor;
DO $$ BEGIN EXECUTE format('REVOKE rr_evidence_issuer, rr_approval_executor FROM %I', current_user); END $$;
REVOKE ALL ON FUNCTION public.record_evidence_gateway_v1(text, text, bigint, uuid, text),
  public.record_license_gateway_v1(text, text, bigint, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_evidence_gateway_v1(text, text, bigint, uuid, text),
  public.record_license_gateway_v1(text, text, bigint, uuid, text) TO authenticated;

-- Verify before COMMIT: owners as reviewed, no CREATE left on public, browser roles
-- cannot read the key.
DO $$ BEGIN
  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.record_evidence_gateway_v1(text,text,bigint,uuid,text)'::regprocedure)) <> 'rr_evidence_issuer'
     OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.record_license_gateway_v1(text,text,bigint,uuid,text)'::regprocedure)) <> 'rr_approval_executor'
     OR has_schema_privilege('rr_evidence_issuer', 'public', 'CREATE') OR has_schema_privilege('rr_approval_executor', 'public', 'CREATE')
     OR has_table_privilege('authenticated', 'private.record_gateway_key_v1', 'SELECT')
     OR has_table_privilege('service_role', 'private.record_gateway_key_v1', 'SELECT')
     OR (NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
         AND (pg_has_role(current_user, 'rr_evidence_issuer', 'SET') OR pg_has_role(current_user, 'rr_approval_executor', 'SET')))
  THEN RAISE EXCEPTION 'record evidence gateway shape is not as reviewed'; END IF;
END $$;
COMMIT;
