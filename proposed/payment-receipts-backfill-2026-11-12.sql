-- PREPARED, NOT RUN. Needs Dolmar's approval after the migration in this PR is applied.
-- One-time backfill of the 12 successful $350 payments since Oct 15, 2026.
-- Dates are America/New_York. $0 subscription-update invoices are left out.
-- Sends nothing: no email or SMS runs from this SQL. notified_status = 'paid'
-- marks each row as already noticed so a later Stripe replay cannot email,
-- text, or raise late fees or rent reminders.
-- Idempotent: skips any invoice or charge already in payments.
-- Unmatched rows (if a rental or application cannot be found at run time) are
-- still inserted with null rental_id/driver_id so staff can see them.

BEGIN;

WITH src(
  invoice_id, invoice_number, amount, customer_id, subscription_id,
  known_rental_id, known_application_id, due_date, paid_date, paid_at,
  charge_id, payment_intent_id, hosted_url, pdf_url, receipt_url
) AS (
  VALUES
  ('in_1Uazl0GsNNO50lXbay3VpfNc', 'M5F0G0N6-0001', 350.00, 'cus_VcEDuYOeYmG1MF', NULL, NULL, 'baa6dacd-fcfe-47b7-84a1-04952903f514'::uuid, '2026-11-12'::date, '2026-11-12'::date, '2026-11-12T15:23:43+00:00'::timestamptz, 'ch_3Uazl8GsNNO50lXb0MLfQVff', 'pi_3Uazl8GsNNO50lXb0tuVRsRP', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WY0VEQ1BlYXFJQTFMRjU4aGpuejRyV2sxdkJmaTNaLDE4NTA3MDM3OA0200s3nk2fpr?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WY0VEQ1BlYXFJQTFMRjU4aGpuejRyV2sxdkJmaTNaLDE4NTA3MDM3OA0200s3nk2fpr/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo77LZ1wYyBuc-zQWcBDosFrWnqHLM48LdgKZAhSGId2w2eT7aynOLj9ZLT6q3DUPkCjcd3-TyyRlqigk?s=ap'),
  ('in_1UaHCPGsNNO50lXbiq1OSONs', 'B2GPF4RB-0001', 350.00, 'cus_VbU7iYF9nlh0cR', 'sub_1UaHCfGsNNO50lXb8na9TVzS', NULL, 'f85939d0-9e81-4cff-9492-9f7f4358d117'::uuid, '2026-11-10'::date, '2026-11-10'::date, '2026-11-10T15:43:20+00:00'::timestamptz, 'py_3UaH9iGsNNO50lXb0TLOUrbz', 'pi_3UaH9iGsNNO50lXb0T1k8lxq', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WYlVCNmY0NmJ6UFBaM3VudVp6aHRRekNST2RQbjJyLDE4NTA3MDM3OA0200uIDGf55N?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WYlVCNmY0NmJ6UFBaM3VudVp6aHRRekNST2RQbjJyLDE4NTA3MDM3OA0200uIDGf55N/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo77LZ1wYyBrhsZJ9rrDosFqlgC6BdfhQdeXAHQXdM3kxaeOnfd_vjmjCLzjgcPLLISeWY8T5LrBcwfN8?s=ap'),
  ('in_1UZwGMGsNNO50lXbGIh5KjHV', 'BXMKPGKG-0001', 350.00, 'cus_Vb8XvqNW6d4IcX', 'sub_1UZwGPGsNNO50lXbRCnRl4Yl', '49f6008f-bc8f-44f7-bd9a-82ded5e7d8af'::uuid, NULL, '2026-11-09'::date, '2026-11-09'::date, '2026-11-09T17:21:47+00:00'::timestamptz, 'ch_3UZwGMGsNNO50lXb0ckxg5so', 'pi_3UZwGMGsNNO50lXb0eZuzlZA', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WYjhYMjJEdVU2VkxGT0lIaENyYjdocTVPWHlhbXFWLDE4NTA3MDM3OA0200j3e0j6LP?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WYjhYMjJEdVU2VkxGT0lIaENyYjdocTVPWHlhbXFWLDE4NTA3MDM3OA0200j3e0j6LP/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo7rLZ1wYyBsJoSJe7OTosFsZfq3DbcIVSC_VOrJ4dr6cPwiXKZ9QJ69O95WLShr-dPAFwmrDBRmapf6Y?s=ap'),
  ('in_1UXNN0GsNNO50lXblTIg15zP', 'BUKZ1ZXD-0004', 350.00, 'cus_VSUjRxg343D7Yk', 'sub_1URZk6GsNNO50lXbXuQV3lAH', 'd8fbb519-db84-4b33-8669-7c62474d6bfd'::uuid, NULL, '2026-11-02'::date, '2026-11-04'::date, '2026-11-04T23:22:17+00:00'::timestamptz, 'ch_3UXOK0GsNNO50lXb1Yp3g4si', 'pi_3UXOK0GsNNO50lXb1fWhgUkI', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WWVVMYzFmUThMUk1oMUZTcWtWaktWWUZDS28xZkR5LDE4NTA3MDM3OA0200EfghrZFv?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WWVVMYzFmUThMUk1oMUZTcWtWaktWWUZDS28xZkR5LDE4NTA3MDM3OA0200EfghrZFv/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo7rLZ1wYyBq66cekMfjosFjevXLLLkPCa2lfEm2uVVPVbY4bqoYkf2t8uXxueKrjL1zCzhm1CZq_rR0I?s=ap'),
  ('in_1UXN6XGsNNO50lXbxWJRkB9b', 'GSHID2Z1-0001', 350.00, 'cus_VYU4FFddyzX0cJ', 'sub_1UXN6dGsNNO50lXbRQy4GIOC', '49f6008f-bc8f-44f7-bd9a-82ded5e7d8af'::uuid, NULL, '2026-11-02'::date, '2026-11-02'::date, '2026-11-02T15:25:05+00:00'::timestamptz, 'ch_3UXN6YGsNNO50lXb1cmmkPz2', 'pi_3UXN6YGsNNO50lXb1Tz5WjvO', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WWVU0SlhnanpvZGRYdVhPb2N4R1Z2eXJmZnlVWk5CLDE4NTA3MDM3OA0200Jt67M720?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WWVU0SlhnanpvZGRYdVhPb2N4R1Z2eXJmZnlVWk5CLDE4NTA3MDM3OA0200Jt67M720/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo77LZ1wYyBmAGFsizHDosFj3VN-qWF62IwQ2dvjqwHaIKfRsIR0v5YhlcF9L0FCSzDgp-3tmfdHpRn04?s=ap'),
  ('in_1UWam5GsNNO50lXbKlTt7mPz', 'WTQPN3BV-0001', 350.00, 'cus_VXg511exteJySE', 'sub_1UWam8GsNNO50lXbvvIo4ZQI', '83668a8d-1868-45c5-bb20-38f54491ab6c'::uuid, NULL, '2026-10-31'::date, '2026-10-31'::date, '2026-10-31T11:48:42+00:00'::timestamptz, 'ch_3UWajPGsNNO50lXb0rSygKO6', 'pi_3UWajPGsNNO50lXb0FTn2VvX', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WWGc4RVh1QzRDVXNubmVFdWVzYmJuU0F5d1hpeFNULDE4NTA3MDM3OA0200j7ys1QKH?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WWGc4RVh1QzRDVXNubmVFdWVzYmJuU0F5d1hpeFNULDE4NTA3MDM3OA0200j7ys1QKH/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo7rLZ1wYyBiXLoeUv_josFs_8z75t0YYcxPlibAfmf0SbspgrxqPI5YHGZ_ySIp9RgVNARJuZ6vFmeXI?s=ap'),
  ('in_1UUq28GsNNO50lXbpMdhhXuG', 'BUKZ1ZXD-0003', 350.00, 'cus_VSUjRxg343D7Yk', 'sub_1URZk6GsNNO50lXbXuQV3lAH', 'd8fbb519-db84-4b33-8669-7c62474d6bfd'::uuid, NULL, '2026-10-26'::date, '2026-10-28'::date, '2026-10-28T12:50:31+00:00'::timestamptz, 'ch_3UUqyVGsNNO50lXb1PaDVfhY', 'pi_3UUqyVGsNNO50lXb1vpoN0bx', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WVnJsY3FiRnZjcVFqRkU4dkZERW5KS0YzSVJ0SnF1LDE4NTA3MDM3OA02009ncUZdjc?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WVnJsY3FiRnZjcVFqRkU4dkZERW5KS0YzSVJ0SnF1LDE4NTA3MDM3OA02009ncUZdjc/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo7rLZ1wYyBhGJbNHWxjosFhPTCrWLMzlkkNzCSxjX0r6i1O9w8c2pOpII681LkZvRA4gMrQuoxkyrqac?s=ap'),
  ('in_1UU4klGsNNO50lXbuMnHu2Hv', 'NFTV8ER9-0001', 350.00, 'cus_VV4szDhyr4XZMQ', 'sub_1UU4kqGsNNO50lXb9QkjfqsU', '83668a8d-1868-45c5-bb20-38f54491ab6c'::uuid, NULL, '2026-10-24'::date, '2026-10-24'::date, '2026-10-24T13:12:58+00:00'::timestamptz, 'ch_3UU4j7GsNNO50lXb0KaheVCs', 'pi_3UU4j7GsNNO50lXb0J9vCtbX', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WVjR1TWJ4aW5TZU55cG9pZXdDZE1Rd2ZSQW5XcHU3LDE4NTA3MDM3OA0200WbbVxQbw?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WVjR1TWJ4aW5TZU55cG9pZXdDZE1Rd2ZSQW5XcHU3LDE4NTA3MDM3OA0200WbbVxQbw/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo77LZ1wYyBnnGtjISajosFrqyNGYik2cSF0Sn-c72DjT9UgV8RUcJOFkqS9iEla1jf_HiO79y7oYXoP8?s=ap'),
  ('in_1UTT6bGsNNO50lXbdi3g1y40', 'QU0AFF6R-0002', 350.00, 'cus_VRpPE4sSzNDYtb', 'sub_1UQvlRGsNNO50lXbo1ABcmTw', NULL, NULL, '2026-10-22'::date, '2026-10-23'::date, '2026-10-23T19:34:06+00:00'::timestamptz, 'ch_3UTZthGsNNO50lXb0iFGCi7W', 'pi_3UTZthGsNNO50lXb0F4D3fCP', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WVVMwbjhWTkpycllRTHJiU3NzeXQxb2RVazBUNEd2LDE4NTA3MDM3OA0200zkNsY8Gv?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WVVMwbjhWTkpycllRTHJiU3NzeXQxb2RVazBUNEd2LDE4NTA3MDM3OA0200zkNsY8Gv/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo7rLZ1wYyBmAFsNglszosFv3kU4RNTSdV4DpBkKI6GemtQ8895SdUWef9uYjF6LJB8CgJpw_tq5Zz-PM?s=ap'),
  ('in_1URZk3GsNNO50lXb0Jsh1lYP', 'BUKZ1ZXD-0001', 350.00, 'cus_VSUjRxg343D7Yk', 'sub_1URZk6GsNNO50lXbXuQV3lAH', 'd8fbb519-db84-4b33-8669-7c62474d6bfd'::uuid, NULL, '2026-10-17'::date, '2026-10-17'::date, '2026-10-17T15:41:52+00:00'::timestamptz, 'ch_3URZk3GsNNO50lXb1gt6tkER', 'pi_3URZk3GsNNO50lXb1GhDspZV', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WU1VqbVlmam92N082NXV0V2tJdlY3VWJReE96NWZ2LDE4NTA3MDM3OA0200RVlchb07?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WU1VqbVlmam92N082NXV0V2tJdlY3VWJReE96NWZ2LDE4NTA3MDM3OA0200RVlchb07/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo7rLZ1wYyBjKE3OyGaDosFj_lqTdNy5ST6QRGPxjUZGi_ocitdW2wq3L2n25w9NxtpEi_V-DaQjwk2qQ?s=ap'),
  ('in_1UQwOfGsNNO50lXbRNtfEOYZ', 'ZYMDSLMB-0001', 350.00, 'cus_VRq4RFWitpMvSV', 'sub_1UQwOjGsNNO50lXbq8y8hkVs', '83668a8d-1868-45c5-bb20-38f54491ab6c'::uuid, NULL, '2026-10-15'::date, '2026-10-15'::date, '2026-10-15T21:41:12+00:00'::timestamptz, 'ch_3UQwOfGsNNO50lXb0nhQ4Upe', 'pi_3UQwOfGsNNO50lXb03Jeh1a9', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WUnE0OHJaeVJiQUpsRFQ5UDFrVXZ4WmtsTFY3VGt3LDE4NTA3MDM3OA0200D6tVbRgR?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WUnE0OHJaeVJiQUpsRFQ5UDFrVXZ4WmtsTFY3VGt3LDE4NTA3MDM3OA0200D6tVbRgR/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo77LZ1wYyBppniLTrkzosFoHtWRa21PvVnr8mWYvYMZk5BT2_3wnQu9a4IY6-lyC3ChExCgRbK6ujLyk?s=ap'),
  ('in_1UQvlOGsNNO50lXbeyKtZQRH', 'QU0AFF6R-0001', 350.00, 'cus_VRpPE4sSzNDYtb', 'sub_1UQvlRGsNNO50lXbo1ABcmTw', NULL, NULL, '2026-10-15'::date, '2026-10-15'::date, '2026-10-15T21:00:35+00:00'::timestamptz, 'ch_3UQvkQGsNNO50lXb1qd1u98C', 'pi_3UQvkQGsNNO50lXb1sTbUgEz', 'https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WUnBRZEFpOEluaWNQMnNUWkZJczF3QW9aWjM5cXhzLDE4NTA3MDM3OA020046i9tgZw?s=ap', 'https://pay.stripe.com/invoice/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WUnBRZEFpOEluaWNQMnNUWkZJczF3QW9aWjM5cXhzLDE4NTA3MDM3OA020046i9tgZw/pdf?s=ap', 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUd0JQTkdzTk5PNTBsWGIo7rLZ1wYyBk3Ws7q8IjosFtWQSWZBJqg2KfcTSB9E1MV3Mv4byuS7lkxStQIoyXpuXMzi-aan2Qh8QmY?s=ap')
),
known_history(customer_id, subscription_id, rental_id) AS (
  VALUES
  ('cus_VXg511exteJySE', 'sub_1UWam8GsNNO50lXbvvIo4ZQI', '83668a8d-1868-45c5-bb20-38f54491ab6c'::uuid),
  ('cus_VV4szDhyr4XZMQ', 'sub_1UU4kqGsNNO50lXb9QkjfqsU', '83668a8d-1868-45c5-bb20-38f54491ab6c'::uuid),
  ('cus_VRq4RFWitpMvSV', 'sub_1UQwOjGsNNO50lXbq8y8hkVs', '83668a8d-1868-45c5-bb20-38f54491ab6c'::uuid),
  ('cus_VSUjRxg343D7Yk', 'sub_1URZk6GsNNO50lXbXuQV3lAH', 'd8fbb519-db84-4b33-8669-7c62474d6bfd'::uuid),
  ('cus_Vb8XvqNW6d4IcX', 'sub_1UZwGPGsNNO50lXbRCnRl4Yl', '49f6008f-bc8f-44f7-bd9a-82ded5e7d8af'::uuid),
  ('cus_VYU4FFddyzX0cJ', 'sub_1UXN6dGsNNO50lXbRQy4GIOC', '49f6008f-bc8f-44f7-bd9a-82ded5e7d8af'::uuid)
),
matched AS (
  SELECT
    s.*,
    COALESCE(
      s.known_rental_id,
      r_sub.id,
      r_cus.id,
      h.rental_id,
      r_app.id
    ) AS rental_id,
    COALESCE(
      r_sub.application_id,
      r_cus.application_id,
      r_hist.application_id,
      r_app.application_id,
      s.known_application_id,
      a_cus.id
    ) AS driver_id,
    COALESCE(r_sub.vehicle_id, r_cus.vehicle_id, r_hist.vehicle_id, r_app.vehicle_id) AS vehicle_id
  FROM src s
  LEFT JOIN public.rentals r_sub
    ON s.subscription_id IS NOT NULL AND r_sub.stripe_subscription_id = s.subscription_id
  LEFT JOIN public.rentals r_cus
    ON r_cus.stripe_customer_id = s.customer_id
  LEFT JOIN known_history h
    ON h.customer_id = s.customer_id OR (s.subscription_id IS NOT NULL AND h.subscription_id = s.subscription_id)
  LEFT JOIN public.rentals r_hist
    ON r_hist.id = h.rental_id
  LEFT JOIN public.applications a_cus
    ON a_cus.stripe_customer_id = s.customer_id
  LEFT JOIN public.rentals r_app
    ON r_app.application_id = COALESCE(s.known_application_id, a_cus.id)
)
INSERT INTO public.payments (
  type, status, amount, due_date, paid_date, payment_method, balance_due, notes,
  rental_id, driver_id, vehicle_id,
  stripe_invoice_id, stripe_invoice_number, stripe_subscription_id, stripe_customer_id,
  stripe_charge_id, stripe_payment_intent_id, stripe_hosted_invoice_url,
  stripe_invoice_pdf_url, stripe_receipt_url, stripe_paid_at, notified_status
)
SELECT
  'rent', 'paid', m.amount, m.due_date, m.paid_date, 'card', 0,
  'Backfilled from Stripe 11/12/2026',
  m.rental_id, m.driver_id, m.vehicle_id,
  m.invoice_id, m.invoice_number, m.subscription_id, m.customer_id,
  m.charge_id, m.payment_intent_id, m.hosted_url,
  m.pdf_url, m.receipt_url, m.paid_at, 'paid'
FROM matched m
WHERE NOT EXISTS (
  SELECT 1 FROM public.payments p
  WHERE p.stripe_invoice_id = m.invoice_id
     OR (m.charge_id IS NOT NULL AND p.stripe_charge_id = m.charge_id)
);

SELECT p.driver_id, p.rental_id, p.stripe_invoice_id, p.stripe_invoice_number,
       p.amount, p.due_date, p.paid_date, p.status, p.notified_status
FROM public.payments p
WHERE p.notes = 'Backfilled from Stripe 11/12/2026'
ORDER BY p.paid_date, p.stripe_invoice_number;

COMMIT;
