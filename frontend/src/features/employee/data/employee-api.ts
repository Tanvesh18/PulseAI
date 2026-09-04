import type {
  AssistantAnswer,
  EmployeeAuditEvent,
  EmployeeNotification,
  EmployeeProfile,
  TimesheetEntry,
  TimesheetPeriod,
} from "../types";

export class EmployeeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function isEmployeeAccessError(
  reason: unknown,
): reason is EmployeeApiError {
  return (
    reason instanceof EmployeeApiError && [401, 403].includes(reason.status)
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend/employee${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  if (!response.ok) {
    throw new EmployeeApiError(
      payload?.message ?? "Pulse AI could not complete the request.",
      response.status,
    );
  }
  return payload as T;
}

export function getCurrentTimesheet(): Promise<TimesheetPeriod> {
  return request<TimesheetPeriod>("/timesheets/current").then(
    normalizeTimesheet,
  );
}

export function getEmployeeProfile(): Promise<EmployeeProfile> {
  return request<EmployeeProfile>("/me");
}

export function listTimesheets(): Promise<TimesheetPeriod[]> {
  return request<TimesheetPeriod[]>("/timesheets").then((items) =>
    items.map(normalizeTimesheet),
  );
}

export function getTimesheet(timesheetId: string): Promise<TimesheetPeriod> {
  return request<TimesheetPeriod>(`/timesheets/${timesheetId}`).then(
    normalizeTimesheet,
  );
}

function normalizeTimesheet(timesheet: TimesheetPeriod): TimesheetPeriod {
  const approvedBy = timesheet.approvedBy ?? timesheet.reviewerName;
  return {
    ...timesheet,
    ...(approvedBy ? { approvedBy } : {}),
  };
}

export function listNotifications(): Promise<EmployeeNotification[]> {
  return request<EmployeeNotification[]>("/notifications");
}

export function markNotificationRead(
  notificationId: string,
): Promise<EmployeeNotification> {
  return request<EmployeeNotification>(
    `/notifications/${notificationId}/read`,
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
  );
}

export function listAuditEvents(): Promise<EmployeeAuditEvent[]> {
  return request<EmployeeAuditEvent[]>("/audit-events");
}

export function askAssistant(question: string): Promise<AssistantAnswer> {
  return request<AssistantAnswer>("/assistant/query", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

function updatePayload(
  timesheet: TimesheetPeriod,
  entries: TimesheetEntry[],
  expectedVersion: number,
) {
  return {
    expectedVersion,
    entries: entries.map((entry) => ({
      assignmentId: entry.assignmentId ?? entry.id,
      days: timesheet.days.map((day) => ({
        date: day.date,
        hours: entry.hours[day.day],
      })),
    })),
  };
}

export function saveTimesheet(
  timesheet: TimesheetPeriod,
  entries: TimesheetEntry[],
  expectedVersion: number,
): Promise<TimesheetPeriod> {
  return request<TimesheetPeriod>(`/timesheets/${timesheet.id}`, {
    method: "PATCH",
    body: JSON.stringify(updatePayload(timesheet, entries, expectedVersion)),
  }).then(normalizeTimesheet);
}

export async function submitTimesheet(
  timesheet: TimesheetPeriod,
  entries: TimesheetEntry[],
  expectedVersion: number,
): Promise<TimesheetPeriod> {
  const saved = await saveTimesheet(timesheet, entries, expectedVersion);
  return request<TimesheetPeriod>(`/timesheets/${timesheet.id}/submit`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion: saved.version }),
  }).then(normalizeTimesheet);
}
