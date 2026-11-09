import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  BILLING_DAY_APPLY_ENABLED,
  BILLING_DAY_CHANGE_ENABLED,
  BILLING_EXTENSION_RECORD_ENABLED,
  BILLING_ONE_TIME_EXTENSION_ENABLED,
  BILLING_PM_UPDATE_LINK_ENABLED,
} from "@/lib/billing-controls-flag";
import {
  applyBillingDay,
  createBillingPaymentMethodLink,
  grantBillingExtension,
  previewBillingDay,
  sendBillingPaymentMethodLink,
  setBillingSubscriptionDefault,
  verifyBillingPaymentMethod,
} from "@/lib/billing-controls.functions";
import type { BillingExtensionView, BillingPreviewInvoice, PaymentMethodVerifyResult, PreviewLineRead } from "@/lib/billing-controls";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function money(cents: number | null): string {
  if (cents == null || !Number.isSafeInteger(cents)) return "Not Recorded";
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? "-" : ""}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Billing controls could not be completed.";
}

export function BillingControls() {
  if (!BILLING_PM_UPDATE_LINK_ENABLED && !BILLING_DAY_CHANGE_ENABLED && !BILLING_ONE_TIME_EXTENSION_ENABLED) return null;
  return <BillingControlsForm />;
}

function BillingControlsForm() {
  const createLink = useServerFn(createBillingPaymentMethodLink);
  const sendLink = useServerFn(sendBillingPaymentMethodLink);
  const verifyMethod = useServerFn(verifyBillingPaymentMethod);
  const setDefault = useServerFn(setBillingSubscriptionDefault);
  const previewDay = useServerFn(previewBillingDay);
  const applyDay = useServerFn(applyBillingDay);
  const grantExtension = useServerFn(grantBillingExtension);
  const [rentalId, setRentalId] = useState("");
  const [weekday, setWeekday] = useState("1");
  const [link, setLink] = useState("");
  const [verify, setVerify] = useState<PaymentMethodVerifyResult | null>(null);
  const [preview, setPreview] = useState<{ invoices: BillingPreviewInvoice[]; stripePreview: PreviewLineRead; gapDays: number } | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [reason, setReason] = useState("");
  const [newDue, setNewDue] = useState("");
  const [extension, setExtension] = useState<BillingExtensionView | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setError("");
    setNotice("");
    try {
      await action();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  return (
    <section aria-label="Billing Controls" className="mb-6 rounded-md border border-border bg-white p-4">
      <h2 className="text-base font-semibold">Billing Controls</h2>
      <p className="mt-1 text-xs text-muted-foreground">Payment method links, billing day preview, and one-invoice extensions. Nothing here marks a payment paid.</p>
      <label className="mt-3 block text-sm">
        Rental
        <input value={rentalId} onChange={(event) => setRentalId(event.target.value)} className="mt-1 block h-8 w-full rounded-md border border-border bg-white px-2 text-sm" />
      </label>
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-sm">{notice}</p> : null}
      {BILLING_PM_UPDATE_LINK_ENABLED ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Update Payment Method</h3>
          <p className="mt-1 text-xs text-muted-foreground">Copy Link does not email. Send Link emails the driver.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium" onClick={() => run(async () => {
              const created = await createLink({ data: { rentalId } });
              setLink(created.url);
              await navigator.clipboard.writeText(created.url);
              setNotice("Link copied.");
            })}>Copy Link</button>
            <button type="button" className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium" onClick={() => run(async () => {
              await sendLink({ data: { rentalId } });
              setNotice("Link sent.");
            })}>Send Link</button>
            <button type="button" className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium" onClick={() => run(async () => {
              setVerify(await verifyMethod({ data: { rentalId } }));
            })}>Verify Payment Method</button>
          </div>
          {link ? <p className="mt-2 break-all text-xs">{link}</p> : null}
          {verify ? (
            <div className="mt-2 text-sm">
              <p>Selected On Subscription: {verify.selectedOnSubscription ? "Yes" : "No"}</p>
              <p>Subscription Default: {verify.subscriptionDefaultId ?? "None"}</p>
              <p>Customer Invoice Default: {verify.customerDefaultId ?? "None"}</p>
              {verify.attachedNotDefaultId ? (
                <button type="button" className="mt-2 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium" onClick={() => run(async () => {
                  await setDefault({ data: { rentalId, paymentMethodId: verify.attachedNotDefaultId! } });
                  setNotice("Subscription default updated.");
                  setVerify(await verifyMethod({ data: { rentalId } }));
                })}>Set As Subscription Default</button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {BILLING_DAY_CHANGE_ENABLED ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Change Billing Day</h3>
          <label className="mt-2 block text-sm">
            Billing Day
            <select value={weekday} onChange={(event) => setWeekday(event.target.value)} className="mt-1 block h-8 rounded-md border border-border bg-white px-2 text-sm">
              {WEEKDAYS.map((name, index) => <option key={name} value={String(index)}>{name}</option>)}
            </select>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium" onClick={() => run(async () => {
              const result = await previewDay({ data: { rentalId, weekday: Number(weekday) } });
              setPreview(result);
            })}>Preview Billing Day</button>
            {BILLING_DAY_APPLY_ENABLED ? (
              <button type="button" className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium" onClick={() => run(async () => {
                await applyDay({ data: { rentalId, weekday: Number(weekday) } });
                setNotice("Billing day updated.");
              })}>Apply Billing Day</button>
            ) : null}
          </div>
          {preview ? (
            <div className="mt-3 overflow-x-auto">
              <p className="text-xs text-muted-foreground">Gap Days: {preview.gapDays}. Gap days are not charged.</p>
              <table className="mt-2 w-full text-left text-xs">
                <thead>
                  <tr>{["Date", "Kind", "Amount", "Credits", "Prorations"].map((heading) => <th key={heading} className="py-1 pr-3 font-medium">{heading}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.invoices.map((invoice) => (
                    <tr key={`${invoice.kind}-${invoice.atUnix}`}>
                      <td className="py-1 pr-3">{invoice.dateEt}</td>
                      <td className="py-1 pr-3">{invoice.kind === "trial" ? "Trial" : "Renewal"}</td>
                      <td className="py-1 pr-3">{money(invoice.amountCents)}</td>
                      <td className="py-1 pr-3">{money(invoice.creditsCents)}</td>
                      <td className="py-1 pr-3">{invoice.prorations.length === 0 ? "None" : String(invoice.prorations.length)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs">Stripe Preview Amount: {money(preview.stripePreview.amountDueCents)}</p>
              <p className="text-xs">Stripe Credits: {money(preview.stripePreview.creditsCents)}</p>
              <p className="text-xs">Stripe Prorations: {preview.stripePreview.prorations.length === 0 ? "None" : preview.stripePreview.prorations.map((line) => `${line.description} ${money(line.amountCents)}`).join(", ")}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {BILLING_ONE_TIME_EXTENSION_ENABLED ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Grant Payment Extension</h3>
          <p className="mt-1 text-xs text-muted-foreground">Defers one invoice. The weekly anchor stays. The balance stays outstanding.</p>
          <label className="mt-2 block text-sm">Invoice<input value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)} className="mt-1 block h-8 w-full rounded-md border border-border bg-white px-2 text-sm" /></label>
          <label className="mt-2 block text-sm">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 block h-8 w-full rounded-md border border-border bg-white px-2 text-sm" /></label>
          <label className="mt-2 block text-sm">New Due<input value={newDue} onChange={(event) => setNewDue(event.target.value)} placeholder="YYYY-MM-DD" className="mt-1 block h-8 w-full rounded-md border border-border bg-white px-2 text-sm" /></label>
          {BILLING_EXTENSION_RECORD_ENABLED ? (
            <button type="button" className="mt-2 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium" onClick={() => run(async () => {
              setExtension(await grantExtension({ data: { rentalId, invoiceId, reason, newDue } }));
            })}>Grant Payment Extension</button>
          ) : <p className="mt-2 text-xs text-muted-foreground">Payment extension recording is off until the exception table is installed.</p>}
          {extension ? <p className="mt-2 text-sm">{extension.label}: {extension.reporting === "outstanding" ? "Outstanding" : "Collected"} {money(extension.amountDueCents)}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
