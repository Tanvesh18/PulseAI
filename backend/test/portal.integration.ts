import "dotenv/config";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { PrismaService } from "../src/data/prisma.service";
import { PortalService, sheetRows } from "../src/portal/portal.service";
import { PortalWorkbookService } from "../src/portal/portal-workbook.service";
import { employeeRows } from "../src/portal/portal.rules";
import type { RequestActor } from "../src/auth/request-actor";
import type { EmployeeInput, PortalRole } from "../src/portal/portal.types";
if (!process.env.TEST_DATABASE_URL)
  throw new Error("TEST_DATABASE_URL must point to an isolated test database.");
jest.setTimeout(120000);
const prisma = new PrismaService(
  new ConfigService({ DATABASE_URL: process.env.TEST_DATABASE_URL }),
);
const portal = new PortalService(prisma, new ConfigService());
const workbooks = new PortalWorkbookService(portal);
const org = randomUUID();
const period = "2026-09";
const actors = Object.fromEntries(
  ["MANAGER", "FINANCE", "HR", "DIRECTOR"].map((role) => [
    role,
    {
      userId: randomUUID(),
      employeeId: randomUUID(),
      organizationId: org,
      role,
    },
  ]),
) as Record<PortalRole, RequestActor>;
const employee: EmployeeInput = {
  code: "E1",
  name: "Test Employee",
  email: `${org}@example.test`,
  businessGroup: "BG",
  grade: "Grade 5",
  billingGrade: "Grade 5",
  costCenter: "C1",
  joinDate: "2025-01-01",
  exitDate: null,
  transferDate: null,
  previousCostCenter: null,
  annualSalary: 0,
  travelFrom: null,
  travelTo: null,
  usState: null,
  category: "Employee",
};
let sheetId: string;
beforeAll(async () => {
  for (const actor of Object.values(actors))
    await prisma.user.create({
      data: {
        id: actor.userId,
        employeeId: actor.employeeId!,
        organizationId: org,
        role: actor.role,
        displayName: actor.role,
        email: `${actor.userId}@example.test`,
        oidcSubject: actor.userId,
        costCenters: actor.role === "MANAGER" ? ["C1"] : [],
      },
    });
  await prisma.workforceEmployee.createMany({
    data: [
      { ...employee, organizationId: org },
      {
        ...employee,
        code: "E2",
        name: "Shared Employee",
        email: `shared-${org}@example.test`,
        organizationId: org,
      },
    ],
  });
  await prisma.masterRecord.createMany({
    data: [
      {
        organizationId: org,
        kind: "business-group",
        code: "BG",
        data: { name: "Test BG", platform: "Engineering" },
      },
      {
        organizationId: org,
        kind: "cost-center",
        code: "C1",
        data: {
          name: "Test Center",
          businessGroup: "BG",
          owner: "Manager",
          backCharging: true,
        },
      },
      {
        organizationId: org,
        kind: "project",
        code: "P1",
        data: { description: "Test project", businessGroup: "BG" },
      },
      {
        organizationId: org,
        kind: "rate",
        code: "Grade 5",
        data: { rate: 100, salaryMin: 0, salaryMax: 1000 },
      },
      {
        organizationId: org,
        kind: "fx",
        code: period,
        data: { usd: 80, eur: 90 },
      },
    ],
  });
  const sheet = await prisma.businessTimesheet.create({
    data: {
      organizationId: org,
      period,
      costCenter: "C1",
      businessGroup: "BG",
      managerUserId: actors.MANAGER.userId,
      rows: employeeRows(employee, period, "P1"),
    },
  });
  sheetId = sheet.id;
});
afterAll(async () => {
  try {
    const ids = Object.values(actors).map((a) => a.userId);
    await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.businessTimesheet.deleteMany({
      where: { organizationId: org },
    });
    await prisma.workforceEmployee.deleteMany({
      where: { organizationId: org },
    });
    await prisma.masterRecord.deleteMany({ where: { organizationId: org } });
    await prisma.hRImport.deleteMany({ where: { organizationId: org } });
    await prisma.user.deleteMany({ where: { organizationId: org } });
  } finally {
    await prisma.$disconnect();
  }
});
it("enforces roles and cost-center scope on the server", async () => {
  await expect(
    portal.saveMaster(actors.MANAGER, {
      kind: "project",
      code: "BAD",
      data: { description: "No", businessGroup: "BG" },
    }),
  ).rejects.toThrow("Your role");
  await expect(
    portal.updateSheet(actors.MANAGER, randomUUID(), {
      expectedVersion: 1,
      rows: [],
    }),
  ).rejects.toThrow("not found");
});
it("allows only shared resource removal and persists additions", async () => {
  const before = (await portal.listSheets(actors.MANAGER, period))[0];
  await expect(
    portal.shared(actors.MANAGER, sheetId, {
      expectedVersion: before.version,
      removeId: sheetRows(before.rows)[0].id,
    }),
  ).rejects.toThrow("Only shared");
  const added = await portal.shared(actors.MANAGER, sheetId, {
    expectedVersion: before.version,
    employeeCode: "E2",
    projectCode: "P1",
    costCenter: "C1",
    hours: 20,
  });
  expect(sheetRows(added.rows)).toHaveLength(2);
  const shared = sheetRows(added.rows).find((r) => r.shared)!;
  const removed = await portal.shared(actors.MANAGER, sheetId, {
    expectedVersion: added.version,
    removeId: shared.id,
  });
  expect(sheetRows(removed.rows)).toHaveLength(1);
});
it("serializes competing saves and requires remarks before submission", async () => {
  const before = (await portal.listSheets(actors.MANAGER, period))[0];
  const rows = sheetRows(before.rows).map((r) => ({ ...r, hours: 120 }));
  const results = await Promise.allSettled([
    portal.updateSheet(actors.MANAGER, sheetId, {
      expectedVersion: before.version,
      rows,
    }),
    portal.updateSheet(actors.MANAGER, sheetId, {
      expectedVersion: before.version,
      rows,
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  let current = (await portal.listSheets(actors.MANAGER, period))[0];
  await expect(
    portal.action(actors.MANAGER, sheetId, {
      action: "submit",
      expectedVersion: current.version,
    }),
  ).rejects.toThrow("add remarks");
  current = await portal.updateSheet(actors.MANAGER, sheetId, {
    expectedVersion: current.version,
    rows: rows.map((r) => ({ ...r, remarks: "Medical leave" })),
  });
  current = await portal.action(actors.MANAGER, sheetId, {
    action: "submit",
    expectedVersion: current.version,
  });
  expect(current.status).toBe("SUBMITTED");
  await expect(
    portal.updateSheet(actors.MANAGER, sheetId, {
      expectedVersion: current.version,
      rows,
    }),
  ).rejects.toThrow("locked");
  expect(await portal.notifications(actors.DIRECTOR)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: "Timesheet submitted" }),
    ]),
  );
});
it("returns, resubmits, approves and requires fresh approval after Finance edits", async () => {
  let current = (await portal.listSheets(actors.DIRECTOR, period))[0];
  await expect(
    portal.action(actors.DIRECTOR, sheetId, {
      action: "return",
      expectedVersion: current.version,
      reason: "",
    }),
  ).rejects.toThrow("Reason");
  current = await portal.action(actors.DIRECTOR, sheetId, {
    action: "return",
    expectedVersion: current.version,
    reason: "Correct the project",
  });
  expect(current.status).toBe("REJECTED");
  current = await portal.action(actors.MANAGER, sheetId, {
    action: "submit",
    expectedVersion: current.version,
  });
  expect(current.status).toBe("RESUBMITTED");
  current = await portal.action(actors.DIRECTOR, sheetId, {
    action: "approve",
    expectedVersion: current.version,
  });
  expect(current.status).toBe("APPROVED");
  current = await portal.updateSheet(actors.FINANCE, sheetId, {
    expectedVersion: current.version,
    rows: sheetRows(current.rows).map((r) => ({ ...r, hours: 125 })),
  });
  expect(current.status).toBe("SUBMITTED");
  await portal.action(actors.DIRECTOR, sheetId, {
    action: "approve",
    expectedVersion: current.version,
  });
});
it("calculates revenue and downloads real Excel exports", async () => {
  const rows = await workbooks.report(actors.FINANCE, {
    period,
    kind: "platform",
  });
  expect(rows[0]).toMatchObject({
    Hours: 125,
    "Revenue INR": 12500,
    "Revenue USD": 156.25,
  });
  const managerRows = await workbooks.report(actors.MANAGER, {
    period,
    kind: "platform",
  });
  expect(managerRows[0]).not.toHaveProperty("Revenue INR");
  const buffer = await workbooks.exportOracle(actors.FINANCE, period);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  expect(wb.worksheets[0].rowCount).toBe(2);
});
it("validates HR imports atomically and preserves locked timesheets", async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("All Employees");
  sheet.addRow([
    "Employee Code",
    "Employee Name",
    "Email",
    "Business Group",
    "Oracle Grade",
    "Billing Grade",
    "Cost Center",
    "Join Date",
  ]);
  sheet.addRow([
    "E3",
    "New Joiner",
    `${randomUUID()}@example.test`,
    "BG",
    "Grade 5",
    "Grade 5",
    "C1",
    "2026-09-01",
  ]);
  const summary = await workbooks.importHR(actors.HR, {
    period,
    filename: "employees.xlsx",
    base64: Buffer.from(await wb.xlsx.writeBuffer()).toString("base64"),
  });
  expect(summary.newEmployees).toBe(1);
  expect(summary.locked).toBe(1);
  sheet.addRow([
    "E4",
    "",
    "invalid",
    "BG",
    "Grade 5",
    "Grade 5",
    "C1",
    "bad-date",
  ]);
  await expect(
    workbooks.importHR(actors.HR, {
      period,
      filename: "bad.xlsx",
      base64: Buffer.from(await wb.xlsx.writeBuffer()).toString("base64"),
    }),
  ).rejects.toThrow();
  expect(
    await prisma.workforceEmployee.count({
      where: { organizationId: org, code: "E4" },
    }),
  ).toBe(0);
});
it("revokes and restores access on subsequent API requests", async () => {
  await portal.setAccess(actors.FINANCE, actors.DIRECTOR.userId, false);
  await expect(portal.session(actors.DIRECTOR)).rejects.toThrow(
    "access has changed",
  );
  await portal.setAccess(actors.FINANCE, actors.DIRECTOR.userId, true);
  expect((await portal.session(actors.DIRECTOR)).role).toBe("DIRECTOR");
});
