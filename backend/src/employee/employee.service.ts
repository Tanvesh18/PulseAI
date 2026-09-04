import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { RequestActor } from "../auth/request-actor";
import {
  StaticDataService,
  type StaticTimesheet,
} from "../data/static-data.service";
import type { UpdateTimesheetDto } from "./dto/update-timesheet.dto";

@Injectable()
export class EmployeeService {
  constructor(private readonly data: StaticDataService) {}

  getProfile(actor: RequestActor) {
    const user = this.data.users.find((item) => item.id === actor.userId);
    const profile = this.data.profiles.find(
      (item) => item.id === actor.employeeId,
    );
    if (!user || !profile) {
      throw new NotFoundException("Employee profile not found.");
    }

    return {
      id: profile.id,
      employeeNumber: profile.employeeNumber,
      initials: this.initials(user.displayName),
      name: user.displayName,
      email: user.email,
      organization: profile.organization,
      role: "Employee" as const,
      timezone: profile.timezone,
      expectedWeeklyHours: profile.expectedWeeklyHours,
    };
  }

  getCurrentTimesheet(actor: RequestActor) {
    const timesheet = this.employeeTimesheets(actor).find((item) =>
      ["DRAFT", "REJECTED", "SUBMITTED", "RESUBMITTED"].includes(item.status),
    );
    if (!timesheet) {
      throw new NotFoundException("No current timesheet is available.");
    }
    return this.toTimesheetResponse(timesheet, actor);
  }

  listTimesheets(actor: RequestActor) {
    return this.employeeTimesheets(actor).map((item) =>
      this.toTimesheetResponse(item, actor),
    );
  }

  getTimesheet(actor: RequestActor, timesheetId: string) {
    return this.toTimesheetResponse(
      this.ownedTimesheet(actor, timesheetId),
      actor,
    );
  }

  updateTimesheet(
    actor: RequestActor,
    timesheetId: string,
    dto: UpdateTimesheetDto,
  ) {
    const timesheet = this.ownedTimesheet(actor, timesheetId);
    this.assertEditable(timesheet.status);
    if (timesheet.version !== dto.expectedVersion) {
      throw new ConflictException(
        "This timesheet changed in another session. Refresh before saving again.",
      );
    }

    const assignmentIds = dto.entries.map((entry) => entry.assignmentId);
    if (new Set(assignmentIds).size !== assignmentIds.length) {
      throw new BadRequestException("Each assignment may appear only once.");
    }
    const assignments = this.data.assignments.filter(
      (item) => item.employeeId === this.employeeId(actor),
    );
    const allowed = new Map(assignments.map((item) => [item.id, item]));
    if (assignmentIds.some((id) => !allowed.has(id))) {
      throw new ForbiddenException("One or more assignments are unavailable.");
    }

    const dailyTotals = new Map<string, number>();
    for (const entry of dto.entries) {
      for (const day of entry.days) {
        const date = day.date.slice(0, 10);
        if (date < timesheet.periodStart || date > timesheet.periodEnd) {
          throw new BadRequestException(
            `${date} is outside this timesheet period.`,
          );
        }
        dailyTotals.set(date, (dailyTotals.get(date) ?? 0) + day.hours);
      }
    }
    for (const [date, total] of dailyTotals) {
      if (total > 24) {
        throw new BadRequestException(
          `Recorded hours for ${date} cannot exceed 24.`,
        );
      }
    }

    this.recordRevision(timesheet);
    timesheet.entries = dto.entries.map((entry) => {
      const assignment = allowed.get(entry.assignmentId)!;
      return {
        id: assignment.id,
        assignmentId: assignment.id,
        project: assignment.project,
        task: assignment.task,
        hours: Object.fromEntries(
          entry.days.map((day) => [this.dayKey(new Date(day.date)), day.hours]),
        ),
      };
    });
    timesheet.version += 1;
    this.refreshTimesheetReminder(actor, timesheet);
    this.data.auditEvents.unshift({
      action: "TIMESHEET_UPDATED",
      actorUserId: actor.userId,
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      summary: `Updated ${this.periodLabel(timesheet.periodStart, timesheet.periodEnd)} timesheet entries.`,
      targetId: timesheet.id,
    });
    this.data.persist();
    return this.toTimesheetResponse(timesheet, actor);
  }

