import * as React from "react";
import {
  caretAfterFormat,
  formatPhoneForDisplay,
  formatPhoneInput,
  formatUsPhoneInput,
  usPhoneDigits,
} from "@/lib/us-phone";

/**
 * The one phone field used across the site and the back office.
 *
 * Shows the number as (813) 555-0123 while the user types, pastes, or
 * autofills (+1, a leading 1, dashes, dots, and spaces are all handled).
 * The value handed to onValueChange is the formatted text; each form keeps
 * normalizing on submit exactly as before (applications and driver contacts
 * store E.164 via applicantPhoneForSubmit / normalizeDriverPhone, and the
 * other readers strip to digits), so nothing downstream changes.
 *
 * mode "us" (the public apply / lead forms) always formats as a US number.
 * mode "any" (the default) leaves international numbers and numbers with an
 * extension as typed.
 */
export type PhoneInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "type"
> & {
  value: string | null | undefined;
  onValueChange: (formatted: string) => void;
  mode?: "us" | "any";
};

export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  {
    value,
    onValueChange,
    mode = "any",
    onBlur,
    inputMode = "tel",
    autoComplete = "tel",
    autoCorrect = "off",
    spellCheck = false,
    ...rest
  },
  forwardedRef,
) {
  const format = mode === "us" ? formatUsPhoneInput : formatPhoneInput;
  const display =
    mode === "us" ? formatUsPhoneInput(String(value ?? "")) : formatPhoneForDisplay(value);
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const pendingCaret = React.useRef<number | null>(null);

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  React.useLayoutEffect(() => {
    const el = innerRef.current;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    if (el && caret != null && document.activeElement === el) {
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* some input types refuse selection; tel does not */
      }
    }
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    let typed = e.target.value;
    let caret = e.target.selectionStart ?? typed.length;
    const inputType = (e.nativeEvent as InputEvent | undefined)?.inputType;
    // Backspace over "(", ")", " " or "-" would otherwise be undone by the
    // formatter; remove the digit before it instead, like a real phone field.
    if (
      inputType === "deleteContentBackward" &&
      usPhoneDigits(typed) === usPhoneDigits(display) &&
      typed.length < display.length
    ) {
      let i = caret - 1;
      while (i >= 0 && !/\d/.test(typed[i])) i--;
      if (i >= 0) {
        typed = typed.slice(0, i) + typed.slice(i + 1);
        caret = i;
      }
    }
    const next = format(typed);
    pendingCaret.current = next === typed ? caret : caretAfterFormat(typed, caret, next);
    onValueChange(next);
  }

  return (
    <input
      {...rest}
      ref={setRefs}
      type="tel"
      inputMode={inputMode}
      autoComplete={autoComplete}
      autoCorrect={autoCorrect}
      spellCheck={spellCheck}
      value={display}
      onChange={handleChange}
      onBlur={(e) => {
        const next = format(e.target.value);
        if (next !== e.target.value) onValueChange(next);
        onBlur?.(e);
      }}
    />
  );
});
