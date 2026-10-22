import { useQuery } from "@tanstack/react-query";

/**
 * Read-only. The portal mounts this only while PORTAL_NOTICES_ENABLED is true,
 * so the query does not run when the flag is off. `read` is the portal's
 * preview-aware reader. This list does not write.
 */
export function PortalNotices({
  onNavigate,
  read,
}: {
  onNavigate: (section: "dashboard" | "documents" | "payments") => void;
  read: () => Promise<{ id: string; text: string; section: "dashboard" | "documents" | "payments" }[]>;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-notices"],
    queryFn: () => read(),
  });
  if (isLoading || error || !data || data.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      <h2 className="text-sm font-semibold">Notices</h2>
      <ul className="mt-3 divide-y divide-border">
        {data.map((notice) => (
          <li key={notice.id}>
            <button
              type="button"
              onClick={() => onNavigate(notice.section)}
              className="w-full py-3 text-left text-sm text-[#111114] hover:text-real-red"
            >
              {notice.text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
