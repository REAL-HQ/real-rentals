import { useEffect, useState, type ReactNode } from "react";
import { X, Loader2, Lock } from "lucide-react";

// One domain, one drawer.
//
// It slides over the record rather than replacing it, so the thing you are
// changing stays visible behind you. Escape closes it, the backdrop closes it,
// and a save in flight closes nothing — losing a half-written policy number to
// a stray click is the kind of small betrayal people remember.

export function VehicleEditDrawer({
  title,
  subtitle,
  icon,
  managerOnly = false,
  saving,
  onClose,
  onSave,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  managerOnly?: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // One frame before the transform, so the panel animates in rather than
    // appearing already open.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${mounted ? "opacity-100" : "opacity-0"}`}
        onClick={() => !saving && onClose()}
      />
      <div
        className={`relative h-full w-full max-w-[520px] bg-white shadow-2xl flex flex-col transition-transform duration-200 ease-out ${
          mounted ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-start gap-3 border-b border-[#EDEDF0] px-5 py-4">
          {icon && <span className="text-[#55555E] mt-0.5">{icon}</span>}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-[#111114] truncate">{title}</h2>
              {managerOnly && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F4F6] px-2 py-0.5 text-[10px] font-medium text-[#55555E]">
                  <Lock className="w-3 h-3" /> Managers
                </span>
              )}
            </div>
            {subtitle && <p className="text-[12px] text-[#9A9AA3] mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="shrink-0 rounded-md p-1 text-[#9A9AA3] hover:text-[#111114] hover:bg-[#F4F4F6] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>

        <footer className="flex items-center justify-end gap-2 border-t border-[#EDEDF0] px-5 py-3.5">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3.5 py-2 text-[13px] text-[#55555E] hover:bg-[#F4F4F6] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-[#D03020] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save changes
          </button>
        </footer>
      </div>
    </div>
  );
}
