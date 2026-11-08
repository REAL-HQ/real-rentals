import { enumDisplayLabel } from "@/lib/ui-display-labels";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { fmtDate } from "@/lib/date-format";
import { getRenterPortal, getRenterPortalFileUrl } from "@/lib/renter-portal.functions";
import {
  COMPANY_INSURANCE_SLOT_ENABLED,
  insuranceOnFile,
  recordsVisible,
  renterSections,
  type RenterPortalSummary,
} from "@/lib/renter-portal";
import {
  CONDITION_SECTIONS,
  ROLE_SUBSECTION,
  groupConditionPhotos,
} from "@/lib/condition-photos";
import { fmtDateTime } from "@/lib/date-format";

const money = (n: number) => Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
const nyToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/**
 * Plate/VIN for an assigned renter; registration, own insurance, photos and
 * receipts once active; photos/receipts for 1 year after return. Every value
 * here comes from public.renter_portal_summary, which already enforces this.
 */
export function RenterPortalCard({
  onOpenDocuments,
  onOpenSettings,
  onOpenPictures,
  previewDriverId = null,
  readOnly = false,
}: {
  onOpenDocuments: () => void;
  onOpenSettings: () => void;
  /** Jump to the Pictures tab for full upload UI. */
  onOpenPictures?: () => void;
  /** Staff preview: load this driver's portal (server re-checks Manager/Owner). */
  previewDriverId?: string | null;
  readOnly?: boolean;
}) {
  const read = useServerFn(getRenterPortal);
  const { data, isLoading, error } = useQuery({
    queryKey: ["renter-portal", previewDriverId ?? "self"],
    queryFn: () => read({ data: previewDriverId ? { previewDriverId } : {} }),
  });
  if (isLoading) return <div className="text-sm text-muted-foreground">Loading your rental…</div>;
  if (error || !data) return null;
  return (
    <RenterPortalView
      data={data}
      onOpenDocuments={onOpenDocuments}
      onOpenSettings={onOpenSettings}
      onOpenPictures={onOpenPictures}
      previewDriverId={previewDriverId}
      readOnly={readOnly || !!previewDriverId}
    />
  );
}

