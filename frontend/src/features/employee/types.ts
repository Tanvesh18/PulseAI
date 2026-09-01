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
  type: "missing" | "duplicate";
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
  reviewerName?: string | null;
  status: TimesheetStatus;
  submittedAt?: string | null;
  version?: number;
};

export type EmployeeProfile = {
  initials: string;
  name: string;
  organization: string;
  role: "Employee";
};

export type EmployeeNotification = {
  id: string;
  message: string;
  read: boolean;
  title: string;
  when: string;
};
