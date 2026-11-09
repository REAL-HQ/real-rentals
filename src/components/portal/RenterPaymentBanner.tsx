import type { BusinessPhone } from "@/lib/company";
import type { RenterPaymentBannerModel } from "@/lib/renter-payment-banner";

/**
 * The driver's next payment, read only. The phone is the company line.
 * There is no pay button.
 */
export function RenterPaymentBanner({
  model,
  phone,
}: {
  model: RenterPaymentBannerModel;
  phone: BusinessPhone;
}) {
  const pastDue = model.tone === "past_due";
  return (
    <div
      data-renter-payment-banner={model.tone}
      className={`rounded-xl border px-4 py-3 text-sm ${
        pastDue ? "border-amber-200 bg-amber-50 text-amber-950" : "border-border bg-[#FAFAFB] text-[#111114]"
      }`}
    >
      {pastDue ? (
        <>
          Payment past due since {model.dueLabel} — call{" "}
          <a href={phone.tel} className="font-medium underline">
            {phone.display}
          </a>
        </>
      ) : (
        model.text
      )}
    </div>
  );
}
