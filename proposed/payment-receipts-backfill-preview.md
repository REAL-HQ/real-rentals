# Payment receipts backfill dry-run preview

Read-only Stripe live read on Nov 12, 2026. This file is a preview only.
The SQL in this folder and `scripts/backfill-payment-receipts.ts` were **not run**.

FLEET reported 12 successful $350 payments since Oct 15, 2026. Stripe also has
two $0 `subscription_update` invoices (Damon WTQPN3BV-0002 on Oct 31, Regina
BUKZ1ZXD-0002 on Oct 23). Those are excluded from the backfill and from the
Payments section.

No unmatched or ambiguous $350 payments were found in this read. Heather Bell
and James Rubin Smith Jr have no rental yet; they still match their
applications so the payments will show on their profiles, not in Unmatched.
Adam Waez should match his past rental via customer `cus_VRpPE4sSzNDYtb` /
subscription `sub_1UQvlRGsNNO50lXbo1ABcmTw` (staff context: rental prefix
`484b2643`). If that rental is missing at run time, those two rows would be
stored unmatched for staff.

| Renter | Date (ET) | Amount | Invoice | Matched | Match notes |
| --- | --- | --- | --- | --- | --- |
| James Rubin Smith Jr | Nov 12, 2026 10:23 AM EST | $350 | M5F0G0N6-0001 | Yes | Yes — application metadata / customer (no rental yet) |
| Heather Bell | Nov 10, 2026 10:43 AM EST | $350 | B2GPF4RB-0001 | Yes | Yes — application customer (no rental yet) |
| Schrita Thomas | Nov 9, 2026 12:21 PM EST | $350 | BXMKPGKG-0001 | Yes | Yes — current rental subscription |
| Regina Littles | Nov 4, 2026 6:22 PM EST | $350 | BUKZ1ZXD-0004 | Yes | Yes — rental subscription |
| Schrita Thomas | Nov 2, 2026 10:25 AM EST | $350 | GSHID2Z1-0001 | Yes | Yes — historical customer/sub on current rental |
| Damon T Sykes | Oct 31, 2026 7:48 AM EDT | $350 | WTQPN3BV-0001 | Yes | Yes — current rental subscription |
| Regina Littles | Oct 28, 2026 8:50 AM EDT | $350 | BUKZ1ZXD-0003 | Yes | Yes — rental subscription |
| Damon T Sykes | Oct 24, 2026 9:12 AM EDT | $350 | NFTV8ER9-0001 | Yes | Yes — historical customer/sub on current rental |
| Adam Waez | Oct 23, 2026 3:34 PM EDT | $350 | QU0AFF6R-0002 | Yes | Yes — past rental by customer/subscription (lookup at run time if id 484b2643…) |
| Regina Littles | Oct 17, 2026 11:41 AM EDT | $350 | BUKZ1ZXD-0001 | Yes | Yes — rental subscription |
| Damon T Sykes | Oct 15, 2026 5:41 PM EDT | $350 | ZYMDSLMB-0001 | Yes | Yes — historical customer/sub on current rental |
| Adam Waez | Oct 15, 2026 5:00 PM EDT | $350 | QU0AFF6R-0001 | Yes | Yes — past rental by customer/subscription (lookup at run time if id 484b2643…) |
