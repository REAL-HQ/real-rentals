# held-notices-v1 (staged, NOT applied)

Retry list for payment notices held because the Automations switches could
not be read: receipts, payment-failed, card-expiring and the team failure
alert, for one-off charges, multi-row charges and weekly subscription
invoices. References only (kind, Stripe id, payment row ids, amount, reason);
no addresses or bodies. Service role only, RLS on with no policies.

Until applied, a held notice is still recorded as a failed "Held" delivery and
counted on the Automations page, but it is not retried. Applying it changes no
existing rows and sends nothing by itself (the table starts empty).
Validated on local Postgres (apply twice, constraints, unique key).
