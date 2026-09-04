export type TimesheetStatus =
  | "draft"
  | "submitted"
  | "resubmitted"
  | "approved"
  | "rejected"
  | "reopened"
  | "void";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type TimesheetDay = {
  date: string;
  day: DayKey;
  displayDate?: string;
  label: string;
  shortLabel: string;
};

export type TimesheetEntry = {
  assignmentId?: string;
  hours: Record<DayKey, number>;
  id: string;
  project: string;
  task: string;
};

export type ValidationIssue = {
  cellId?: string;
  id: string;
  message: string;
  title: string;
  type: "missing" | "duplicate" | "unusual";
};

export type TimesheetPeriod = {
  approvedAt?: string | null;
  approvedBy?: string;
  days: TimesheetDay[];
  entries: TimesheetEntry[];
  expectedHours: number;
  id: string;
  issues: ValidationIssue[];
  label: string;
  nextPeriodId?: string | null;
  periodEnd?: string;
  periodStart?: string;
  previousPeriodId?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  revisions?: Array<{
    createdAt: string;
    status: TimesheetStatus;
    version: number;
  }>;
  reviewerName?: string | null;
  status: TimesheetStatus;
  submittedAt?: string | null;
  version?: number;
};

export type EmployeeProfile = {
  email?: string;
  employeeNumber?: string;
  expectedWeeklyHours?: number;
  id?: string;
  initials: string;
  name: string;
  organization: string;
  role: "Employee";
  timezone?: string;
};

export type EmployeeNotification = {
  category: string;
  createdAt: string;
  href: string;
  id: string;
  message: string;
  read: boolean;
  title: string;
};

export type AssistantAnswer = {
  answer: string;
  generatedAt: string;
  readOnly: true;
  scope: string;
  sources: Array<{ href: string; label: string }>;
};

export type EmployeeAuditEvent = {
  action: string;
  createdAt: string;
  id: string;
  summary: string;
  targetId: string;
};
