UPDATE public.applications SET status = 'new' WHERE status IS NULL OR status NOT IN ('new','reviewing','approved','active','suspended','declined','closed','partial');
UPDATE public.applications SET status = 'new' WHERE status = 'complete';
ALTER TABLE public.applications ALTER COLUMN status SET DEFAULT 'new';