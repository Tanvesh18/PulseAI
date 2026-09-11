import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { RequestActor } from "../auth/request-actor";
import type { EmployeeData, EmployeeTimesheet, EmployeeAuditEvent } from "./employee-data";
import { PrismaService } from "./prisma.service";

/** Each workflow gets a fresh, employee-scoped snapshot inside one transaction. */
@Injectable()
export class EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(actor: RequestActor, mutate: boolean, operation: (data: EmployeeData) => T): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize operations for this employee across API instances, before reading
      // versions. READ COMMITTED then observes the preceding committed mutation.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: actor.userId } });
      if (!user?.active || user.role !== "EMPLOYEE" || user.employeeId !== actor.employeeId || user.organizationId !== actor.organizationId) {
        throw new UnauthorizedException("An active Employee account is required.");
      }
      const [profiles, assignments, timesheets, notifications, auditEvents] = await Promise.all([
        tx.employeeProfile.findMany({ where: { id: actor.employeeId, userId: actor.userId } }),
        tx.assignment.findMany({ where: { employeeId: actor.employeeId } }),
        tx.timesheet.findMany({ where: { employeeId: actor.employeeId } }),
        tx.notification.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: "desc" } }),
        tx.auditEvent.findMany({ where: { actorUserId: actor.userId }, orderBy: { createdAt: "desc" } }),
      ]);
      if (profiles.length !== 1) throw new UnauthorizedException("Employee profile is unavailable.");
      const data: EmployeeData = {
        users: [user], profiles, assignments, notifications,
        timesheets: timesheets as unknown as EmployeeTimesheet[],
        auditEvents: auditEvents as EmployeeAuditEvent[],
      };
      const before = structuredClone(data);
      const result = operation(data);
      if (mutate) {
        for (const sheet of data.timesheets) {
          if (JSON.stringify(sheet) !== JSON.stringify(before.timesheets.find((item) => item.id === sheet.id))) {
            await tx.timesheet.update({ where: { id: sheet.id }, data: sheet });
          }
        }
        for (const notification of data.notifications) {
          if (JSON.stringify(notification) !== JSON.stringify(before.notifications.find((item) => item.id === notification.id))) {
            await tx.notification.upsert({ where: { id: notification.id }, create: notification, update: notification });
          }
        }
        const existingEvents = new Set(before.auditEvents.map((item) => item.id));
        const newEvents = data.auditEvents.filter((item) => !existingEvents.has(item.id));
        if (newEvents.length) await tx.auditEvent.createMany({ data: newEvents });
      }
      return result;
    }, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 15000 });
  }
}
