import "dotenv/config";
import { ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/data/prisma.service";
import { EmployeeRepository } from "../src/data/employee.repository";
import { DemoData, staticIds } from "../src/data/demo-data";
import { EmployeeService } from "../src/employee/employee.service";
import type { RequestActor } from "../src/auth/request-actor";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL to a separate migrated PostgreSQL test database.");
}

const config = new ConfigService({ DATABASE_URL: process.env.TEST_DATABASE_URL });
const first = new PrismaService(config);
const second = new PrismaService(config);
const repository = new EmployeeRepository(first);
const service = new EmployeeService(repository);
const otherService = new EmployeeService(new EmployeeRepository(second));
const prefix = randomUUID();
let serialized = JSON.stringify(new DemoData());
for (const id of Object.values(staticIds)) serialized = serialized.replaceAll(id, randomUUID());
const data = JSON.parse(serialized) as DemoData;
data.users[0].email = `${prefix}@example.test`;
data.users[0].oidcSubject = prefix;
data.notifications.forEach((item) => { item.id = `${prefix}-${item.id}`; });
const actor: RequestActor = {
  userId: data.users[0].id, employeeId: data.profiles[0].id,
  organizationId: data.users[0].organizationId, role: "EMPLOYEE",
};
const sheetId = data.timesheets[0].id;
const update = (version: number, hours: number) => ({
  expectedVersion: version,
  entries: [{ assignmentId: data.assignments[0].id, days: [{ date: "2026-08-24", hours }] }],
});

beforeAll(async () => {
  await first.$connect();
  await second.$connect();
  await first.$transaction(async (tx) => {
    await tx.user.createMany({ data: data.users });
    await tx.employeeProfile.createMany({ data: data.profiles });
    await tx.assignment.createMany({ data: data.assignments });
    await tx.timesheet.createMany({ data: data.timesheets });
    await tx.notification.createMany({ data: data.notifications });
  });
}, 30000);

afterAll(async () => {
  try {
    await first.$transaction(async (tx) => {
      await tx.auditEvent.deleteMany({ where: { actorUserId: actor.userId } });
      await tx.notification.deleteMany({ where: { userId: actor.userId } });
      await tx.timesheet.deleteMany({ where: { employeeId: data.profiles[0].id } });
      await tx.assignment.deleteMany({ where: { employeeId: data.profiles[0].id } });
      await tx.employeeProfile.deleteMany({ where: { userId: actor.userId } });
      await tx.user.deleteMany({ where: { id: actor.userId } });
    });
  } finally {
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  }
}, 30000);

it("persists timesheets, revisions and audit events across independent clients", async () => {
  const saved = await service.updateTimesheet(actor, sheetId, update(1, 7));
  const restored = await otherService.getTimesheet(actor, sheetId);
  expect(restored.version).toBe(saved.version);
  expect(restored.entries[0].hours.mon).toBe(7);
  expect(restored.revisions).toHaveLength(1);
  expect(await otherService.getAuditEvents(actor)).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: "TIMESHEET_UPDATED", targetId: sheetId }),
  ]));
});

it("allows only one concurrent save with the same expected version", async () => {
  const current = await service.getTimesheet(actor, sheetId);
  const results = await Promise.allSettled([
    service.updateTimesheet(actor, sheetId, update(current.version, 5)),
    otherService.updateTimesheet(actor, sheetId, update(current.version, 6)),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.reason).toBeInstanceOf(ConflictException);
});

it("rolls back the timesheet if a related database write fails", async () => {
  const before = await service.getTimesheet(actor, sheetId);
  await expect(repository.run(actor, true, (snapshot) => {
    snapshot.timesheets.find((item) => item.id === sheetId)!.version += 1;
    snapshot.auditEvents.unshift({
      id: randomUUID(), actorUserId: "nonexistent-user", action: "TIMESHEET_UPDATED",
      createdAt: new Date().toISOString(), summary: "Force foreign key failure", targetId: sheetId,
    });
  })).rejects.toThrow();
  expect((await otherService.getTimesheet(actor, sheetId)).version).toBe(before.version);
});

it("persists notification reads and denies another employee's records", async () => {
  const notification = (await service.listNotifications(actor))[0];
  await service.markNotificationRead(actor, notification.id);
  expect((await otherService.listNotifications(actor)).find((item) => item.id === notification.id)?.read).toBe(true);
  await expect(service.getTimesheet(actor, staticIds.currentTimesheet)).rejects.toThrow("Timesheet not found");
});
