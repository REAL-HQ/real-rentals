import { createFileRoute, redirect } from "@tanstack/react-router";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Short staff link used in team-alert texts: /d/<application id> opens the
 * applicant's profile in Back Office. It only redirects; /admin still
 * requires a staff sign-in, and nothing is read here.
 */
export const Route = createFileRoute("/d/$id")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  beforeLoad: ({ params }) => {
    const id = String(params.id ?? "");
    throw redirect({ href: UUID.test(id) ? `/admin?tab=drivers&id=${encodeURIComponent(id)}` : "/admin" });
  },
});
