export type UserRole = "EMPLOYEE" | "MANAGER";
export type TimesheetStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "RESUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "REOPENED"
  | "VOID";

export type EmployeeUser = {
  active: boolean;
  displayName: string;
  email: string;
  employeeId: string;
  id: string;
  oidcSubject: string;
  organizationId: string;
  role: UserRole;
};

export type EmployeeAssignment = {
  employeeId: string;
  id: string;
  project: string;
  task: string;
};

export type EmployeeNotification = {
  category: string;
  createdAt: string;
  href: string;
  id: string;
  message: string;
  read: boolean;
  title: string;
  userId: string;
};

export type EmployeeAuditEvent = {
  action: "TIMESHEET_UPDATED" | "TIMESHEET_SUBMITTED" | "TIMESHEET_RESUBMITTED" | "NOTIFICATION_READ";
  actorUserId: string;
  createdAt: string;
  id: string;
  summary: string;
  targetId: string;
};

export type TimesheetRevision = {
  createdAt: string;
  entries: EmployeeTimesheet["entries"];
  status: TimesheetStatus;
  version: number;
};

export type EmployeeTimesheet = {
  approvedAt: string | null;
  employeeId: string;
  entries: Array<{
    assignmentId: string;
    hours: Record<string, number>;
    id: string;
    project: string;
    task: string;
  }>;
  expectedHours: number;
  id: string;
  periodEnd: string;
  periodStart: string;
  rejectedAt: string | null;
  rejectionReason: string | null;
  revisions: TimesheetRevision[];
  reviewerName: string | null;
  status: TimesheetStatus;
  submittedAt: string | null;
  version: number;
};

export type EmployeeProfile = {
  employeeNumber: string;
  expectedWeeklyHours: number;
  id: string;
  organization: string;
  timezone: string;
  userId: string;
};

export type EmployeeData = {
  users: EmployeeUser[];
  profiles: EmployeeProfile[];
  assignments: EmployeeAssignment[];
  timesheets: EmployeeTimesheet[];
  notifications: EmployeeNotification[];
  auditEvents: EmployeeAuditEvent[];
};
