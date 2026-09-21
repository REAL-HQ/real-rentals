import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, Truck, MapPin, Phone, Mail, Globe, Star, Trash2 } from "lucide-react";
import { StatusPill, EmptyState, MicroLabel } from "./ui";

type Vendor = {
  id: string;
  name: string;
  vendor_type: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  market_id: string | null;
  services: string[];
  hours: string | null;
  account_number: string | null;
  rate_notes: string | null;
  preferred: boolean;
  rating: number | null;
  is_active: boolean;
  notes: string | null;
};

export const VENDOR_TYPES = [
  { value: "maintenance", label: "Maintenance / Mechanic" },
  { value: "body_shop", label: "Body Shop" },
  { value: "tires", label: "Tires" },
  { value: "towing", label: "Towing / Recovery" },
  { value: "detailing", label: "Detailing / Cleaning" },
  { value: "gps", label: "GPS / Telematics" },
  { value: "insurance", label: "Insurance" },
  { value: "dmv", label: "DMV / Registration" },
  { value: "parts", label: "Parts Supplier" },
  { value: "fuel", label: "Fuel / Tolls" },
  { value: "other", label: "Other" },
];

const EMPTY: Omit<Vendor, "id"> = {
  name: "",
  vendor_type: "maintenance",
  contact_name: null,
  phone: null,
  email: null,
  website: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  market_id: null,
  services: [],
  hours: null,
  account_number: null,
  rate_notes: null,
  preferred: false,
  rating: null,
  is_active: true,
  notes: null,
};

