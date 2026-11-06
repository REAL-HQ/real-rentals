import {
  APPLICATION_DOC_GAPS_ENABLED,
  type ApplicationDocGapsResult,
  type ApplicationDocSlot,
} from "@/lib/application-doc-gaps";

const LABELS: Record<string, string> = {
  license_front: "License Front",
  license_back: "License Back",
  insurance_card: "Insurance",
  driver_profile_screenshot: "Gig Profile",
  proof_of_address: "Proof Of Address",
};

const STATES: Record<string, string> = {
  present: "Present",
  missing: "Missing",
  unknown: "Unknown",
};

function labelFor(key: string): string {
  return LABELS[key] ?? "Document";
}

function SlotCell({ slot }: { slot: ApplicationDocSlot }) {
  const word = STATES[slot.state] ?? STATES.unknown;
  return (
    <span data-doc-gap={slot.key} data-doc-state={slot.state}>
      <span className="block text-[#111114]">{word}</span>
      {slot.state === "present" && slot.on ? <span className="block text-[#55555E]">{slot.on}</span> : null}
    </span>
  );
}

export function ApplicationDocGaps({
  canView,
  result,
}: {
  canView: boolean;
  result: ApplicationDocGapsResult | null;
}) {
  if (APPLICATION_DOC_GAPS_ENABLED !== true || canView !== true) return null;
  const failed = result?.failed === true;
  const keys = result?.applications[0]?.slots.map((slot) => slot.key) ?? [
    "license_front",
    "license_back",
    "insurance_card",
    "driver_profile_screenshot",
    "proof_of_address",
  ];
  return (
    <section className="mb-4 rounded-lg border border-border bg-white" data-application-doc-gaps>
      <div className="border-b border-border px-3 py-2.5">
        <h2 className="text-[13px] font-semibold text-[#111114]">Application Documents</h2>
      </div>
      <div className="px-3 py-2 text-[12px] text-[#55555E]">
        {failed ? <p>Could Not Load Application Documents</p> : null}
        {result && !failed && result.truncated ? (
          <p>Showing The First {result.cap} Open Applications. Later Applications Were Not Read.</p>
        ) : null}
        {!result && !failed ? <p>…</p> : null}
      </div>
      {result && !failed ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-left text-[#55555E]">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                {keys.map((key) => (
                  <th key={key} className="px-3 py-2 font-medium">
                    {labelFor(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.applications.map((app) => (
                <tr key={app.id} className="border-t border-[#EDEDF0]">
                  <td className="px-3 py-2 font-medium text-[#111114]">{app.name}</td>
                  {app.slots.map((slot) => (
                    <td key={slot.key} className="px-3 py-2">
                      <SlotCell slot={slot} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
