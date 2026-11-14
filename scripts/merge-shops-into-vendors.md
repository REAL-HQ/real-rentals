# Merge Shops Into Vendors

Unapplied. Migration: `supabase/migrations/20261110010000_merge_shops_into_vendors.sql`.

## Does the UI need the migration first?

No for admin. The Repair Shops tab is removed; staff add and filter vendors under **Vendors** (type **Repair**). Existing shop rows stay in `shops` until the migration runs, so they will not appear in the Vendors list until then.

Yes for a complete cutover. After the migration, shop rows are copied into `vendors` as `repair_shop`, and `maintenance_records.vendor_id` is filled from `shop_id` when blank. The driver portal still reads `shops` until a follow-up switches it to vendors.

## Apply

Only with Dolmar's approval. Do not run against production from this PR.
