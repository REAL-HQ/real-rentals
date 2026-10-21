import type { WaitlistAgingResult } from "@/lib/waitlist-aging";
import { SectionCard } from "./ui";

/** Round only here. The result keeps the exact median, including halves. */
export function displayDays(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Unknown";
  return String(Math.round(value));
}

function cityLabel(city: string | null): string {
  return city && city.trim() ? city : "Unknown";
}

export function WaitlistAging({ result }: { result: WaitlistAgingResult | null }) {
  return (
    <SectionCard title="Waitlist Aging" subtitle="Days Waiting By City And Vehicle Type">
      {result == null ? (
        <p className="text-[13px] text-[#9A9AA3]">Loading…</p>
      ) : result.failed ? (
        <p className="text-[13px] text-[#9A3A3A]">Could Not Load Waitlist Aging</p>
      ) : (
        <div>
          {result.truncated ? (
            <p className="mb-3 text-[12px] text-[#8A5A12]">
              Showing The First 1000 Waitlist Entries. Later Entries Were Not Read.
            </p>
          ) : null}
          {result.groups.length === 0 ? (
            <p className="text-[13px] text-[#9A9AA3]">No Waitlist Entries To Age</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[11px] font-semibold text-[#9A9AA3]">
                    <th className="py-2 pr-3 font-semibold">City</th>
                    <th className="py-2 pr-3 font-semibold">Vehicle Type</th>
                    <th className="py-2 pr-3 font-semibold">Waiting</th>
                    <th className="py-2 pr-3 font-semibold">Median Days</th>
                    <th className="py-2 pr-3 font-semibold">Oldest Days</th>
                    <th className="py-2 pr-3 font-semibold">Notified, Not Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {result.groups.map((group) => (
                    <tr key={group.city ?? "unknown"} className="border-t border-[#EDEDF0]">
                      <td className="py-2 pr-3">{cityLabel(group.city)}</td>
                      <td className="py-2 pr-3">{group.vehicleType ?? "Unknown"}</td>
                      <td className="py-2 pr-3">{group.waiting}</td>
                      <td className="py-2 pr-3">{displayDays(group.medianDays)}</td>
                      <td className="py-2 pr-3">{displayDays(group.oldestDays)}</td>
                      <td className="py-2 pr-3">{group.notifiedNotApplied}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