export function VendorsPanel() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [markets, setMarkets] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const [v, m] = await Promise.all([
      supabase.from("vendors").select("*").order("preferred", { ascending: false }).order("name"),
      supabase.from("markets").select("id, name").order("name"),
    ]);
    if (v.error) toast.error(v.error.message);
    setVendors((v.data as any) ?? []);
    setMarkets((m.data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => {
      if (typeFilter !== "all" && v.vendor_type !== typeFilter) return false;
      if (!q) return true;
      return [v.name, v.contact_name, v.phone, v.city, ...(v.services ?? [])]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [vendors, typeFilter, search]);

  async function remove(id: string) {
    if (!confirm("Delete this vendor?")) return;
    const { error } = await supabase.from("vendors").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  }

  // Types that actually have vendors, so the filter row stays short.
  const presentTypes = VENDOR_TYPES.filter((t) => vendors.some((v) => v.vendor_type === t.value));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {filtered.length} of {vendors.length} vendor(s)
        </span>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendors…"
            className="rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm w-48"
          />
          <button
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity duration-150"
          >
            <Plus className="w-4 h-4" /> Add Vendor
          </button>
        </div>
      </div>

      {presentTypes.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
            All
          </FilterChip>
          {presentTypes.map((t) => (
            <FilterChip
              key={t.value}
              active={typeFilter === t.value}
              onClick={() => setTypeFilter(t.value)}
            >
              {t.label}
            </FilterChip>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Truck className="w-6 h-6" strokeWidth={1.75} />}
          title={vendors.length === 0 ? "No Vendors Yet" : "No Matching Vendors"}
          hint={
            vendors.length === 0
              ? "Add the shops, tow companies, GPS installers and insurers you work with so the team has one list to call from."
              : "Try a different search or filter."
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((v) => (
            <div
              key={v.id}
              className="rounded-2xl border border-[#EDEDF0] p-4 bg-white shadow-sm transition-colors duration-150 hover:border-[#D9D9DE]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold truncate">{v.name}</h3>
                    {v.preferred ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#FDF3E7] text-[#8A5A00] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                        <Star className="w-3 h-3 fill-current" /> Preferred
                      </span>
                    ) : null}
                    {!v.is_active ? <StatusPill status="paused">Inactive</StatusPill> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {VENDOR_TYPES.find((t) => t.value === v.vendor_type)?.label ?? v.vendor_type}
                    {v.contact_name ? ` · ${v.contact_name}` : ""}
                    {v.rating ? ` · ${"★".repeat(v.rating)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditing(v)}
                    className="text-xs font-semibold text-[#D03020] px-2 py-1"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(v.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#55555E] hover:text-[#D03020]"
                    title="Delete vendor"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-1 text-sm">
                {v.phone ? (
                  <a
                    href={`tel:${v.phone.replace(/[^\d+]/g, "")}`}
                    className="flex items-center gap-1.5 text-[#55555E] hover:text-[#D03020]"
                  >
                    <Phone className="w-3.5 h-3.5 shrink-0" /> {v.phone}
                  </a>
                ) : null}
                {v.email ? (
                  <a
                    href={`mailto:${v.email}`}
                    className="flex items-center gap-1.5 text-[#55555E] hover:text-[#D03020]"
                  >
                    <Mail className="w-3.5 h-3.5 shrink-0" />{" "}
                    <span className="truncate">{v.email}</span>
                  </a>
                ) : null}
                {v.website ? (
                  <a
                    href={v.website.startsWith("http") ? v.website : `https://${v.website}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-[#55555E] hover:text-[#D03020]"
                  >
                    <Globe className="w-3.5 h-3.5 shrink-0" />{" "}
                    <span className="truncate">{v.website}</span>
                  </a>
                ) : null}
                {v.address || v.city ? (
                  <div className="flex items-start gap-1.5 text-[#55555E]">
                    <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{[v.address, v.city, v.state, v.zip].filter(Boolean).join(", ")}</span>
                  </div>
                ) : null}
              </div>

              {v.services?.length ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {v.services.map((s) => (
                    <span
                      key={s}
                      className="rounded-md bg-[#F6F6F8] px-2 py-0.5 text-[11px] text-[#55555E]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}

              {v.rate_notes || v.account_number || v.hours ? (
                <div className="mt-3 pt-3 border-t border-[#EDEDF0] text-xs text-muted-foreground space-y-0.5">
                  {v.hours ? <div>Hours: {v.hours}</div> : null}
                  {v.account_number ? <div>Account #: {v.account_number}</div> : null}
                  {v.rate_notes ? <div>Rates: {v.rate_notes}</div> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <VendorForm
          vendor={editing === "new" ? null : editing}
          markets={markets}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
        active
          ? "border-[#D03020] bg-[#D03020] text-white"
          : "border-[#EDEDF0] text-[#55555E] hover:border-[#D6D6DB]"
      }`}
    >
      {children}
    </button>
  );
}

function VendorForm({
  vendor,
  markets,
  onClose,
  onSaved,
}: {
  vendor: Vendor | null;
  markets: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Omit<Vendor, "id">>(vendor ? { ...vendor } : { ...EMPTY });
  const [servicesText, setServicesText] = useState((vendor?.services ?? []).join(", "));
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Omit<Vendor, "id">>(k: K, v: Omit<Vendor, "id">[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    if (f.name.trim().length < 2) return toast.error("Vendor name is required.");
    setBusy(true);
    const payload = {
      ...f,
      name: f.name.trim(),
      services: servicesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const { error } = vendor
      ? await supabase.from("vendors").update(payload).eq("id", vendor.id)
      : await supabase.from("vendors").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#EDEDF0] sticky top-0 bg-white">
          <h3 className="font-semibold">{vendor ? "Edit Vendor" : "Add Vendor"}</h3>
          <button onClick={onClose} className="text-[#55555E] hover:text-[#111114]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Txt label="Name" v={f.name} onChange={(s) => set("name", s)} />
          <div>
            <MicroLabel>Type</MicroLabel>
            <select
              value={f.vendor_type}
              onChange={(e) => set("vendor_type", e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
            >
              {VENDOR_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <Txt
            label="Contact name"
            v={f.contact_name ?? ""}
            onChange={(s) => set("contact_name", s || null)}
          />
          <Txt label="Phone" v={f.phone ?? ""} onChange={(s) => set("phone", s || null)} />
          <Txt label="Email" v={f.email ?? ""} onChange={(s) => set("email", s || null)} />
          <Txt label="Website" v={f.website ?? ""} onChange={(s) => set("website", s || null)} />
          <Txt label="Address" v={f.address ?? ""} onChange={(s) => set("address", s || null)} />
          <Txt label="City" v={f.city ?? ""} onChange={(s) => set("city", s || null)} />
          <Txt label="State" v={f.state ?? ""} onChange={(s) => set("state", s || null)} />
          <Txt label="ZIP" v={f.zip ?? ""} onChange={(s) => set("zip", s || null)} />
          <div>
            <MicroLabel>Market</MicroLabel>
            <select
              value={f.market_id ?? ""}
              onChange={(e) => set("market_id", e.target.value || null)}
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
            >
              <option value="">All markets</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <Txt label="Hours" v={f.hours ?? ""} onChange={(s) => set("hours", s || null)} />
          <Txt
            label="Account #"
            v={f.account_number ?? ""}
            onChange={(s) => set("account_number", s || null)}
          />
          <div>
            <MicroLabel>Rating</MicroLabel>
            <select
              value={f.rating ?? ""}
              onChange={(e) => set("rating", e.target.value ? Number(e.target.value) : null)}
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
            >
              <option value="">Not rated</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {"★".repeat(n)}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <Txt
              label="Services (comma separated)"
              v={servicesText}
              onChange={setServicesText}
              placeholder="Oil change, Brakes, Tires, Alignment"
            />
          </div>
          <div className="sm:col-span-2">
            <Txt
              label="Rate notes"
              v={f.rate_notes ?? ""}
              onChange={(s) => set("rate_notes", s || null)}
              placeholder="$65/hr labor, 10% fleet discount"
            />
          </div>
          <div className="sm:col-span-2">
            <MicroLabel>Notes</MicroLabel>
            <textarea
              value={f.notes ?? ""}
              onChange={(e) => set("notes", e.target.value || null)}
              rows={3}
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.preferred}
              onChange={(e) => set("preferred", e.target.checked)}
            />
            Preferred vendor
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
            />
            Active
          </label>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-[#EDEDF0] sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Txt({
  label,
  v,
  onChange,
  placeholder,
}: {
  label: string;
  v: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <input
        value={v}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
      />
    </div>
  );
}
