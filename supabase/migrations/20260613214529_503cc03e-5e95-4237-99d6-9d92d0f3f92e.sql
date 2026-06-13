CREATE TABLE public.fleet_owner_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  vin text NOT NULL,
  year int NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  trim text,
  mileage int,
  title_status text,
  lien_status text,
  registration_state text,
  currently_insured boolean,
  condition text,
  photo_urls text[] NOT NULL DEFAULT '{}',
  message text,
  status text NOT NULL DEFAULT 'new',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.fleet_owner_submissions TO authenticated;
GRANT INSERT ON public.fleet_owner_submissions TO anon;
GRANT ALL ON public.fleet_owner_submissions TO service_role;

ALTER TABLE public.fleet_owner_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a vehicle"
  ON public.fleet_owner_submissions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can view submissions"
  ON public.fleet_owner_submissions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update submissions"
  ON public.fleet_owner_submissions FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));