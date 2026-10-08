-- Original title documents: stored file is Owner only; Managers keep metadata (on file / missing / status).
CREATE OR REPLACE FUNCTION private.vehicle_doc_object_owner_only(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_bucket = 'vehicle-docs' AND d.storage_path = _path
    AND (private.is_ownership_finance_kind(d.kind) OR private.is_ownership_finance_kind(d.category)
         OR coalesce(d.kind,'') = 'title' OR coalesce(d.category,'') = 'title'))
$$;