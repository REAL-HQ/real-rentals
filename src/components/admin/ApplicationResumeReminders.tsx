import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getApplicationResumeReminders } from "@/lib/application-resume-reminders.functions";
import { APPLICATION_RESUME_REMINDERS_ENABLED } from "@/lib/application-resume-reminders-flag";
import type { ResumeReminderList } from "@/lib/application-resume-reminders";

/** Read-only. Nothing here sends a reminder. */
export function ApplicationResumeReminders() {
  if (APPLICATION_RESUME_REMINDERS_ENABLED !== true) return null;
  return <ApplicationResumeRemindersLive />;
}

function ApplicationResumeRemindersLive() {
  const load = useServerFn(getApplicationResumeReminders);
  const [list, setList] = useState<ResumeReminderList | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    load()
      .then((next) => {
        if (live) setList(next);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [load]);

  if (error) return <p className="mb-4 text-[13px] text-[#D03020]">Could Not Load Resume Reminders</p>;
  if (!list) return <p className="mb-4 text-[13px] text-[#55555E]">Loading Resume Reminders</p>;

  return (
    <section className="mb-4 space-y-3" data-testid="application-resume-reminders">
      <div>
        <h3 className="text-[15px] font-semibold text-[#111114]">Resume Reminders</h3>
        <p className="text-[13px] text-[#55555E]">Partial Applications Idle Over 24 Hours. Last Activity Uses Eastern Time.</p>
      </div>
      {list.truncated ? (
        <p className="text-[12px] text-[#55555E]">Some Resume Reminders Were Not Loaded.</p>
      ) : null}
      {list.rows.length === 0 ? (
        <p className="text-[13px] text-[#9A9AA3]">No Partial Applications Idle Over 24 Hours</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EDEDF0] bg-white">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="border-b border-[#EDEDF0] text-[12px] text-[#55555E]">
              <tr>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Last Activity</th>
                <th className="px-3 py-2 font-medium">Contact Status</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.applicationId} className="border-b border-[#EDEDF0] last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    <Link to="/admin" search={row.driverSearch} className="font-medium text-[#111114] underline">
                      {row.driverName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[#55555E]">{row.lastActivityLabel}</td>
                  <td className="px-3 py-2 text-[#111114]">{row.contactStatusLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
