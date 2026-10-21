-- The mileage phrase printed on an agreement, and nothing else.
-- Active mileage overage selects this field. It does not select agreements.body.
-- The function only reads the row it is given. It does not write.
-- Installing it does not turn the estimate on.

CREATE OR REPLACE FUNCTION public.agreement_mileage_allowance(agreement public.agreements)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    NULLIF(btrim((regexp_match(
      agreement.body,
      'Mileage Limit[[:space:]]*\|[[:space:]]*[^|' || chr(10) || ']*;[[:space:]]*([^|' || chr(10) || ']+)',
      'i'
    ))[1]), ''),
    NULLIF(btrim((regexp_match(
      agreement.body,
      'mileage_allowance:[[:space:]]*([^' || chr(10) || ']+)',
      'i'
    ))[1]), '')
  );
$$;

REVOKE ALL ON FUNCTION public.agreement_mileage_allowance(public.agreements) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agreement_mileage_allowance(public.agreements) TO service_role;
