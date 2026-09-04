import type {
  DayKey,
  EmployeeNotification,
  EmployeeProfile,
  TimesheetDay,
  TimesheetEntry,
  TimesheetPeriod,
} from "../types";

const days: TimesheetDay[] = [
  { day: "mon", label: "Monday", shortLabel: "Mon", date: "Aug 24" },
  { day: "tue", label: "Tuesday", shortLabel: "Tue", date: "Aug 25" },
  { day: "wed", label: "Wednesday", shortLabel: "Wed", date: "Aug 26" },
  { day: "thu", label: "Thursday", shortLabel: "Thu", date: "Aug 27" },
  { day: "fri", label: "Friday", shortLabel: "Fri", date: "Aug 28" },
  { day: "sat", label: "Saturday", shortLabel: "Sat", date: "Aug 29" },
  { day: "sun", label: "Sunday", shortLabel: "Sun", date: "Aug 30" },
];

const emptyHours = (): Record<DayKey, number> => ({
  mon: 0,
  tue: 0,
  wed: 0,
  thu: 0,
  fri: 0,
  sat: 0,
  sun: 0,
});

function historicalEntries(
  prefix: string,
  firstRow: Partial<Record<DayKey, number>>,
  secondRow: Partial<Record<DayKey, number>>,
): TimesheetEntry[] {
  return [
    {
      id: `${prefix}-delivery`,
      project: "Client portal",
      task: "Implementation",
      hours: { ...emptyHours(), ...firstRow },
    },
    {
      id: `${prefix}-operations`,
      project: "Internal operations",
      task: "Team support",
      hours: { ...emptyHours(), ...secondRow },
    },
  ];
}

export const employeeProfile: EmployeeProfile = {
  initials: "AR",
  name: "Avery Rao",
  organization: "Demo organization",
  role: "Employee",
};

export const currentTimesheet: TimesheetPeriod = {
  id: "2026-08-24",
  label: "Aug 24–30, 2026",
  status: "draft",
  expectedHours: 40,
  days,
  previousPeriodId: "2026-08-17",
  entries: [
    {
      id: "client-implementation",
      project: "Client portal",
      task: "Implementation",
      hours: { mon: 8, tue: 8, wed: 2, thu: 0, fri: 0, sat: 0, sun: 0 },
    },
    {
      id: "internal-support",
      project: "Internal operations",
      task: "Team support",
      hours: { mon: 0, tue: 0, wed: 5, thu: 8, fri: 7, sat: 0, sun: 0 },
    },
    {
      id: "client-duplicate",
      project: "Client portal",
      task: "Implementation",
      hours: { mon: 0, tue: 0, wed: 1, thu: 0, fri: 0, sat: 0, sun: 0 },
    },
  ],
  issues: [
    {
      id: "missing-hours",
      type: "missing",
      title: "1 hour remains unrecorded",
      message:
        "The current total is 39 hours against the 40 hours expected for this demo period. Review the week before submitting.",
    },
    {
      id: "duplicate-entry",
      type: "duplicate",
      title: "Potential duplicate entry on Wednesday",
      message:
        "Client portal · Implementation appears twice on Aug 26. Compare both entries and keep both only if they represent separate work.",
      cellId: "hours-client-duplicate-wed",
    },
  ],
};

