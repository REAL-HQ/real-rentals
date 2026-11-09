// Browser-safe wording for SMS outcomes (no provider code here).

/** Staff-facing words for a text that did not go out. */
export function smsSkipMessage(reason: string): string {
  switch (reason) {
    case "duplicate": return "This text was already sent a moment ago.";
    case "dry_run": return "Test Mode: text logged, not sent.";
    case "opted_out": return "This person opted out of texts.";
    case "no_consent": return "No text-message consent on file.";
    case "invalid_phone": return "The mobile number on file can't receive texts.";
    case "not_configured": return "Texting is not set up yet (no SMS provider connected).";
    default: return "Text was not sent.";
  }
}
