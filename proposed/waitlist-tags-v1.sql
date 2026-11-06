-- Apply after the older Application Resume migration history is reconciled.
-- Additive only: existing Waitlist people, status, city, source and history stay unchanged.
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.waitlist
  ADD CONSTRAINT waitlist_tags_limit CHECK (cardinality(tags) <= 12);
