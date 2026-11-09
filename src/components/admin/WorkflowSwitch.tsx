/**
 * On/Off switch for one workflow. Solid brand red when On, solid grey when
 * Off, with a visible "On"/"Off" label so the state never depends on color.
 */
export function WorkflowSwitch({
  name,
  on,
  busy,
  onChange,
}: {
  name: string;
  on: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${name}: ${on ? "On" : "Off"}`}
      title={on ? "Turn Off" : "Turn On"}
      disabled={busy}
      onClick={() => onChange(!on)}
      data-workflow-switch
      className="inline-flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D03020] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
    >
      <span className={on ? "text-[#D03020]" : "text-[#55555E]"}>{on ? "On" : "Off"}</span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 ${
          on ? "bg-[#D03020]" : "bg-[#C4C4CB]"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 ${
            on ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}
