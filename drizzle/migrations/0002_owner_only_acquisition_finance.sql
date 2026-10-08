-- Owner-only boundary for acquisition finance, liens, payoffs and ownership paperwork.
CREATE OR REPLACE FUNCTION private.is_ownership_finance_kind(_kind text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT coalesce(_kind, '') IN ('lien_release','purchase','purchase_agreement','bill_of_sale','purchase_document','loan_document','payoff_statement','lender_statement')
$$;

CREATE OR REPLACE FUNCTION private.vehicle_doc_object_owner_only(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_bucket = 'vehicle-docs' AND d.storage_path = _path
    AND (private.is_ownership_finance_kind(d.kind) OR private.is_ownership_finance_kind(d.category)))
$$;

DROP POLICY IF EXISTS "Managers manage vehicle finance" ON public.vehicle_finance;
CREATE POLICY "Owners manage vehicle finance" ON public.vehicle_finance FOR ALL TO authenticated
  USING (private.is_owner()) WITH CHECK (private.is_owner());

DROP POLICY IF EXISTS "Managers read fleet finance facts" ON public.fleet_import_finance_facts;
CREATE POLICY "Owners read fleet finance facts" ON public.fleet_import_finance_facts FOR SELECT TO authenticated
  USING (private.is_owner());

-- Raw extraction can carry lien/purchase values; the app reads these only through server functions that redact by tier.
DROP POLICY IF EXISTS "Managers read fleet import items" ON public.fleet_import_items;
CREATE POLICY "Owners read fleet import items" ON public.fleet_import_items FOR SELECT TO authenticated USING (private.is_owner());
DROP POLICY IF EXISTS "Managers read fleet import proposals" ON public.fleet_import_proposals;
CREATE POLICY "Owners read fleet import proposals" ON public.fleet_import_proposals FOR SELECT TO authenticated USING (private.is_owner());

DROP POLICY IF EXISTS "Staff read vehicle provenance" ON public.vehicle_field_provenance;
CREATE POLICY "Staff read vehicle provenance" ON public.vehicle_field_provenance FOR SELECT TO authenticated USING (
  private.is_staff()
  AND (field <> ALL (ARRAY['legal_owner','lienholder','purchase_price','purchase_date','payoff_amount','loan_reference','monthly_payment','loan_maturity_date','seller_dealer','ownership_type']) OR private.is_owner())
  AND (field <> ALL (ARRAY['service.total','service.labor_total','service.parts_total','service.tax_total']) OR private.is_manager())
);

DROP POLICY IF EXISTS "Staff manage applicant documents" ON public.documents;
CREATE POLICY "Staff manage applicant documents" ON public.documents FOR ALL TO authenticated
  USING (private.is_staff() AND (category <> 'verification_recording' OR private.is_owner())
         AND ((NOT private.is_ownership_finance_kind(kind) AND NOT private.is_ownership_finance_kind(category)) OR private.is_owner()))
  WITH CHECK (private.is_staff() AND (category <> 'verification_recording' OR private.is_owner())
         AND ((NOT private.is_ownership_finance_kind(kind) AND NOT private.is_ownership_finance_kind(category)) OR private.is_owner()));

DROP POLICY IF EXISTS "Managers manage vehicle doc objects" ON storage.objects;
CREATE POLICY "Managers manage vehicle doc objects" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'vehicle-docs' AND private.is_manager() AND (private.is_owner() OR NOT private.vehicle_doc_object_owner_only(name)))
  WITH CHECK (bucket_id = 'vehicle-docs' AND private.is_manager());

DROP POLICY IF EXISTS "Staff manage operational vehicle doc objects" ON storage.objects;
CREATE POLICY "Staff manage operational vehicle doc objects" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'vehicle-docs' AND private.is_staff() AND NOT private.vehicle_doc_object_restricted(name) AND NOT private.vehicle_doc_object_owner_only(name))
  WITH CHECK (bucket_id = 'vehicle-docs' AND private.is_staff());