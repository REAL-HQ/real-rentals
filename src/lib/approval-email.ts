export type ApprovalEmailStatus = "sent" | "off" | "held" | "failed" | "no_email" | "not_sent";

/** Staff-facing delivery outcome; approval itself has already succeeded. */
export function approvalEmailMessage(status: ApprovalEmailStatus | undefined): string {
  switch (status) {
    case "sent": return "Approval Confirmation Sent.";
    case "off": return "Approval Confirmation Is Off.";
    case "held": return "Approval Confirmation Held.";
    case "failed": return "Approval Confirmation Could Not Be Sent.";
    case "no_email": return "No Approval Email: No Email On File.";
    default: return "";
  }
}
