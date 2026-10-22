-- LOCAL VERSIONED PROPOSAL ONLY. Install together with null-aware settlement/portal consumers.
-- Preserve defaults for legacy known-zero creation; no data backfill or lifecycle replacement.
ALTER TABLE public.rentals ALTER COLUMN deposit_amount DROP NOT NULL;
ALTER TABLE public.rentals ALTER COLUMN deposit_held DROP NOT NULL;
