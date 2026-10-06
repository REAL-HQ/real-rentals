ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check CHECK (status = ANY (ARRAY[
  'upcoming','pending','current','paid','failed','late','overdue','past_due','unpaid','collections','refunded','waived','void']));