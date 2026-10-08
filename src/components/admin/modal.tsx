import { useEffect, useRef, type ReactNode } from "react";
import { X, ArrowLeft, Check, Circle } from "lucide-react";
import { FileUploader } from "@/components/FileUploader";

// Shared back-office modal system. Visual behavior only — no business logic.
// Sizes: sm (confirmations), md (normal forms), lg (multi-section forms),
// workspace (review flows). Esc + backdrop close, body scroll lock, stable
// header/footer with a scrolling body, full-width sheet on phones.

const SIZES = {
  sm: "sm:max-w-md",
  md: "sm:max-w-[680px]",
  lg: "sm:max-w-3xl",
  workspace: "sm:max-w-6xl",
} as const;

export type ModalSize = keyof typeof SIZES;

export function ModalShell({
  onClose, size = "md", label, children, closeOnBackdrop = true, z = "z-50",
}: {
  onClose: () => void; size?: ModalSize; label: string; children: ReactNode;
  closeOnBackdrop?: boolean; z?: string;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label={label}
      className={`fixed inset-0 ${z} flex items-end sm:items-center justify-center bg-overlay sm:p-6`}
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}>
      <div className={`flex w-full ${SIZES[size]} max-h-[94dvh] sm:max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl bg-card text-card-foreground shadow-xl`}>
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, subtitle, onClose, onBack }: {
  title: ReactNode; subtitle?: ReactNode; onClose?: () => void; onBack?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-border px-6 py-4">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Back"
          className="-ml-2 mt-0.5 grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-[17px] font-semibold leading-7 tracking-tight">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Close"
          className="-mr-2 grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-[18px] w-[18px]" />
        </button>
      )}
    </div>
  );
}

export function ModalBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 space-y-6 ${className}`}>{children}</div>;
}

export function ModalSection({ label, children, aside }: { label?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3">
      {(label || aside) && (
        <div className="flex items-center justify-between">
          {label && <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function ModalFooter({ children, left }: { children: ReactNode; left?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-muted/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex">{left}</div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">{children}</div>
    </div>
  );
}

export const inputCls =
  "h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10";

export function Field({ label, required, children, className = "", error }: {
  label: string; required?: boolean; children: ReactNode; className?: string; error?: string | null;
}) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="text-[13px] font-medium text-foreground">
        {label}{required && <span className="ml-0.5 text-brand">*</span>}
      </span>
      {children}
      {error && <span className="block text-xs text-brand">{error}</span>}
    </label>
  );
}

export function FormGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 6 }) {
  const c = cols === 2 ? "sm:grid-cols-2" : cols === 6 ? "sm:grid-cols-6" : "sm:grid-cols-3";
  return <div className={`grid grid-cols-1 gap-4 ${c}`}>{children}</div>;
}

type BtnVariant = "primary" | "secondary" | "ghost";
export function ModalButton({ variant = "secondary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const v = variant === "primary"
    ? "bg-brand text-brand-foreground hover:bg-brand/90 disabled:bg-muted disabled:text-muted-foreground"
    : variant === "ghost"
      ? "text-muted-foreground hover:text-foreground hover:bg-muted"
      : "border border-border bg-card text-foreground hover:bg-muted disabled:opacity-50";
  return <button type="button" {...p}
    className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed ${v} ${className}`} />;
}

export function UploadDropzone({ file, onFile, accept = "image/*", title = "Add Photo", hint = "Drag & drop or browse", note, context, camera }: {
  file: File | null; onFile: (f: File | null) => void; accept?: string; title?: string; hint?: string; note?: string; context?: string; camera?: boolean;
}) {
  return (
    <FileUploader
      value={file ? [file] : []}
      onChange={(files) => onFile(files[0] ?? null)}
      accept={accept}
      multiple={false}
      camera={camera}
      title={title}
      hint={note ? `${hint} · ${note}` : hint}
      context={context}
      label="Browse Files"
    />
  );
}

export function ReadinessStatus({ items }: { items: { label: string; ready: boolean; missing?: string }[] }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border">
      {items.map((i) => (
        <div key={i.label} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium">{i.label}</span>
          {i.ready ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
              <Check className="h-3.5 w-3.5" /> Ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Circle className="h-3 w-3" /> {i.missing ?? "Not Ready"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, busy }: {
  title: string; children: ReactNode; confirmLabel: ReactNode; onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  return (
    <ModalShell onClose={onCancel} size="sm" label={title}>
      <ModalHeader title={title} onClose={onCancel} />
      <ModalBody className="space-y-3">{children}</ModalBody>
      <ModalFooter>
        <ModalButton onClick={onCancel}>Cancel</ModalButton>
        <ModalButton variant="primary" onClick={onConfirm} disabled={busy}>{confirmLabel}</ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}
