-- PROPOSED — NOT APPLIED. Title document metadata, Owner-only (audit finding S2).
-- Number: assigned at approval time (next free after the journal; never 0022,
-- which is reserved for Codex's Application Resume release).
--
-- WHY
-- Three layers already agree that a vehicle TITLE is the Owner's alone:
--
--   storage   private.vehicle_doc_object_owner_only(name) — includes 'title'
--   server    getFleetDocumentFile / listVehicleDocs / registerVehicleDoc /
--             deleteVehicleDoc — now all use isOwnerOnlyDocKind, which
--             includes 'title'
--   RLS       public.documents "Staff manage applicant documents" — gates on
--             private.is_ownership_finance_kind(kind), which does NOT
--
-- is_ownership_finance_kind lists only:
--   lien_release, purchase, purchase_agreement, bill_of_sale,
--   purchase_document, loan_document, payoff_statement, lender_statement
--
-- So the FILE is unreachable for a Coordinator, but the documents ROW is not:
-- via direct PostgREST they can read a title document's label, file_name,
-- storage_path and notes. Metadata only — the title number and status live in
-- Owner-only public.vehicle_titles — but the row should not be readable either.
--
-- WHAT THIS DOES
-- Adds 'title' to the ownership-finance kind list, which immediately tightens
-- the documents policy, vehicle_doc_object_owner_only and every other caller,
-- without editing any policy body.
CREATE OR REPLACE FUNCTION private.is_ownership_finance_kind(_kind text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(_kind, '') IN ('title','lien_release','purchase','purchase_agreement','bill_of_sale','purchase_document','loan_document','payoff_statement','lender_statement')
$function$;

-- BEFORE APPLYING, CHECK THIS ONE SIDE EFFECT
-- isFinanceKind() in src/lib/vehicle-doc-presence.ts derives the Owner-only
-- SLOT list from FINANCE_SLOTS (purchase, lien_release) and is deliberately
-- NOT changed by this migration — staff must keep seeing that a title is on
-- file, which is what vehicles.title_on_file is for. But listVehicleDocs
-- reads documents with the service role, so after this change a Coordinator's
-- Title row keeps rendering while the underlying row becomes unreadable to
-- their own JWT. That is the intended end state; confirm the Documents tab
-- still shows "Title — On file" for a Coordinator before shipping.
--
-- Verify after applying, as a Coordinator JWT (expect 0 rows):
--   SELECT id FROM public.documents WHERE kind = 'title' OR category = 'title';
--
-- ROLLBACK (separate approval): restore the original list, i.e. the same
-- function body without 'title'.
