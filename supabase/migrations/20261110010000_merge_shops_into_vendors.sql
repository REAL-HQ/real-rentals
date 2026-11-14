-- Merge Repair Shops (public.shops) into public.vendors as vendor_type = repair_shop.
-- NOT applied by this PR. Apply only with Dolmar's explicit approval.
--
-- Goals:
--   * Copy every shop row into vendors without losing fields.
--   * Prefer the same UUID so future remaps are simple.
--   * Point maintenance_records.vendor_id at the new vendor when shop_id is set
--     and vendor_id is still null (expenses already use vendor_id only).
--   * Leave public.shops in place until a later cutover removes portal reads.
--
-- Safe to re-run: skips shops whose id already exists as a vendor, and only
-- fills blank vendor_id values.

BEGIN;

-- Allow the new type (comment only; vendor_type is free text with a documented set).
COMMENT ON COLUMN public.vendors.vendor_type IS
  'maintenance | body_shop | repair_shop | tires | towing | detailing | gps | insurance | dmv | parts | fuel | other';

INSERT INTO public.vendors (
  id, name, vendor_type, phone, address, market_id, services, hours, notes, is_active, created_at, updated_at
)
SELECT
  s.id,
  s.name,
  'repair_shop',
  s.phone,
  s.address,
  s.market_id,
  COALESCE(s.services, '{}'::text[]),
  s.hours,
  s.notes,
  s.is_active,
  s.created_at,
  s.updated_at
FROM public.shops s
WHERE NOT EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = s.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE lower(v.name) = lower(s.name)
      AND v.vendor_type = 'repair_shop'
      AND v.market_id IS NOT DISTINCT FROM s.market_id
  );

-- When a shop name already matched an existing repair_shop vendor, map by name+market.
CREATE TEMP TABLE shop_vendor_map ON COMMIT DROP AS
SELECT s.id AS shop_id, v.id AS vendor_id
FROM public.shops s
JOIN public.vendors v
  ON v.id = s.id
 OR (
   lower(v.name) = lower(s.name)
   AND v.vendor_type = 'repair_shop'
   AND v.market_id IS NOT DISTINCT FROM s.market_id
 );

UPDATE public.maintenance_records mr
SET vendor_id = m.vendor_id
FROM shop_vendor_map m
WHERE mr.shop_id = m.shop_id
  AND mr.vendor_id IS NULL
  AND m.vendor_id IS NOT NULL;

COMMIT;
