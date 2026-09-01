import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
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
    timesheet.status =
      timesheet.status === "REJECTED" ? "RESUBMITTED" : "SUBMITTED";
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
    return this.toTimesheetResponse(timesheet, actor);
  }

  listNotifications(actor: RequestActor) {
    return structuredClone(
      this.data.notifications.filter((item) => item.userId === actor.userId),
    );
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

  private toTimesheetResponse(
    timesheet: StaticTimesheet,
    actor: RequestActor,
  ) {
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
      issues:
        total < timesheet.expectedHours
          ? [
              {
                id: "missing-hours",
                type: "missing" as const,
                title: `${timesheet.expectedHours - total} hours remain unrecorded`,
                message: `The current total is ${total} hours against ${timesheet.expectedHours} expected hours. Review the week before submitting.`,
              },
            ]
          : [],
    };
  }

  private assertEditable(status: StaticTimesheet["status"]): void {
    if (status !== "DRAFT" && status !== "REJECTED") {
      throw new ConflictException(
        "Only draft or rejected timesheets can be edited.",
      );
    }
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
