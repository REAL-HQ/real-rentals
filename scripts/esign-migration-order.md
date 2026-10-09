# eSign-related migration order (proposed — nothing applied, no numbers taken)

Numbers are assigned only after Codex's Application Resume 0022 is released.
Do not renumber or modify 0022; do not merge Codex release branches.

1. 0022 — Application Resume (Codex). Independent of eSign; must land first only because it owns the next number.
2. Template versioning — scripts/esign-template-versioning.proposed.sql
   + Template library — scripts/agreement-template-library.proposed.sql (fold into the same migration).
   Adds approval_status/effective_date/content_sha256, template_key, insurance_required, field_map,
   source_document_path, one-approved-per-key index, agreements.template_key/insurance_snapshot,
   rental_insurance_verifications. Unlocks: Approve/Retire per family, Save As Draft for uploads,
   staff insurance verification.
3. Agreement numbering — scripts/agreement-number.proposed.sql. Depends on (2) only for ordering
   (both touch public.agreements); independent logic. Unlocks: sending (RRA-000001…).
4. Vehicle Pricing — scripts/vehicle-pricing-templates.proposed.sql. Independent of eSign; follows
   only to keep numbering sequential.

Release still also needs: company legal details in Settings → Company, legal review of v1.10 /
v1.10.2, an explicit Service Area value, and Owner approval of one template version.
