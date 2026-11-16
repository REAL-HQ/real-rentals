import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/** Full-screen on a phone, a card on a desktop. Backdrop-only close. */
export function Modal({
  title,
  onClose,
  children,
  wide,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  testId: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid={testId}
        className={`bg-white w-full ${wide ? "max-w-3xl" : "max-w-lg"} min-h-full sm:min-h-0 rounded-none sm:rounded-2xl shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#EDEDF0] px-5 py-4">
          <h3 className="text-[15px] font-semibold text-[#111114]">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-[#9A9AA3] hover:bg-[#F4F4F6] hover:text-[#111114]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
