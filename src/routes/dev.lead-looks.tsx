import { createFileRoute } from "@tanstack/react-router";
import { LEAD_LOOKS, LeadLookBoard, type LookId } from "@/components/admin/LeadLooks";
import { displayPersonName } from "@/lib/display-normalize";
import { projectLead, type LeadBucket, type LeadRow } from "@/lib/lead-priorities";

const LOOK_IDS = ["a", "b", "c", "d"] as const;

export const Route = createFileRoute("/dev/lead-looks")({
  validateSearch: (search: Record<string, unknown>): { look: LookId | "all" } => ({
    look: LOOK_IDS.includes(search.look as LookId) ? (search.look as LookId) : "all",
  }),
  component: LeadLooksPage,
});

const TODAY = "2026-11-18";

const SAMPLES: Array<LeadRow & { bucket: LeadBucket; extra?: string }> = [
  {
    id: "preview-1",
    bucket: "overdue",
    full_name: "Maya Chen",
    phone: "5550101001",
    status: "reviewing",
    created_at: "2026-09-02T15:00:00.000Z",
    contact_status: "voicemail",
    contact_status_note: "Left a voicemail about the sedan. She asked for the weekly rate and whether insurance is included before she calls back.",
    extra: "Promising",
    contact_follow_up_on: "2026-10-10",
    contact_status_at: "2026-10-13T15:00:00.000Z",
    contact_status_by: null,
    source: "google",
    vehicle_size: "sedan",
  },
  {
    id: "preview-2",
    bucket: "new",
    full_name: "Andre Brooks",
    phone: "5550101002",
    status: "new",
    created_at: "2026-11-18T15:00:00.000Z",
    contact_status: "new",
    contact_status_note: null,
    contact_follow_up_on: null,
    contact_status_at: null,
    contact_status_by: null,
    source: "referral",
    vehicle_size: null,
  },
  {
    id: "preview-3",
    bucket: "interested",
    full_name: "Lucia Ramirez",
    phone: "5550101003",
    status: "approved",
    created_at: "2026-11-12T15:00:00.000Z",
    contact_status: "interested",
    contact_status_note: "Wants a minivan for airport runs.",
    contact_follow_up_on: "2026-11-18",
    contact_status_at: "2026-11-16T15:00:00.000Z",
    contact_status_by: null,
    source: "website",
    vehicle_size: "minivan",
  },
  {
    id: "preview-4",
    bucket: "information",
    full_name: "Jordan Ellis",
    phone: "5550101004",
    status: "reviewing",
    created_at: "2026-11-01T15:00:00.000Z",
    contact_status: "documents",
    contact_status_note: "Licence back is blurry. Asked them to resend a photo in daylight.",
    extra: "More Info Needed",
    contact_follow_up_on: null,
    contact_status_at: null,
    contact_status_by: null,
    source: null,
    vehicle_size: null,
  },
  {
    id: "preview-5",
    bucket: "future",
    full_name: "Samira Okonkwo",
    phone: "5550101005",
    status: "reviewing",
    created_at: "2026-10-28T15:00:00.000Z",
    contact_status: "follow_up",
    contact_status_note: null,
    contact_follow_up_on: "2026-11-20",
    contact_status_at: "2026-11-11T15:00:00.000Z",
    contact_status_by: null,
    source: "instagram",
    vehicle_size: "suv",
  },
  {
    id: "preview-6",
    bucket: "today",
    full_name: "Chris Dalton",
    phone: "5550101006",
    status: "new",
    created_at: "2026-11-17T15:00:00.000Z",
    contact_status: "attempted",
    contact_status_note: "No answer on the first call.",
    contact_follow_up_on: "2026-11-18",
    contact_status_at: "2026-11-17T15:00:00.000Z",
    contact_status_by: null,
    source: null,
    vehicle_size: null,
  },
];

const LEADS = SAMPLES.map((sample) => {
  const { bucket, extra, ...row } = sample;
  const lead = projectLead(row, bucket);
  return {
    lead,
    name: displayPersonName(lead.full_name ?? ""),
    phone: "5550101000",
    tags: [lead.contactLabel, extra].filter((tag): tag is string => Boolean(tag)),
  };
});

function LeadLooksPage() {
  const { look } = Route.useSearch();
  const visible = LEAD_LOOKS.filter((item) => look === "all" || item.id === look);
  return (
    <div className="min-h-screen space-y-10 bg-[#FAFAFB] p-4 md:p-8">
      <header className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Lead Priorities Looks</h1>
        <p className="mt-1 text-sm text-muted-foreground">Fictional sample cards. No live applicants. Overview uses Look A only.</p>
      </header>
      {visible.map((item) => (
        <section key={item.id} id={`look-${item.id}`} className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">{item.title}</h2>
            <p className="text-sm text-muted-foreground">{item.blurb}</p>
          </div>
          <LeadLookBoard id={item.id} leads={LEADS} today={TODAY} counts={{ fresh: 4, hot: 2, overdue: 7 }} />
        </section>
      ))}
    </div>
  );
}