export function RenterPortalView({
  data,
  onOpenDocuments,
  onOpenSettings,
  onOpenPictures,
  previewDriverId = null,
  readOnly = false,
}: {
  data: RenterPortalSummary;
  onOpenDocuments: () => void;
  onOpenSettings: () => void;
  onOpenPictures?: () => void;
  previewDriverId?: string | null;
  readOnly?: boolean;
}) {
  const sections = renterSections(data.stage, {
    recordsVisible: recordsVisible(data.stage, data.returnedOn ?? null, nyToday()),
    companyInsurance: COMPANY_INSURANCE_SLOT_ENABLED,
  });
  if (sections.length === 0) return null;
  const has = (s: (typeof sections)[number]) => sections.includes(s);
  const ins = insuranceOnFile(data.insurance ?? []);
  const photoGroups = groupConditionPhotos(
    (data.photos ?? []).map((p) => ({
      id: p.id,
      phase: p.phase,
      capturedByRole: p.capturedByRole,
      angle: p.angle,
      mediaType: p.mediaType,
      takenAt: p.takenAt,
      takenAtSource: p.takenAtSource,
    })),
  );

  return (
    <div className="space-y-4" data-testid="renter-portal">
      {has("plate") || has("vin") ? (
        <Card title={data.stage === "assigned" ? "Your Assigned Car" : "Your Car"}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Item label="Plate" value={[data.plate, data.plateState].filter(Boolean).join(" · ") || "Not set yet"} />
            <Item label="VIN" value={data.vin || "Not set yet"} mono />
          </div>
          {data.stage === "assigned" ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Registration, insurance, photos and receipts appear here once your rental is active.
            </p>
          ) : null}
        </Card>
      ) : null}

      {has("registration") && data.registration ? (
        <Card title="Registration">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <Item label="State" value={data.registration.state || "—"} />
            <Item label="Number" value={data.registration.number || "—"} />
            <Item label="Expires" value={data.registration.expiresOn ? fmtDate(data.registration.expiresOn) : "—"} />
          </div>
          <FileList kind="registration" files={data.registration.files} empty="Registration copy not uploaded yet." previewDriverId={previewDriverId} />
        </Card>
      ) : null}

      {has("insurance") ? (
        <Card title="Your Insurance">
          <p className="text-xs text-muted-foreground">
            You provide your own insurance for now. Your verified card stays valid until our team reviews a new upload.
          </p>
          <div className="mt-3 space-y-2 text-sm">
            {ins.verified ? (
              <FileRow kind="insurance" id={ins.verified.id} label={`On file: ${ins.verified.label}`}
                sub={ins.verified.expiresOn ? `Expires ${fmtDate(ins.verified.expiresOn)}` : "Verified"} previewDriverId={previewDriverId} />
            ) : (
              <div className="text-muted-foreground">No verified insurance on file.</div>
            )}
            {ins.pending ? (
              <FileRow kind="insurance" id={ins.pending.id} label={`Under review: ${ins.pending.label}`} sub="Waiting on our team" previewDriverId={previewDriverId} />
            ) : null}
          </div>
          {readOnly ? (
            <p className="mt-3 text-xs text-muted-foreground">Uploads and contact edits are disabled in Driver Preview.</p>
          ) : (
            <div className="mt-3 flex gap-3 text-sm">
              <button type="button" className="text-real-red hover:underline" onClick={onOpenDocuments}>Upload New Insurance</button>
              <button type="button" className="text-real-red hover:underline" onClick={onOpenSettings}>Update Contact Details</button>
            </div>
          )}
        </Card>
      ) : null}

      {has("companyInsurance") ? <Card title="Company Insurance"><p className="text-sm">Coming soon.</p></Card> : null}

      {has("photos") ? (
        <Card title="Photos">
          {data.stage === "returned" && data.returnedOn ? (
            <p className="text-xs text-muted-foreground mb-2">Available for one year after your return on {fmtDate(data.returnedOn)}.</p>
          ) : null}
          {onOpenPictures ? (
            <p className="text-xs text-muted-foreground mb-3">
              <button type="button" className="text-real-red hover:underline" onClick={onOpenPictures}>
                Open Pictures
              </button>{" "}
              to upload or review Pickup, Return, and Issues.
            </p>
          ) : null}
          {(data.photos ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No photos yet.</p>
          ) : (
            <div className="space-y-4">
              {CONDITION_SECTIONS.map((section) => {
                const grouped = photoGroups;
                const bucket = grouped[section.key];
                const rows = [
                  ...bucket.staff.map((p) => ({ ...p, _role: "staff" as const })),
                  ...bucket.driver.map((p) => ({ ...p, _role: "driver" as const })),
                ];
                if (rows.length === 0) return null;
                return (
                  <div key={section.key}>
                    <div className="text-xs tracking-wider text-muted-foreground font-semibold mb-1">
                      {section.title}
                    </div>
                    <ul className="divide-y divide-border">
                      {rows.map((p) => (
                        <FileRow
                          key={p.id}
                          kind="photo"
                          id={p.id}
                          label={[ROLE_SUBSECTION[p._role], (p as any).angle?.replace(/_/g, " ")].filter(Boolean).join(" · ") || ROLE_SUBSECTION[p._role]}
                          sub={`${fmtDateTime((p as any).takenAt)}${(p as any).takenAtSource === "exif" ? "" : " · upload time"}`}
                          previewDriverId={previewDriverId}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

      {has("receipts") ? (
        <Card title="Receipts">
          {(data.receipts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {(data.receipts ?? []).map((r) => (
                <li key={r.id} className="py-2 flex justify-between gap-4">
                  <span className="">{enumDisplayLabel((r.type ?? "payment"))} · {r.paidDate ? fmtDate(r.paidDate) : "—"}</span>
                  <span className="font-medium">{money(r.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-medium break-all ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function FileList({
  kind,
  files,
  empty,
  previewDriverId = null,
}: {
  kind: "registration";
  files: { id: string; label: string; expiresOn: string | null }[];
  empty: string;
  previewDriverId?: string | null;
}) {
  if (files.length === 0) return <p className="mt-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="mt-3 divide-y divide-border">
      {files.map((f) => (
        <FileRow
          key={f.id}
          kind={kind}
          id={f.id}
          label={f.label}
          sub={f.expiresOn ? `Expires ${fmtDate(f.expiresOn)}` : ""}
          previewDriverId={previewDriverId}
        />
      ))}
    </ul>
  );
}

function FileRow({
  kind,
  id,
  label,
  sub,
  previewDriverId = null,
}: {
  kind: "photo" | "registration" | "insurance";
  id: string;
  label: string;
  sub: string;
  previewDriverId?: string | null;
}) {
  const open = useServerFn(getRenterPortalFileUrl);
  const [busy, setBusy] = useState(false);
  return (
    <li className="py-2 flex items-center justify-between gap-4 list-none">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{label}</div>
        {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      </div>
      <button
        type="button"
        disabled={busy}
        className="text-xs text-real-red hover:underline shrink-0"
        onClick={async () => {
          setBusy(true);
          try {
            const { url } = await open({
              data: previewDriverId ? { kind, id, previewDriverId } : { kind, id },
            });
            window.open(url, "_blank", "noopener,noreferrer");
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening…" : "Open"}
      </button>
    </li>
  );
}
