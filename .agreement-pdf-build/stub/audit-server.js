
export const logAudit = async (actor, entry) => { (globalThis.__fakeSb.audit ??= []).push(entry); };