  submitTimesheet(
    actor: RequestActor,
    timesheetId: string,
    expectedVersion: number,
  ) {
    const timesheet = this.ownedTimesheet(actor, timesheetId);
    this.assertEditable(timesheet.status);
    if (timesheet.version !== expectedVersion) {
      throw new ConflictException(
        "This timesheet changed in another session. Refresh before submitting.",
      );
    }
    const total = timesheet.entries.reduce(
      (sum, entry) =>
        sum +
        Object.values(entry.hours).reduce(
          (entrySum, hours) => entrySum + hours,
          0,
        ),
      0,
    );
    if (total <= 0) {
      throw new BadRequestException(
        "Record at least one hour before submitting this timesheet.",
      );
    }
    this.recordRevision(timesheet);
    const wasRejected = timesheet.status === "REJECTED";
    timesheet.status = wasRejected ? "RESUBMITTED" : "SUBMITTED";
    timesheet.submittedAt = new Date().toISOString();
    timesheet.version += 1;
    this.data.notifications.unshift({
      id: `notification-submitted-${timesheet.version}`,
      userId: actor.userId,
      category: "timesheet",
      title: "Submission recorded",
      message: `Your ${this.periodLabel(timesheet.periodStart, timesheet.periodEnd)} timesheet was sent for review.`,
      href: `/employee/timesheets/${timesheet.id}`,
      read: false,
      createdAt: new Date().toISOString(),
    });
    this.data.auditEvents.unshift({
      action: wasRejected ? "TIMESHEET_RESUBMITTED" : "TIMESHEET_SUBMITTED",
      actorUserId: actor.userId,
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      summary: `${wasRejected ? "Resubmitted" : "Submitted"} ${this.periodLabel(timesheet.periodStart, timesheet.periodEnd)} for review.`,
      targetId: timesheet.id,
    });
    this.data.persist();
    return this.toTimesheetResponse(timesheet, actor);
  }

  listNotifications(actor: RequestActor) {
    const current = this.employeeTimesheets(actor).find((item) =>
      ["DRAFT", "REJECTED"].includes(item.status),
    );
    if (current) this.refreshTimesheetReminder(actor, current);
    return structuredClone(
      this.data.notifications.filter((item) => item.userId === actor.userId),
    );
  }

  markNotificationRead(actor: RequestActor, notificationId: string) {
    const notification = this.data.notifications.find(
      (item) => item.id === notificationId && item.userId === actor.userId,
    );
    if (!notification) throw new NotFoundException("Notification not found.");
    notification.read = true;
    this.data.auditEvents.unshift({
      action: "NOTIFICATION_READ",
      actorUserId: actor.userId,
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      summary: `Marked notification “${notification.title}” as read.`,
      targetId: notification.id,
    });
    this.data.persist();
    return structuredClone(notification);
  }

  getAuditEvents(actor: RequestActor) {
    return structuredClone(
      this.data.auditEvents.filter(
        (event) => event.actorUserId === actor.userId,
      ),
    );
  }

  askAssistant(actor: RequestActor, question: string) {
    const normalized = question.trim().toLowerCase();
    const current = this.getCurrentTimesheet(actor);
    const total = current.entries.reduce(
      (sum, entry) =>
        sum +
        Object.values(entry.hours).reduce(
          (entrySum, hours) => entrySum + hours,
          0,
        ),
      0,
    );
    let answer: string;

    if (normalized.includes("missing") || normalized.includes("remain")) {
      const remaining = Math.max(current.expectedHours - total, 0);
      answer = remaining
        ? `${remaining} hours remain before the ${current.expectedHours}-hour expectation for ${current.label}.`
        : `${current.label} meets the ${current.expectedHours}-hour expectation.`;
    } else if (
      normalized.includes("status") ||
      normalized.includes("submitted")
    ) {
      answer = `The current timesheet for ${current.label} is ${current.status}.`;
    } else if (
      normalized.includes("summary") ||
      normalized.includes("summarize") ||
      normalized.includes("hours")
    ) {
      answer = `${current.label} contains ${total} recorded hours across ${current.entries.length} assignments, with ${current.expectedHours} hours expected.`;
    } else {
      answer =
        "I can summarize your current timesheet, report its status, or explain how many hours remain. I cannot access another employee’s records or take workflow actions.";
    }

    return {
      answer,
      generatedAt: new Date().toISOString(),
      readOnly: true,
      scope: "Employee · Own timesheets",
      sources: [
        {
          href: "/employee/timesheets/current",
          label: current.label,
        },
      ],
    };
  }

  private ownedTimesheet(actor: RequestActor, timesheetId: string) {
    const timesheet = this.data.timesheets.find(
      (item) =>
        item.id === timesheetId && item.employeeId === this.employeeId(actor),
    );
    if (!timesheet) throw new NotFoundException("Timesheet not found.");
    return timesheet;
  }

  private employeeTimesheets(actor: RequestActor) {
    return this.data.timesheets
      .filter((item) => item.employeeId === this.employeeId(actor))
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  }

