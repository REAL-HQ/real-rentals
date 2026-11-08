import * as React from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./select";
import { cn } from "@/lib/utils";

type Option = { value: string; label: React.ReactNode; disabled: boolean };
type Group = { label: string; options: Option[] };
type NativeOptionProps = { value?: string | number; disabled?: boolean; label?: string; children?: React.ReactNode };
const text = (node: React.ReactNode): string => React.Children.toArray(node).map((child) => React.isValidElement<{ children?: React.ReactNode }>(child) ? text(child.props.children) : String(child)).join("");

/** Preserve option values and labels exactly, including names supplied by data.
 * Formatting belongs at the explicit owned-label declarations, never here.
 */
function optionsFrom(children: React.ReactNode, inheritedDisabled = false): Array<Option | Group> {
  return React.Children.toArray(children).flatMap((child): Array<Option | Group> => {
    if (!React.isValidElement<NativeOptionProps>(child)) return [];
    if (child.type === React.Fragment) return optionsFrom(child.props.children, inheritedDisabled);
    if (child.type === "optgroup") {
      const options = optionsFrom(child.props.children, inheritedDisabled || !!child.props.disabled).flatMap((item) => "options" in item ? item.options : [item]);
      return [{ label: child.props.label ?? "", options }];
    }
    if (child.type !== "option") throw new Error("AppSelect children must be option, optgroup or fragments.");
    return [{ value: child.props.value == null ? text(child.props.children).replace(/[ \t\n\f\r]+/g, " ").trim() : String(child.props.value), label: child.props.label ?? child.props.children, disabled: inheritedDisabled || !!child.props.disabled }];
  });
}

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size" | "onFocus" | "onBlur" | "value" | "defaultValue"> & { value?: string | number; defaultValue?: string | number; onFocus?: React.FocusEventHandler<HTMLButtonElement>; onBlur?: React.FocusEventHandler<HTMLButtonElement> };
/** Accessible in-app popup replacing OS-native menus. Keeps the existing
 * native ChangeEvent contract through an actual hidden select, not a cast or
 * fabricated event. Existing handlers, values and option text remain intact.
 */
export function AppSelect({ children, value, defaultValue, onChange, disabled, required, name, form, className, onInvalid, ...triggerProps }: Props) {
  const native = React.useRef<HTMLSelectElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const errorId = React.useId();
  const [invalid, setInvalid] = React.useState(false);
  const items = optionsFrom(children);
  const flat = items.flatMap((item) => "options" in item ? item.options : [item]);
  const [local, setLocal] = React.useState(() => String(defaultValue ?? flat.find((item) => !item.disabled)?.value ?? ""));
  const selected = String(value ?? (flat.some((item) => item.value === local) ? local : flat.find((item) => !item.disabled)?.value ?? ""));
  const controlledValue = React.useRef(value);
  controlledValue.current = value;
  React.useLayoutEffect(() => {
    if (!native.current) return;
    // Native reset must restore raw values synchronously, before a caller can
    // collect FormData. React's controlled select does not set defaultSelected.
    const initial = value !== undefined ? selected : String(defaultValue ?? flat.find((item) => !item.disabled)?.value ?? "");
    for (const option of native.current.options) option.defaultSelected = option.value === initial;
    native.current.value = selected;
  }, [selected, value, defaultValue, children]);
  React.useEffect(() => {
    const owner = native.current?.form;
    if (!owner) return;
    const reset = (event: Event) => {
      // The browser applies reset's default action after the event dispatch.
      // Restore after that action, not in a microtask that can run before it.
      setTimeout(() => {
        if (event.defaultPrevented || !native.current) return;
        const initial = String(defaultValue ?? flat.find((item) => !item.disabled)?.value ?? "");
        if (controlledValue.current === undefined) setLocal(initial);
        setInvalid(false);
        native.current.value = String(controlledValue.current ?? initial);
      }, 0);
    };
    owner.addEventListener("reset", reset);
    return () => owner.removeEventListener("reset", reset);
  }, [value, defaultValue, children]);
  // Prefix every value so an empty stored value is still a legal Radix item.
  const encoded = (stored: string) => `option:${stored}`;
  const change = (next: string) => {
    const stored = next.slice("option:".length);
    if (disabled || !native.current) return;
    if (value === undefined) setLocal(stored);
    native.current.value = stored;
    native.current.dispatchEvent(new Event("change", { bubbles: true }));
    // A controlled parent can reject a choice. Keep its raw form value in sync,
    // even when no parent state change causes a render after the native event.
    queueMicrotask(() => {
      if (native.current && controlledValue.current !== undefined) native.current.value = String(controlledValue.current);
    });
  };
  const option = (item: Option, key: string) => <SelectItem key={key} value={encoded(item.value)} disabled={item.disabled} textValue={text(item.label)}>{item.label}</SelectItem>;
  return (
    <>
      <Select value={encoded(selected)} onValueChange={change} disabled={disabled}>
        <SelectTrigger ref={trigger} {...triggerProps as React.ComponentPropsWithoutRef<typeof SelectTrigger>} aria-required={required || undefined} aria-invalid={invalid || triggerProps["aria-invalid"]} aria-describedby={[triggerProps["aria-describedby"], invalid ? errorId : null].filter(Boolean).join(" ") || undefined} className={cn("white-popup inline-flex w-auto bg-white text-[#111114]", className)}>
          <SelectValue placeholder="Select An Option" />
        </SelectTrigger>
        <SelectContent position="popper" data-app-select-popup>
          {items.map((item, i) => "options" in item ? <SelectGroup key={i}><SelectLabel>{item.label}</SelectLabel>{item.options.map((child, j) => option(child, `${i}-${j}`))}</SelectGroup> : option(item, String(i)))}
        </SelectContent>
      </Select>
      <select ref={native} value={selected} name={name} form={form} required={required} onChange={(event) => { setInvalid(false); onChange?.(event); }} disabled={disabled} aria-hidden="true" tabIndex={-1} style={{ display: "none" }} data-app-select-event-bridge
        onInvalid={(event) => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); onInvalid?.(event); }}>
        {flat.map((item, i) => <option key={i} value={item.value} disabled={item.disabled}>{text(item.label)}</option>)}
      </select>
      {invalid ? <span id={errorId} role="alert" className="block text-xs text-red-700">Select An Option.</span> : null}
    </>
  );
}
