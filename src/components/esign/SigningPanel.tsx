import { useEffect, useMemo, useRef, useState } from "react";
import {
  SIGNATURE_STYLES, SIGNATURE_FONTS_HREF, ackRows, defaultInitials,
  type Adoption, type Mark, type SignatureStyle,
} from "@/lib/signature-adoption";
import { isStructured } from "@/lib/agreement-layout";

type Stroke = [number, number][];

function useSignatureFonts() {
  useEffect(() => {
    if (document.querySelector(`link[href="${SIGNATURE_FONTS_HREF}"]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = SIGNATURE_FONTS_HREF;
    document.head.appendChild(l);
  }, []);
}

export function MarkView({ mark, height = 44 }: { mark: Mark; height?: number }) {
  if (mark.method === "typed") {
    const fam = SIGNATURE_STYLES.find((s) => s.key === mark.style)?.family;
    return <span style={{ fontFamily: fam, fontSize: height * 0.8, lineHeight: `${height}px` }} className="text-[#0D1A59] whitespace-nowrap">{mark.text}</span>;
  }
  const w = height * mark.aspect;
  return (
    <svg width={w} height={height} viewBox={`0 0 ${mark.aspect} 1`} className="max-w-full" aria-label="Drawn mark">
      {mark.strokes.map((s, i) =>
        s.length === 1
          ? <circle key={i} cx={s[0][0] * mark.aspect} cy={s[0][1]} r={0.02} fill="#0D1A59" />
          : <polyline key={i} points={s.map(([x, y]) => `${x * mark.aspect},${y}`).join(" ")} fill="none" stroke="#0D1A59" strokeWidth={0.035} strokeLinecap="round" strokeLinejoin="round" />,
      )}
    </svg>
  );
}

/** Finger/mouse/pen drawing pad. Emits normalized strokes. */
function DrawPad({ height, onChange, label }: { height: number; onChange: (m: Mark | null) => void; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const size = () => { const c = ref.current!; const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, r }; };
  const redraw = () => {
    const c = ref.current; if (!c) return;
    const { w, h } = size(); const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.strokeStyle = "#0D1A59"; g.fillStyle = "#0D1A59"; g.lineWidth = Math.max(2, h / 45); g.lineCap = "round"; g.lineJoin = "round";
    for (const s of strokes.current) {
      if (s.length === 1) { g.beginPath(); g.arc(s[0][0] * w, s[0][1] * h, g.lineWidth / 2, 0, 7); g.fill(); continue; }
      g.beginPath(); g.moveTo(s[0][0] * w, s[0][1] * h); for (const [x, y] of s.slice(1)) g.lineTo(x * w, y * h); g.stroke();
    }
  };
  useEffect(() => { redraw(); const f = () => redraw(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); });
  const emit = () => {
    const { w, h } = size();
    setEmpty(!strokes.current.length);
    onChange(strokes.current.length ? { method: "drawn", strokes: strokes.current.map((s) => s.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)] as [number, number])), aspect: Math.min(8, Math.max(1, +(w / h).toFixed(3))) } : null);
  };
  const pt = (e: React.PointerEvent): [number, number] => {
    const { w, h, r } = size();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / w)), Math.min(1, Math.max(0, (e.clientY - r.top) / h))];
  };
  return (
    <div>
      <div className="relative rounded-lg border-2 border-dashed border-[#C9C9D1] bg-white">
        <canvas
          ref={ref}
          aria-label={label}
          style={{ height, touchAction: "none" }}
          className="block w-full cursor-crosshair"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; strokes.current.push([pt(e)]); redraw(); }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const s = strokes.current[strokes.current.length - 1];
            const p = pt(e), q = s[s.length - 1];
            if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.004 && s.length < 2000) { s.push(p); redraw(); }
          }}
          onPointerUp={() => { if (drawing.current) { drawing.current = false; emit(); } }}
          onPointerCancel={() => { if (drawing.current) { drawing.current = false; emit(); } }}
        />
        {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-[#9A9AA2]">Draw here with your finger or mouse</span>}
        <span className="pointer-events-none absolute bottom-6 left-4 right-4 border-b border-[#DEDEE3]" />
      </div>
      <button type="button" onClick={() => { strokes.current = []; redraw(); emit(); }} className="mt-2 min-h-11 rounded-lg border border-[#DEDEE3] px-4 text-[14px] font-medium text-[#28282E]">Clear</button>
    </div>
  );
}

function MarkPicker({ kind, text, onAdopt }: { kind: "signature" | "initials"; text: string; onAdopt: (m: Mark) => void }) {
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  const [style, setStyle] = useState<SignatureStyle>("script1");
  const [drawn, setDrawn] = useState<Mark | null>(null);
  const typed: Mark | null = text.trim() ? { method: "typed", text: text.trim(), style } : null;
  const current = mode === "typed" ? typed : drawn;
  const noun = kind === "signature" ? "Signature" : "Initials";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2" role="tablist">
        {(["typed", "drawn"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={`min-h-11 rounded-lg border text-[14px] font-semibold ${mode === m ? "border-[#D03020] bg-[#FFF3F1] text-[#D03020]" : "border-[#DEDEE3] text-[#55555E]"}`}>
            {m === "typed" ? `Type ${noun}` : `Draw ${noun}`}
          </button>
        ))}
      </div>
      {mode === "typed" ? (
        <div className="grid gap-2">
          {SIGNATURE_STYLES.map((s) => (
            <button key={s.key} type="button" onClick={() => setStyle(s.key)} aria-pressed={style === s.key}
              className={`flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-2 text-left ${style === s.key ? "border-[#D03020] ring-2 ring-[#D03020]/20" : "border-[#DEDEE3]"}`}>
              <span className="min-w-0 overflow-hidden text-[#0D1A59]" style={{ fontFamily: s.family, fontSize: kind === "signature" ? 30 : 26 }}>{text.trim() || (kind === "signature" ? "Your Name" : "AB")}</span>
              <span className="shrink-0 text-[11px] text-[#77777F]">{s.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <DrawPad height={kind === "signature" ? 170 : 120} onChange={setDrawn} label={`Draw ${noun}`} />
      )}
      <button type="button" disabled={!current} onClick={() => current && onAdopt(current)}
        className="min-h-12 w-full rounded-lg bg-[#111114] px-5 text-[15px] font-semibold text-white disabled:opacity-40">
        Adopt {noun}
      </button>
    </div>
  );
}

export function SigningPanel({ body, defaultName, companySigner, busy, error, onSubmit }: {
  body: string;
  defaultName: string;
  companySigner?: string;
  busy: boolean;
  error?: string | null;
  onSubmit: (v: { signerName: string; adoption: Adoption }) => void;
}) {
  useSignatureFonts();
  const rows = useMemo(() => ackRows(body), [body]);
  const [name, setName] = useState(defaultName);
  const [initialsText, setInitialsText] = useState(defaultInitials(defaultName));
  const [sig, setSig] = useState<Mark | null>(null);
  const [ini, setIni] = useState<Mark | null>(null);
  const [acks, setAcks] = useState<boolean[]>(() => rows.map(() => false));
  const [agree, setAgree] = useState(false);
  useEffect(() => setAcks(rows.map(() => false)), [rows]);

  const nameOk = name.trim().split(/\s+/).length >= 2;
  const sigMatches = !sig || sig.method !== "typed" || sig.text.toLowerCase() === name.trim().toLowerCase();
  const allAcks = acks.every(Boolean);
  const ready = nameOk && !!sig && sigMatches && !!ini && allAcks && agree && !busy;
  const left = acks.filter((a) => !a).length;

  const card = "rounded-xl border border-[#EDEDF0] bg-white p-5 sm:p-6";
  const h2 = "text-[16px] font-semibold text-[#111114]";

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className={h2}>1. Your Full Legal Name</h2>
        <input value={name} onChange={(e) => { setName(e.target.value); setSig(null); }} autoComplete="name" placeholder="First and last name"
          className="mt-3 min-h-12 w-full rounded-lg border border-[#DEDEE3] px-3 text-[16px] text-[#111114] focus:border-[#D03020] focus:outline-none" />
      </section>

      <section className={card}>
        <h2 className={h2}>2. Adopt Your Signature</h2>
        {sig ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#CDEFD6] bg-[#F4FBF5] px-4 py-3">
            <MarkView mark={sig} height={48} />
            <button type="button" onClick={() => setSig(null)} className="min-h-11 px-3 text-[14px] font-semibold text-[#D03020]">Change</button>
          </div>
        ) : (
          <div className="mt-3"><MarkPicker kind="signature" text={name} onAdopt={setSig} /></div>
        )}
        {!sigMatches && <p className="mt-2 text-[13px] text-[#D03020]">Your typed signature must match your legal name. Adopt it again.</p>}
      </section>

      <section className={card}>
        <h2 className={h2}>3. Adopt Your Initials</h2>
        {ini ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#CDEFD6] bg-[#F4FBF5] px-4 py-3">
            <MarkView mark={ini} height={40} />
            <button type="button" onClick={() => { setIni(null); setAcks(rows.map(() => false)); }} className="min-h-11 px-3 text-[14px] font-semibold text-[#D03020]">Change</button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <input value={initialsText} maxLength={8} onChange={(e) => setInitialsText(e.target.value.replace(/[^A-Za-z.\- ]/g, ""))} aria-label="Initials"
              className="min-h-12 w-32 rounded-lg border border-[#DEDEE3] px-3 text-[16px] uppercase" />
            <MarkPicker kind="initials" text={initialsText} onAdopt={setIni} />
          </div>
        )}
      </section>

      {rows.length > 0 && (
        <section className={card}>
          <h2 className={h2}>4. Initial Each Acknowledgment</h2>
          <p className="mt-1 text-[13px] text-[#55555E]">Read each statement and tap Initial to confirm it. {ini ? (left ? `${left} remaining.` : "All initialed.") : "Adopt your initials first."}</p>
          <ol className="mt-3 space-y-2">
            {rows.map((t, i) => (
              <li key={i} className={`flex items-start gap-3 rounded-lg border p-3 ${acks[i] ? "border-[#CDEFD6] bg-[#F4FBF5]" : "border-[#EDEDF0]"}`}>
                <button type="button" disabled={!ini} aria-pressed={acks[i]} aria-label={`Initial acknowledgment ${i + 1}`}
                  onClick={() => setAcks((a) => a.map((v, j) => (j === i ? !v : v)))}
                  className={`flex min-h-12 w-24 shrink-0 items-center justify-center rounded-lg border text-[13px] font-semibold ${acks[i] ? "border-[#1E7A32] bg-white" : "border-[#D03020] text-[#D03020]"} disabled:opacity-40`}>
                  {acks[i] && ini ? <MarkView mark={ini} height={30} /> : "Initial"}
                </button>
                <span className="text-[13.5px] leading-5 text-[#28282E]">{i + 1}. {t}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className={card}>
        <h2 className={h2}>{rows.length ? "5" : "4"}. Sign</h2>
        <label className="mt-3 flex cursor-pointer items-start gap-3 text-[14px] text-[#28282E]">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#D03020]" />
          <span>
            I have read and agree to this rental agreement. I adopt the signature and initials shown above as my legal electronic signature and initials, equivalent to handwritten ones.
            {isStructured(body) ? " I initialed each Renter Acknowledgment individually." : null}
          </span>
        </label>
        {companySigner && <p className="mt-3 text-[12px] text-[#8A8A93]">Countersigned by {companySigner}. Your name, date, IP address, browser and signature method are recorded for the audit trail.</p>}
        {error && <p className="mt-3 text-[14px] text-[#D03020]">{error}</p>}
        <button type="button" disabled={!ready}
          onClick={() => sig && ini && onSubmit({ signerName: name.trim(), adoption: { signature: sig, initials: ini, acks } })}
          className="mt-4 min-h-12 w-full rounded-lg bg-[#D03020] px-6 text-[16px] font-semibold text-white disabled:opacity-40 sm:w-auto">
          {busy ? "Signing…" : "Sign Agreement"}
        </button>
        {!ready && !busy && (
          <p className="mt-2 text-[12px] text-[#77777F]">
            {!nameOk ? "Enter your full legal name." : !sig ? "Adopt your signature." : !ini ? "Adopt your initials." : !allAcks ? `Initial the remaining ${left} acknowledgment${left > 1 ? "s" : ""}.` : !agree ? "Check the consent box." : ""}
          </p>
        )}
      </section>
    </div>
  );
}

export default SigningPanel;
