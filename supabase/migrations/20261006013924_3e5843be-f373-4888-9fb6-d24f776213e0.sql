CREATE OR REPLACE FUNCTION public.p0_test_force_fail() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.id = 'a4c6141a-d5d7-4df4-a62d-8d8453dac769'::uuid AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'p0_forced_failure';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.p0_test_force_fail() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER p0_test_force_fail BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.p0_test_force_fail();