export const timesheetHistory: TimesheetPeriod[] = [
  {
    id: "2026-08-17",
    label: "Aug 17–23, 2026",
    status: "approved",
    expectedHours: 40,
    days: days.map((day, index) => ({
      ...day,
      date:
        ["Aug 17", "Aug 18", "Aug 19", "Aug 20", "Aug 21", "Aug 22", "Aug 23"][
          index
        ] ?? day.date,
    })),
    previousPeriodId: "2026-08-10",
    nextPeriodId: currentTimesheet.id,
    submittedAt: "Aug 24, 2026 · 9:12 AM",
    approvedAt: "Aug 25, 2026 · 2:40 PM",
    approvedBy: "Morgan Lee",
    entries: historicalEntries(
      "aug17",
      { mon: 8, tue: 8, wed: 8, thu: 4 },
      { thu: 4, fri: 8 },
    ),
    issues: [],
  },
  {
    id: "2026-08-10",
    label: "Aug 10–16, 2026",
    status: "approved",
    expectedHours: 40,
    days: days.map((day, index) => ({
      ...day,
      date:
        ["Aug 10", "Aug 11", "Aug 12", "Aug 13", "Aug 14", "Aug 15", "Aug 16"][
          index
        ] ?? day.date,
    })),
    previousPeriodId: "2026-08-03",
    nextPeriodId: "2026-08-17",
    submittedAt: "Aug 17, 2026 · 8:48 AM",
    approvedAt: "Aug 18, 2026 · 11:06 AM",
    approvedBy: "Morgan Lee",
    entries: historicalEntries(
      "aug10",
      { mon: 8, tue: 8, wed: 8, thu: 5.5 },
      { thu: 2.5, fri: 8, sat: 1.5 },
    ),
    issues: [],
  },
  {
    id: "2026-08-03",
    label: "Aug 3–9, 2026",
    status: "rejected",
    expectedHours: 40,
    days: days.map((day, index) => ({
      ...day,
      date:
        ["Aug 3", "Aug 4", "Aug 5", "Aug 6", "Aug 7", "Aug 8", "Aug 9"][
          index
        ] ?? day.date,
    })),
    nextPeriodId: "2026-08-10",
    submittedAt: "Aug 10, 2026 · 9:04 AM",
    approvedBy: "Morgan Lee",
    entries: historicalEntries(
      "aug03",
      { mon: 8, tue: 8, wed: 8, thu: 4 },
      { thu: 4, fri: 6 },
    ),
    issues: [],
  },
];

export const employeeNotifications: EmployeeNotification[] = [
  {
    category: "reminder",
    createdAt: "2026-08-30T04:00:00.000Z",
    href: "/employee/timesheets/current",
    id: "notification-hours",
    title: "Timesheet needs review",
    message: "One hour remains unrecorded in the current period.",
    read: false,
  },
  {
    category: "approval",
    createdAt: "2026-08-25T10:00:00.000Z",
    href: "/employee/timesheets/2026-08-17",
    id: "notification-approved",
    title: "Timesheet approved",
    message: "Morgan Lee approved Aug 17–23, 2026.",
    read: false,
  },
  {
    category: "timesheet",
    createdAt: "2026-08-24T03:42:00.000Z",
    href: "/employee/timesheets/2026-08-17",
    id: "notification-submitted",
    title: "Submission recorded",
    message: "Your Aug 17–23 timesheet was sent for review.",
    read: true,
  },
];

export const assistantPreview = {
  suggestions: [
    "Summarize my current timesheet",
    "Which entries need attention?",
    "Show my latest approval",
  ],
  responses: {
    "Summarize my current timesheet":
      "Your current demo timesheet has 39 of 40 expected hours. It is still a draft and has not been submitted.",
    "Which entries need attention?":
      "One hour remains unrecorded. Client portal · Implementation also appears twice on Wednesday; review both entries before submitting.",
    "Show my latest approval":
      "Your Aug 17–23, 2026 timesheet was approved by Morgan Lee on Aug 25 at 2:40 PM.",
  },
} as const;

export function getTimesheetById(id: string): TimesheetPeriod | undefined {
  if (id === currentTimesheet.id) {
    return currentTimesheet;
  }

  return timesheetHistory.find((timesheet) => timesheet.id === id);
}

export function getEntryTotal(entry: TimesheetEntry): number {
  return Object.values(entry.hours).reduce((sum, hours) => sum + hours, 0);
}

export function getTimesheetTotal(timesheet: TimesheetPeriod): number {
  return timesheet.entries.reduce(
    (sum, entry) => sum + getEntryTotal(entry),
    0,
  );
}

export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? `${hours}` : hours.toFixed(1);
}
