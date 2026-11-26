/** An approved or active applicant who does not already have a reserved car. */
export type ApprovedDriverOption = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

export function approvedDriverLabel(person: ApprovedDriverOption): string {
  return person.full_name?.trim() || person.email?.trim() || person.phone?.trim() || "Approved Driver";
}

/** Case-insensitive match on name, email, and phone. An empty query keeps every option. */
export function approvedDriverMatches(person: ApprovedDriverOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [person.full_name, person.email, person.phone].some((value) =>
    (value ?? "").toLowerCase().includes(needle),
  );
}
