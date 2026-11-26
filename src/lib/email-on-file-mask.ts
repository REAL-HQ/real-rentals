/**
 * Mask the email already on an application, for a hint the applicant can see.
 *
 * The full address stays on the server. Callers put only this string in the
 * response. "mystery@gmail.com" becomes "m•••••y@gmail.com": the first and last
 * character of the local part, bullets between them, and the full domain.
 * A local part of one or two characters shows only the first character plus
 * bullets, because showing the last character would reveal the whole local part.
 */

export function maskEmailOnFile(email: string | null | undefined): string | null {
  const parts = splitAddress(email);
  if (!parts) return null;
  const { local, domain } = parts;
  if (local.length <= 2) return `${local[0]}••@${domain}`;
  return `${local[0]}${"•".repeat(local.length - 2)}${local[local.length - 1]}@${domain}`;
}

/**
 * True only for a value maskEmailOnFile could have produced. A full address
 * fails, so the page can refuse to render one if it ever arrives.
 */
export function isMaskedEmailHint(value: string | null | undefined): boolean {
  const raw = String(value ?? "").trim();
  const at = raw.indexOf("@");
  if (at < 2 || at !== raw.lastIndexOf("@") || at === raw.length - 1) return false;
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (!/^[^\s@•]•+[^\s@•]?$/.test(local)) return false;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || /[\s@•]/.test(domain)) return false;
  return true;
}

function splitAddress(email: string | null | undefined): { local: string; domain: string } | null {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1 || at !== e.lastIndexOf("@") || at === e.length - 1) return null;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (!local || /[\s@]/.test(local)) return null;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || /[\s@]/.test(domain)) return null;
  return { local, domain };
}
