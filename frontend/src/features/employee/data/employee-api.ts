import type { TimesheetEntry, TimesheetPeriod } from "../types";

export class EmployeeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
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
  return request<TimesheetPeriod>("/timesheets/current");
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
  });
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
  });
}
