-- Packet file. Local rehearsal applies it with psql -1. A hosted run follows proposed/HOSTED-INSTALL.md and runs this file as its own transaction.
-- New namespace only; no legacy paths, policy grants or security 0031 modifications.
CREATE FUNCTION private.storage_integrity_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'immutable_storage_truncate_denied'; END IF;
 IF OLD.name LIKE 'immutable-v1/%' THEN RAISE EXCEPTION 'immutable_object_overwrite_or_delete_denied'; END IF;
 IF TG_OP='UPDATE' AND NEW.name LIKE 'immutable-v1/%' THEN RAISE EXCEPTION 'immutable_object_requires_insert'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER storage_integrity_v1 BEFORE UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION private.storage_integrity_v1();
CREATE TRIGGER storage_integrity_truncate_v1 BEFORE TRUNCATE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION private.storage_integrity_v1();
-- Provider object-layer no-overwrite semantics must ALSO be accepted against actual Storage.
-- A PostgreSQL metadata trigger alone does not prove remote blob immutability.
