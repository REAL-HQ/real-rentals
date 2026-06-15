CREATE POLICY "Drivers can view their own payments"
ON public.payments
FOR SELECT
TO authenticated
USING (
  driver_id IN (
    SELECT id FROM public.applications WHERE user_id = auth.uid()
  )
);