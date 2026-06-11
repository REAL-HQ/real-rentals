
-- Enum for roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- User roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Vehicles
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  trim text,
  body_type text,
  mpg int,
  weekly_rate numeric NOT NULL,
  monthly_rate numeric,
  deposit numeric DEFAULT 249,
  status text NOT NULL DEFAULT 'available',
  badges text[] DEFAULT '{}',
  photos text[] DEFAULT '{}',
  description text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.vehicles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
GRANT ALL ON public.vehicles TO service_role;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vehicles are publicly readable" ON public.vehicles FOR SELECT USING (true);
CREATE POLICY "Admins can manage vehicles" ON public.vehicles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Applications
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  dob date,
  address text,
  city text,
  state text,
  zip text,
  license_number text,
  license_state text,
  license_expiration date,
  years_licensed int,
  license_photo_url text,
  platforms text[],
  weekly_hours int,
  platform_active boolean,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  start_date date,
  rental_term text,
  payment_method text,
  consent_gps boolean DEFAULT false,
  consent_background boolean DEFAULT false,
  consent_prepay boolean DEFAULT false,
  consent_terms boolean DEFAULT false,
  status text NOT NULL DEFAULT 'new',
  notes text,
  created_at timestamptz DEFAULT now()
);
GRANT INSERT ON public.applications TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.applications TO authenticated;
GRANT ALL ON public.applications TO service_role;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit applications" ON public.applications FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can view applications" ON public.applications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update applications" ON public.applications FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete applications" ON public.applications FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Contact leads
CREATE TABLE public.contact_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  message text,
  created_at timestamptz DEFAULT now()
);
GRANT INSERT ON public.contact_leads TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.contact_leads TO authenticated;
GRANT ALL ON public.contact_leads TO service_role;
ALTER TABLE public.contact_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit contact" ON public.contact_leads FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can view contact" ON public.contact_leads FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Investor leads
CREATE TABLE public.investor_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  capital_range text,
  vehicles_interested int,
  message text,
  created_at timestamptz DEFAULT now()
);
GRANT INSERT ON public.investor_leads TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.investor_leads TO authenticated;
GRANT ALL ON public.investor_leads TO service_role;
ALTER TABLE public.investor_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit investor" ON public.investor_leads FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can view investor" ON public.investor_leads FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed vehicles
INSERT INTO public.vehicles (year, make, model, body_type, mpg, weekly_rate, monthly_rate, badges, photos, description) VALUES
(2014, 'Toyota', 'Corolla', 'sedan', 32, 350, 1300, ARRAY['Uber & Lyft Ready','Fuel Efficient'], ARRAY['https://images.unsplash.com/photo-1623869675781-80aa31012a5a?w=1200&q=80'], 'Reliable, fuel-sipping sedan. Perfect for high-mileage rideshare work.'),
(2015, 'Toyota', 'Camry', 'sedan', 28, 375, 1400, ARRAY['Uber & Lyft Ready','Comfort'], ARRAY['https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=1200&q=80'], 'Spacious midsize sedan, riders love it. Bluetooth, backup camera, smooth ride.'),
(2013, 'Toyota', 'Prius', 'hybrid', 50, 395, 1500, ARRAY['Uber & Lyft Ready','Hybrid','Best MPG'], ARRAY['https://images.unsplash.com/photo-1617469767053-d3b523a0b982?w=1200&q=80'], 'Legendary hybrid economy. The driver favorite — 50 MPG means more profit per shift.'),
(2014, 'Honda', 'Civic', 'sedan', 33, 350, 1300, ARRAY['Uber & Lyft Ready','Fuel Efficient'], ARRAY['https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=1200&q=80'], 'Bulletproof reliability. Low cost of operation, easy to park.'),
(2013, 'Honda', 'Accord', 'sedan', 30, 375, 1400, ARRAY['Uber & Lyft Ready','Comfort'], ARRAY['https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=1200&q=80'], 'Premium midsize feel with Honda dependability.'),
(2008, 'Lexus', 'ES330', 'sedan', 24, 385, 1450, ARRAY['Uber Premier Eligible','Comfort'], ARRAY['https://images.unsplash.com/photo-1542362567-b07e54358753?w=1200&q=80'], 'Luxury feel that qualifies for higher-paying premium rides.'),
(2010, 'Acura', 'TSX', 'sedan', 27, 380, 1430, ARRAY['Uber & Lyft Ready','Premium'], ARRAY['https://images.unsplash.com/photo-1502877338535-766e1452684a?w=1200&q=80'], 'Sporty, refined, and unbeatable build quality.'),
(2014, 'Hyundai', 'Elantra', 'sedan', 31, 350, 1300, ARRAY['Uber & Lyft Ready','Fuel Efficient'], ARRAY['https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=1200&q=80'], 'Modern styling, generous warranty history, easy on gas.'),
(2013, 'Kia', 'Forte', 'sedan', 30, 350, 1300, ARRAY['Uber & Lyft Ready','Value'], ARRAY['https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=1200&q=80'], 'Roomy interior, the best value in the fleet.');
