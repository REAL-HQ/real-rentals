import { Phone, ArrowRight } from "lucide-react";

export function StickyCallBar({ onApplyClick }: { onApplyClick?: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 sm:hidden border-t border-border bg-white/95 backdrop-blur-md shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)]">
      <div className="grid grid-cols-2 gap-2 p-2">
        <a
          href="tel:+18135550100"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-real-red px-3 py-3 text-sm font-semibold text-real-red active:scale-95 transition"
          aria-label="Call REAL RENTALS"
        >
          <Phone className="w-4 h-4" strokeWidth={2.25} /> Call Now
        </a>
        <button
          type="button"
          onClick={onApplyClick}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-real-red px-3 py-3 text-sm font-semibold text-white active:scale-95 transition"
        >
          Get Quote <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}