import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Upload,
  Loader2,
  Trash2,
  Star,
  Eye,
  EyeOff,
  Sparkles,
  Info,
  ImageOff,
  Link2,
} from "lucide-react";
import {
  listVehicleMedia,
  registerVehicleMedia,
  updateVehicleMedia,
  deleteVehicleMedia,
  enhanceVehiclePhoto,
  type VehicleMedia,
  type VehicleMediaList,
} from "@/lib/vehicle-media.functions";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import { SectionCard, MicroLabel, EmptyState } from "./ui";

// The gallery.
//
// Published photos feed the public fleet page, in the order shown here. That
// ordering is not maintained by this component — a database trigger derives
// vehicles.photos from the published rows — so what you arrange is what a
// visitor sees, and there is no second copy to fall out of step.
//
// Retouched images are labelled everywhere they appear, arrive unpublished,
// and say which original they came from. Inspection and damage evidence is not
// here at all; it lives in the inspection record, where nothing can retouch it.

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif";
const MAX_BYTES = 15 * 1024 * 1024;

export function VehiclePhotos({ vehicleId, canEdit }: { vehicleId: string; canEdit: boolean }) {
  const load = useServerFn(listVehicleMedia);
  const register = useServerFn(registerVehicleMedia);
  const update = useServerFn(updateVehicleMedia);
  const remove = useServerFn(deleteVehicleMedia);
  const enhanceFn = useServerFn(enhanceVehiclePhoto);

  const [data, setData] = useState<VehicleMediaList | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load({ data: { vehicleId } }));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [load, vehicleId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    setUploading(list.length);
    let ok = 0;
    for (const file of list) {
      try {
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name} is over 15MB.`);
          continue;
        }
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        const path = `${vehicleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from("vehicle-photos")
          .upload(path, file, { contentType: file.type || undefined });
        if (error) throw error;

        const res = await register({
          data: {
            vehicleId,
            path,
            fileName: file.name,
            mimeType: file.type || null,
            sizeBytes: file.size,
          },
        });
        if (!res.ok) throw new Error(res.error);
        ok++;
      } catch (e: any) {
        console.error("[photos] upload failed", e);
        toast.error(
          e?.message?.includes("row-level security")
            ? "You do not have permission to add photos."
            : `Could not upload ${file.name}.`,
        );
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (ok) toast.success(`${ok} photo${ok === 1 ? "" : "s"} added`);
    if (fileRef.current) fileRef.current.value = "";
    void refresh();
  }

  type MediaPatch = {
    id: string;
    caption?: string | null;
    published?: boolean;
    makePrimary?: boolean;
    sortOrder?: number;
  };

  async function patch(m: VehicleMedia, values: MediaPatch) {
    setBusyId(m.id);
    try {
      const res = await update({ data: values });
      if (!res.ok) return toast.error(res.error ?? "Could not update that photo.");
      await refresh();
    } catch {
      toast.error("Could not update that photo.");
    } finally {
      setBusyId(null);
    }
  }

  async function destroy(m: VehicleMedia) {
    const derivatives = (data?.items ?? []).filter((x) => x.derived_from_id === m.id).length;
    const extra = derivatives
      ? `\n\nThis will also remove ${derivatives} retouched version${derivatives === 1 ? "" : "s"} made from it.`
      : "";
    if (!confirm(`Delete this photo permanently?${extra}`)) return;
    setBusyId(m.id);
    try {
      const res = await remove({ data: { id: m.id } });
      if (!res.ok) return toast.error(res.error ?? "Could not delete that photo.");
      toast.success(
        res.removedDerivatives
          ? `Deleted, along with ${res.removedDerivatives} retouched version(s)`
          : "Deleted",
      );
      await refresh();
    } catch (e: any) {
      toast.error(
        e?.message === "Forbidden"
          ? "Deleting a photo is Manager-only."
          : "Could not delete that photo.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function enhance(m: VehicleMedia, mode: string) {
    setBusyId(m.id);
    try {
      const res = await enhanceFn({ data: { mediaId: m.id, mode: mode as any } });
      if (!res.ok) return toast.error(res.error ?? "Enhancement failed.");
      toast.success("Created a retouched version — review it before publishing.");
      await refresh();
    } catch (e: any) {
      toast.error(
        e?.message === "Forbidden" ? "Enhancement is Manager-only." : "Enhancement failed.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const items = data?.items ?? [];
  const originals = items.filter((m) => m.kind === "original");
  const enhanced = items.filter((m) => m.kind === "ai_enhanced");
  const publishedCount = items.filter((m) => m.published).length;
  const byId = new Map(items.map((m) => [m.id, m]));

  return (
    <div className="space-y-5">
      <SectionCard
        title="Photos"
        subtitle={
          loading
            ? "Loading…"
            : `${originals.length} original${originals.length === 1 ? "" : "s"}` +
              (enhanced.length ? ` · ${enhanced.length} retouched` : "") +
              ` · ${publishedCount} on the website`
        }
        right={
          canEdit ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => upload(e.target.files)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading > 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#D03020] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {uploading > 0 ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                {uploading > 0 ? `Uploading ${uploading}…` : "Add photos"}
              </button>
            </>
          ) : null
        }
      >
        {loading && !data ? (
          <div className="flex items-center gap-2 text-[13px] text-[#9A9AA3] py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading photos…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ImageOff className="w-6 h-6" strokeWidth={1.75} />}
            title="No photos yet"
            hint={
              canEdit
                ? "The first photo you add becomes the one the website leads with."
                : "Nobody has added photos for this vehicle."
            }
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map((m) => (
              <PhotoTile
                key={m.id}
                m={m}
                source={m.derived_from_id ? (byId.get(m.derived_from_id) ?? null) : null}
                canEdit={canEdit}
                canDelete={!!data?.canDelete}
                busy={busyId === m.id}
                enhancement={data!.enhancement}
                onPrimary={() => patch(m, { id: m.id, makePrimary: true })}
                onPublish={(v) => patch(m, { id: m.id, published: v })}
                onCaption={(c) => patch(m, { id: m.id, caption: c })}
                onDelete={() => destroy(m)}
                onEnhance={(mode) => enhance(m, mode)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {data && (
        <SectionCard
          title="Retouched images"
          icon={<Sparkles className="w-4 h-4" strokeWidth={1.75} />}
        >
          <div className="flex items-start gap-2.5 text-[12px] text-[#55555E] leading-relaxed">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#9A9AA3]" />
            <div className="space-y-2">
              <p>
                {data.enhancement.available ? data.enhancement.reason : data.enhancement.reason}
              </p>
              <p>
                A retouched image improves the lighting on the photograph you took. It never invents
                a car — a listing has to show the vehicle a driver will actually be handed the keys
                to. New ones arrive switched off and reach the website only when you publish them.
              </p>
              <p className="text-[#9A9AA3]">
                Inspection and damage evidence is kept in the inspection record, not here, and
                cannot be retouched.
              </p>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

const MODES = [
  { value: "clean_background", label: "Clean background" },
  { value: "studio", label: "Studio" },
  { value: "outdoor", label: "Outdoor" },
  { value: "dealer_listing", label: "Dealer listing" },
];

function PhotoTile({
  m,
  source,
  canEdit,
  canDelete,
  busy,
  enhancement,
  onPrimary,
  onPublish,
  onCaption,
  onDelete,
  onEnhance,
}: {
  m: VehicleMedia;
  source: VehicleMedia | null;
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  enhancement: { available: boolean; reason: string };
  onPrimary: () => void;
  onPublish: (v: boolean) => void;
  onCaption: (c: string) => void;
  onDelete: () => void;
  onEnhance: (mode: string) => void;
}) {
  const [caption, setCaption] = useState(m.caption ?? "");
  const url = resolvePhotoUrl(m.storage_path);
  const isEnhanced = m.kind === "ai_enhanced";

  return (
    <div
      className={`rounded-xl border overflow-hidden bg-white ${m.published ? "border-[#EDEDF0]" : "border-dashed border-[#DCDCE2]"}`}
    >
      <div className="relative aspect-[4/3] bg-[#F4F4F6]">
        {url ? (
          <img
            src={url}
            alt={m.caption ?? ""}
            className={`w-full h-full object-cover ${m.published ? "" : "opacity-60"}`}
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-[#C4C4CB]">
            <ImageOff className="w-5 h-5" />
          </div>
        )}

        <div className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
          {m.is_primary && m.published && (
            <Tag tone="dark">
              <Star className="w-2.5 h-2.5 fill-current" /> Lead
            </Tag>
          )}
          {isEnhanced && (
            <Tag tone="violet">
              <Sparkles className="w-2.5 h-2.5" /> Retouched
            </Tag>
          )}
          {m.provenance === "adopted" && <Tag tone="grey">Unverified origin</Tag>}
          {!m.published && <Tag tone="grey">Not on site</Tag>}
        </div>

        {busy && (
          <div className="absolute inset-0 bg-white/60 grid place-items-center">
            <Loader2 className="w-4 h-4 animate-spin text-[#55555E]" />
          </div>
        )}
      </div>

      <div className="p-2.5 space-y-2">
        {isEnhanced && (
          <div className="text-[10px] text-[#9A9AA3] flex items-center gap-1 truncate">
            <Link2 className="w-2.5 h-2.5 shrink-0" />
            {m.enhancement_mode?.replace(/_/g, " ")} of{" "}
            {source ? (source.file_name ?? "the original") : "a deleted original"}
          </div>
        )}

        {canEdit ? (
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => caption !== (m.caption ?? "") && onCaption(caption)}
            placeholder="Caption"
            className="w-full rounded-md border border-[#EDEDF0] px-2 py-1 text-[11px] outline-none focus:border-[#D03020] transition-colors"
          />
        ) : m.caption ? (
          <div className="text-[11px] text-[#55555E] truncate">{m.caption}</div>
        ) : null}

        {canEdit && (
          <div className="flex items-center gap-1">
            <IconBtn
              title={m.published ? "Remove from the website" : "Show on the website"}
              onClick={() => onPublish(!m.published)}
              disabled={busy}
            >
              {m.published ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </IconBtn>

            <IconBtn
              title={m.is_primary ? "Already the lead photo" : "Make this the lead photo"}
              onClick={onPrimary}
              disabled={busy || (m.is_primary && m.published)}
              active={m.is_primary && m.published}
            >
              <Star
                className={`w-3.5 h-3.5 ${m.is_primary && m.published ? "fill-current" : ""}`}
              />
            </IconBtn>

            {!isEnhanced && (
              <EnhanceMenu
                disabled={busy || !enhancement.available}
                reason={enhancement.reason}
                onPick={onEnhance}
              />
            )}

            <div className="flex-1" />

            {canDelete && (
              <IconBtn title="Delete permanently" onClick={onDelete} disabled={busy} danger>
                <Trash2 className="w-3.5 h-3.5" />
              </IconBtn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EnhanceMenu({
  disabled,
  reason,
  onPick,
}: {
  disabled: boolean;
  reason: string;
  onPick: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconBtn
        title={disabled ? reason : "Create a retouched version"}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
      >
        <Sparkles className="w-3.5 h-3.5" />
      </IconBtn>
      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 left-0 mt-1 w-44 rounded-lg border border-[#EDEDF0] bg-white shadow-lg py-1">
            {MODES.map((mo) => (
              <button
                key={mo.value}
                onClick={() => {
                  setOpen(false);
                  onPick(mo.value);
                }}
                className="block w-full text-left px-3 py-1.5 text-[12px] text-[#111114] hover:bg-[#FAFAFB]"
              >
                {mo.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md p-1.5 transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
        active
          ? "text-[#C68A12]"
          : danger
            ? "text-[#9A9AA3] hover:text-[#D03020] hover:bg-[#FAFAFB]"
            : "text-[#55555E] hover:text-[#111114] hover:bg-[#F4F4F6]"
      }`}
    >
      {children}
    </button>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: "dark" | "violet" | "grey" }) {
  const cls =
    tone === "dark"
      ? "bg-[#111114] text-white"
      : tone === "violet"
        ? "bg-[#6B4FBB] text-white"
        : "bg-white/90 text-[#55555E] border border-[#EDEDF0]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}
