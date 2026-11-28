# Add Driver Requests

Dolmar, Nov 28 2026 11:41 AM ET: make it easy for a renter to ask to add a driver from their portal.

## Switch

Automations → **Add Driver (Portal)**, key `renter_add_driver` in `app_settings.automation_controls`. Off until an Owner turns it on.
Off hides the Add Driver button and refuses new uploads, requests and payments. Requests that already exist stay visible to the renter and staff can keep working them.

Needs migration `supabase/migrations/20261128170000_add_driver_requests.sql` (not applied).

## Renter (Driver Portal → Documents → Additional Drivers)

1. **Add Driver** opens a form: full name, date of birth, phone, email, relationship, home address (prefilled with the renter's address on file), license number, state and expiration, years licensed, license front and back (drag and drop, browse or camera), and the driver's agreement to the insurance use of their information.
2. Shown before sending: $100 cost, the driver is added to the insurance policy, approval depends on the driving record, and only a driver at the same address can be added.
3. Same address only. The address is compared after normalizing (street words such as Street/St, unit markers such as Apt/#/Unit, state names, ZIP+4). A different address blocks sending and shows the Apply For A Car link (`/apply`). The server checks again.
4. After sending, the renter is taken to Stripe Checkout for $100. The request shows **Requested** until paid.
5. Approved shows the driver with an **Insurance Card** link. Denied shows a short status. Staff notes are never shown to the renter.

Needs an active rental and a home address on file. Uploads go to the private `driver-docs` bucket under `<application id>/additional-driver/` through signed upload URLs; the renter's own documents (license, insurance) are not touched.

## Payment

- One `payments` row per request, written before Stripe: `type fee`, `reason add_driver`, `notes add_driver:<request id>`, `driver_id` = application, no `rental_id` while owed (so the rent balance, Pay Now and reminders never pick it up). Once paid it is filed on the rental for revenue.
- Checkout metadata (both slots): `rental_id`, `lead_id`, `reason=add_driver`, `for_date`, `renter`, `plate`, plus `paymentIds` and `add_driver_request_id`.
- `payment_intent.succeeded` marks the row paid (existing paymentIds path) and `settleAddDriverPayment` moves the request to **Paid**. A read also catches up a request whose row is paid.
- A declined card inside Checkout is not a failed rent payment: the webhook leaves the row owed and the rental untouched.
- No renter email for this payment: no app receipt and no portal welcome.

## Staff (Drivers → Add Driver tab, driver profile, vehicle profile)

Manager or Owner only.

| Status | Who moves it | Next |
| --- | --- | --- |
| Requested | Renter sends the form | Paid (webhook) or Denied |
| Paid | Payments webhook | Start Insurance or Deny |
| Insurance Pending | Staff press Start Insurance | Approve (upload insurance card) or Deny |
| Approved | Staff, with the insurance card | Final |
| Denied | Staff, with a note | Final |

Nothing is sent to an insurer automatically. Staff or the bot apply for the driver's insurance outside the app and record the outcome here. A denied request that was paid is **not** refunded automatically; refund it in Payments and note it on the request. A denied request that was not yet paid has its $100 row voided and its open Checkout closed.

The database guard (`public.guard_additional_driver_request`) refuses a skipped or backward step, an Approved without a staff decision and an insurance card, a Denied without a note, and any change to the submitted details. Browser sessions can only read (renter: own rows; Manager+: all).

## Not in this change

- Approved requests are not copied into `rental_additional_drivers` (the agreement signer roster and weekly billing). Staff add them there as today if the agreement needs updating.
- No texts or emails to the renter or the driver.
