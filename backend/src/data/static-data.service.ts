import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type UserRole = "EMPLOYEE" | "MANAGER";
export type TimesheetStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "RESUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "REOPENED"
  | "VOID";

export type StaticUser = {
  active: boolean;
  displayName: string;
  email: string;
  employeeId: string;
  id: string;
  oidcSubject: string;
  organizationId: string;
  role: UserRole;
};

type StaticAssignment = {
  employeeId: string;
  id: string;
  project: string;
  task: string;
};

export type StaticNotification = {
  category: string;
  createdAt: string;
  href: string;
  id: string;
  message: string;
  read: boolean;
  title: string;
  userId: string;
};

export type StaticAuditEvent = {
  action: "TIMESHEET_UPDATED" | "TIMESHEET_SUBMITTED" | "TIMESHEET_RESUBMITTED" | "NOTIFICATION_READ";
  actorUserId: string;
  createdAt: string;
  id: string;
  summary: string;
  targetId: string;
};

export type StaticTimesheetRevision = {
  createdAt: string;
  entries: StaticTimesheet["entries"];
  status: TimesheetStatus;
  version: number;
};

export type StaticTimesheet = {
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
  revisions: StaticTimesheetRevision[];
  reviewerName: string | null;
  status: TimesheetStatus;
  submittedAt: string | null;
  version: number;
};

export const staticIds = {
  organization: "00000000-0000-4000-8000-000000000001",
  employee: "00000000-0000-4000-8000-000000000101",
  employeeUser: "00000000-0000-4000-8000-000000000201",
  clientAssignment: "00000000-0000-4000-8000-000000000501",
  internalAssignment: "00000000-0000-4000-8000-000000000502",
  currentTimesheet: "00000000-0000-4000-8000-000000000601",
  approvedTimesheet: "00000000-0000-4000-8000-000000000602",
  rejectedTimesheet: "00000000-0000-4000-8000-000000000603",
} as const;

const emptyHours = (): Record<string, number> => ({
  mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0,
});

function entriesForWeek(
  clientHours: Partial<Record<string, number>>,
  internalHours: Partial<Record<string, number>>,
): StaticTimesheet["entries"] {
  return [
    {
      id: staticIds.clientAssignment,
      assignmentId: staticIds.clientAssignment,
      project: "Client portal",
      task: "Implementation",
      hours: { ...emptyHours(), ...clientHours } as Record<string, number>,
    },
    {
      id: staticIds.internalAssignment,
      assignmentId: staticIds.internalAssignment,
      project: "Internal operations",
      task: "Team support",
      hours: { ...emptyHours(), ...internalHours } as Record<string, number>,
    },
  ];
}

@Injectable()
export class StaticDataService {
  private readonly dataFile: string | null;

  readonly users: StaticUser[] = [
    {
      active: true,
      displayName: "Avery Rao",
      email: "avery.rao@example.test",
      employeeId: staticIds.employee,
      id: staticIds.employeeUser,
      oidcSubject: "dev-employee-avery",
      organizationId: staticIds.organization,
      role: "EMPLOYEE",
    },
  ];

  readonly profiles = [
    {
      employeeNumber: "EMP-001",
      expectedWeeklyHours: 40,
      id: staticIds.employee,
      organization: "Emerson pilot organization",
      timezone: "Asia/Kolkata",
      userId: staticIds.employeeUser,
    },
  ];

  readonly assignments: StaticAssignment[] = [
    { employeeId: staticIds.employee, id: staticIds.clientAssignment, project: "Client portal", task: "Implementation" },
    { employeeId: staticIds.employee, id: staticIds.internalAssignment, project: "Internal operations", task: "Team support" },
  ];

