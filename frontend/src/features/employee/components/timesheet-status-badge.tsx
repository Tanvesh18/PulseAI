import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { TimesheetStatus } from "../types";

const statusPresentation: Record<
  TimesheetStatus,
  { label: string; tone: BadgeTone }
> = {
  draft: { label: "Draft", tone: "secondary" },
  submitted: { label: "Pending review", tone: "pending" },
  resubmitted: { label: "Resubmitted", tone: "pending" },
  approved: { label: "Approved", tone: "approved" },
  rejected: { label: "Rejected", tone: "rejected" },
  reopened: { label: "Reopened", tone: "warning" },
  void: { label: "Void", tone: "disabled" },
};

export function TimesheetStatusBadge({ status }: { status: TimesheetStatus }) {
  const presentation = statusPresentation[status];

  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}
