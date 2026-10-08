CREATE OR REPLACE FUNCTION public.fin_deposit_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.txn_type = 'deposit_received' AND OLD.status = 'posted' AND NEW.status IN ('reversed','corrected')
     AND EXISTS (SELECT 1 FROM public.financial_transactions c WHERE c.deposit_source_id = OLD.id AND c.reverses_id IS NULL
                 AND c.status IN ('proposed','confirmed','posted')) THEN
    RAISE EXCEPTION 'deposit_has_applications: reverse the applications/refunds first';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fin_deposit_source_guard BEFORE UPDATE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fin_deposit_source_guard();
REVOKE ALL ON FUNCTION public.fin_deposit_source_guard() FROM PUBLIC, anon, authenticated;