  private toTimesheetResponse(timesheet: StaticTimesheet, actor: RequestActor) {
    const periods = this.employeeTimesheets(actor).toReversed();
    const position = periods.findIndex((item) => item.id === timesheet.id);
    const dates = this.periodDates(timesheet.periodStart, timesheet.periodEnd);
    const total = timesheet.entries.reduce(
      (sum, entry) =>
        sum + Object.values(entry.hours).reduce((row, hours) => row + hours, 0),
      0,
    );

    return {
      ...structuredClone(timesheet),
      label: this.periodLabel(timesheet.periodStart, timesheet.periodEnd),
      status: timesheet.status.toLowerCase(),
      previousPeriodId: position > 0 ? periods[position - 1]?.id : null,
      nextPeriodId:
        position >= 0 && position < periods.length - 1
          ? periods[position + 1]?.id
          : null,
      days: dates.map((date) => ({
        key: this.dayKey(date),
        day: this.dayKey(date),
        date: date.toISOString().slice(0, 10),
        displayDate: new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }).format(date),
        label: new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          timeZone: "UTC",
        }).format(date),
        shortLabel: new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          timeZone: "UTC",
        }).format(date),
      })),
      issues: [
        ...(total < timesheet.expectedHours
          ? [
              {
                id: "missing-hours",
                type: "missing" as const,
                title: `${timesheet.expectedHours - total} hours remain unrecorded`,
                message: `The current total is ${total} hours against ${timesheet.expectedHours} expected hours. Review the week before submitting.`,
              },
            ]
          : []),
        ...dates
          .map((date) => {
            const day = this.dayKey(date);
            const dayTotal = timesheet.entries.reduce(
              (sum, entry) => sum + (entry.hours[day] ?? 0),
              0,
            );
            return dayTotal > 12
              ? {
                  id: `unusual-${date.toISOString().slice(0, 10)}`,
                  type: "unusual" as const,
                  title: `Unusual total on ${this.dayKey(date).toUpperCase()}`,
                  message: `${dayTotal} hours is above the 12-hour review threshold. This statistical flag does not change approval automatically.`,
                }
              : null;
          })
          .filter((issue) => issue !== null),
      ],
    };
  }

  private assertEditable(status: StaticTimesheet["status"]): void {
    if (status !== "DRAFT" && status !== "REJECTED") {
      throw new ConflictException(
        "Only draft or rejected timesheets can be edited.",
      );
    }
  }

  private recordRevision(timesheet: StaticTimesheet): void {
    timesheet.revisions.push({
      createdAt: new Date().toISOString(),
      entries: structuredClone(timesheet.entries),
      status: timesheet.status,
      version: timesheet.version,
    });
  }

  private refreshTimesheetReminder(
    actor: RequestActor,
    timesheet: StaticTimesheet,
  ): void {
    const total = timesheet.entries.reduce(
      (sum, entry) =>
        sum +
        Object.values(entry.hours).reduce(
          (entrySum, hours) => entrySum + hours,
          0,
        ),
      0,
    );
    const remaining = Math.max(timesheet.expectedHours - total, 0);
    const id = `notification-reminder-${timesheet.id}`;
    const existing = this.data.notifications.find((item) => item.id === id);
    if (remaining === 0) {
      if (existing && !existing.read) {
        existing.read = true;
        this.data.persist();
      }
      return;
    }
    const message = `${remaining} ${remaining === 1 ? "hour remains" : "hours remain"} unrecorded in ${this.periodLabel(timesheet.periodStart, timesheet.periodEnd)}.`;
    if (existing) {
      if (existing.message !== message) {
        existing.message = message;
        existing.createdAt = new Date().toISOString();
        existing.read = false;
        this.data.persist();
      }
      return;
    }
    this.data.notifications.unshift({
      category: "reminder",
      createdAt: new Date().toISOString(),
      href: "/employee/timesheets/current",
      id,
      message,
      read: false,
      title: "Timesheet needs review",
      userId: actor.userId,
    });
    this.data.persist();
  }

  private employeeId(actor: RequestActor): string {
    if (!actor.employeeId) {
      throw new ForbiddenException("Employee access is required.");
    }
    return actor.employeeId;
  }

  private periodDates(start: string, end: string): Date[] {
    const dates: Date[] = [];
    for (
      let cursor = new Date(`${start}T00:00:00.000Z`);
      cursor <= new Date(`${end}T00:00:00.000Z`);
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      dates.push(new Date(cursor));
    }
    return dates;
  }

  private dayKey(date: Date): string {
    return (
      ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][date.getUTCDay()] ??
      "mon"
    );
  }

  private periodLabel(start: string, end: string): string {
    const format = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return `${format.format(new Date(`${start}T00:00:00.000Z`))}–${format.format(new Date(`${end}T00:00:00.000Z`))}, ${end.slice(0, 4)}`;
  }

  private initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }
}
