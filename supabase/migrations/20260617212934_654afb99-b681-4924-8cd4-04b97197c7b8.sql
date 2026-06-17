ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS fuel_type text NOT NULL DEFAULT 'gas';
UPDATE public.vehicles SET fuel_type = 'hybrid' WHERE lower(model) IN ('prius','rav4 hybrid','camry hybrid','accord hybrid','sienna');
UPDATE public.vehicles SET fuel_type = 'ev' WHERE lower(model) IN ('model 3','model y','bolt','leaf','mach-e','ioniq 5');