  readonly timesheets: StaticTimesheet[] = [
    {
      id: staticIds.currentTimesheet,
      employeeId: staticIds.employee,
      periodStart: "2026-08-24",
      periodEnd: "2026-08-30",
      status: "DRAFT",
      version: 1,
      expectedHours: 40,
      submittedAt: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      revisions: [],
      reviewerName: "Morgan Lee",
      entries: entriesForWeek({ mon: 8, tue: 8 }, { wed: 7, thu: 8, fri: 8 }),
    },
    {
      id: staticIds.approvedTimesheet,
      employeeId: staticIds.employee,
      periodStart: "2026-08-17",
      periodEnd: "2026-08-23",
      status: "APPROVED",
      version: 2,
      expectedHours: 40,
      submittedAt: "2026-08-24T03:42:00.000Z",
      approvedAt: "2026-08-25T09:10:00.000Z",
      rejectedAt: null,
      rejectionReason: null,
      revisions: [],
      reviewerName: "Morgan Lee",
      entries: entriesForWeek({ mon: 8, tue: 8, wed: 8 }, { thu: 8, fri: 8 }),
    },
    {
      id: staticIds.rejectedTimesheet,
      employeeId: staticIds.employee,
      periodStart: "2026-08-10",
      periodEnd: "2026-08-16",
      status: "REJECTED",
      version: 2,
      expectedHours: 40,
      submittedAt: "2026-08-17T03:34:00.000Z",
      approvedAt: null,
      rejectedAt: "2026-08-18T06:00:00.000Z",
      rejectionReason: "Please move Friday's internal support hours to the client assignment.",
      revisions: [],
      reviewerName: "Morgan Lee",
      entries: entriesForWeek({ mon: 8, tue: 8, wed: 8 }, { thu: 8, fri: 8 }),
    },
  ];

  readonly notifications: StaticNotification[] = [
    {
      id: "notification-hours",
      userId: staticIds.employeeUser,
      category: "reminder",
      title: "Timesheet needs review",
      message: "One hour remains unrecorded in the current period.",
      href: "/employee/timesheets/current",
      read: false,
      createdAt: "2026-08-30T04:00:00.000Z",
    },
    {
      id: "notification-approved",
      userId: staticIds.employeeUser,
      category: "approval",
      title: "Timesheet approved",
      message: "Morgan Lee approved Aug 17–23, 2026.",
      href: `/employee/timesheets/${staticIds.approvedTimesheet}`,
      read: true,
      createdAt: "2026-08-25T10:00:00.000Z",
    },
  ];

  readonly auditEvents: StaticAuditEvent[] = [];

  constructor(@Optional() config?: ConfigService) {
    const configuredPath = config?.get<string>("PULSE_DATA_FILE");
    this.dataFile = configuredPath
      ? resolve(configuredPath)
      : process.env.NODE_ENV === "test"
        ? null
        : resolve("data/pulse-ai.json");

    if (!this.dataFile) return;
    if (existsSync(this.dataFile)) {
      const stored = JSON.parse(readFileSync(this.dataFile, "utf8")) as {
        auditEvents?: StaticAuditEvent[];
        notifications?: StaticNotification[];
        timesheets?: StaticTimesheet[];
      };
      if (stored.timesheets)
        this.timesheets.splice(
          0,
          this.timesheets.length,
          ...stored.timesheets.map((timesheet) => ({
            ...timesheet,
            revisions: timesheet.revisions ?? [],
          })),
        );
      if (stored.notifications) this.notifications.splice(0, this.notifications.length, ...stored.notifications);
      if (stored.auditEvents) this.auditEvents.splice(0, this.auditEvents.length, ...stored.auditEvents);
    } else {
      this.persist();
    }
  }

  persist(): void {
    if (!this.dataFile) return;
    mkdirSync(dirname(this.dataFile), { recursive: true });
    const temporaryPath = `${this.dataFile}.tmp`;
    writeFileSync(
      temporaryPath,
      JSON.stringify(
        {
          auditEvents: this.auditEvents,
          notifications: this.notifications,
          timesheets: this.timesheets,
        },
        null,
        2,
      ),
      "utf8",
    );
    renameSync(temporaryPath, this.dataFile);
  }
}
