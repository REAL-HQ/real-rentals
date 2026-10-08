-- Owner-only finance paperwork: block non-Owners from writing vehicle-docs objects
-- named for lien/purchase slots ({vehicleId}/lien_release-*, {vehicleId}/purchase-*),
-- matching private.is_ownership_finance_kind. Read rules unchanged.
DROP POLICY IF EXISTS "Managers manage vehicle doc objects" ON storage.objects;
CREATE POLICY "Managers manage vehicle doc objects" ON storage.objects
  FOR ALL TO authenticated
  USING ((bucket_id = 'vehicle-docs') AND private.is_manager() AND (private.is_owner() OR (NOT private.vehicle_doc_object_owner_only(name))))
  WITH CHECK ((bucket_id = 'vehicle-docs') AND private.is_manager()
    AND (private.is_owner() OR split_part(name, '/', 2) !~ '^(lien_release|purchase|purchase_agreement|bill_of_sale|purchase_document|loan_document|payoff_statement|lender_statement)-'));
DROP POLICY IF EXISTS "Staff manage operational vehicle doc objects" ON storage.objects;
CREATE POLICY "Staff manage operational vehicle doc objects" ON storage.objects
  FOR ALL TO authenticated
  USING ((bucket_id = 'vehicle-docs') AND private.is_staff() AND (NOT private.vehicle_doc_object_restricted(name)) AND (NOT private.vehicle_doc_object_owner_only(name)))
  WITH CHECK ((bucket_id = 'vehicle-docs') AND private.is_staff()
    AND (private.is_owner() OR split_part(name, '/', 2) !~ '^(lien_release|purchase|purchase_agreement|bill_of_sale|purchase_document|loan_document|payoff_statement|lender_statement)-'));