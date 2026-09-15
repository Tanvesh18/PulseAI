import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";
import { staticIds } from "../src/data/demo-data";
import { employeeRows } from "../src/portal/portal.rules";
import type {
  EmployeeInput,
  MasterData,
  PortalRole,
} from "../src/portal/portal.types";

export async function seedPortal(prisma: PrismaClient) {
  const org = staticIds.organization;
  const period = new Date().toISOString().slice(0, 7);
  const roles: [PortalRole, string, string[]][] = [
    ["MANAGER", "John Miller", ["1234", "1235"]],
    ["FINANCE", "Emily Carter", []],
    ["HR", "Brian Scott", []],
    ["DIRECTOR", "Thomas Reed", []],
  ];
  for (const [role, name, centers] of roles)
    await prisma.user.upsert({
      where: { oidcSubject: `dev-portal-${role.toLowerCase()}` },
      create: {
        id: randomUUID(),
        employeeId: randomUUID(),
        organizationId: org,
        role,
        displayName: name,
        email: `${role.toLowerCase()}@pulse.example.test`,
        active: true,
        oidcSubject: `dev-portal-${role.toLowerCase()}`,
        costCenters: centers,
      },
      update: {},
    });
  const masters: [string, string, MasterData][] = [
    [
      "business-group",
      "AUTOSOL",
      {
        name: "Automation Solutions",
        platform: "Engineering",
        unit: "Corp Engineering",
        contribution: 100,
      },
    ],
    [
      "business-group",
      "ECOE",
      {
        name: "Engineering Centre of Excellence",
        platform: "CoE",
        unit: "ECOE",
        contribution: 100,
      },
    ],
    [
      "business-group",
      "ACOE",
      {
        name: "Automation Centre of Excellence",
        platform: "CoE",
        unit: "ACOE",
        contribution: 100,
      },
    ],
    [
      "project",
      "3302844",
      { description: "CFD simulation", businessGroup: "AUTOSOL" },
    ],
    [
      "project",
      "5201 Parts Kitting",
      { description: "Parts kitting service", businessGroup: "ACOE" },
    ],
    [
      "project",
      "2460 HW update",
      { description: "Hardware update", businessGroup: "ECOE" },
    ],
    [
      "cost-center",
      "1234",
      {
        name: "Automation Solutions",
        businessGroup: "AUTOSOL",
        owner: "John Miller",
        backCharging: true,
      },
    ],
    [
      "cost-center",
      "1235",
      {
        name: "Engineering CoE",
        businessGroup: "ECOE",
        owner: "John Miller",
        backCharging: true,
      },
    ],
    [
      "cost-center",
      "1236",
      {
        name: "Automation CoE",
        businessGroup: "ACOE",
        owner: "Unassigned",
        backCharging: false,
      },
    ],
    ["rate", "Grade 5", { rate: 2640, salaryMin: 100000, salaryMax: 2000000 }],
    ["rate", "Grade 7", { rate: 3480, salaryMin: 2000001, salaryMax: 3000000 }],
    ["rate", "Grade 8", { rate: 3650, salaryMin: 3000001, salaryMax: 4000000 }],
    ["rate", "Grade 9", { rate: 4000, salaryMin: 4000001, salaryMax: 5000000 }],
    ["fx", period, { usd: 83.5, eur: 90.2 }],
    ["cycle", period, { standardHours: 167, startDay: 23, endDay: 22 }],
  ];
  for (const [kind, code, data] of masters)
    await prisma.masterRecord.upsert({
      where: { organizationId_kind_code: { organizationId: org, kind, code } },
      create: { organizationId: org, kind, code, data },
      update: {},
    });
  const people: [string, string, string, string, string][] = [
    ["285201", "John Miller", "AUTOSOL", "Grade 5", "1234"],
    ["270011", "Sarah Johnson", "AUTOSOL", "Grade 7", "1234"],
    ["325924", "Michael Brown", "AUTOSOL", "Grade 8", "1234"],
    ["251777", "Emily Davis", "AUTOSOL", "Grade 5", "1234"],
    ["412301", "David Wilson", "ECOE", "Grade 5", "1235"],
    ["265760", "Laura Martinez", "ECOE", "Grade 9", "1235"],
    ["298451", "Robert Taylor", "ACOE", "Grade 7", "1236"],
  ];
  for (const [code, name, businessGroup, grade, costCenter] of people) {
    const employee: EmployeeInput = {
      code,
      name,
      email: `${code}@pulse.example.test`,
      businessGroup,
      grade,
      billingGrade: grade,
      costCenter,
      joinDate: code === "412301" ? `${period}-01` : "2025-01-01",
      exitDate: null,
      transferDate: null,
      previousCostCenter: null,
      annualSalary: 0,
      travelFrom: code === "251777" ? `${period}-01` : null,
      travelTo: code === "251777" ? `${period}-10` : null,
      usState: code === "251777" ? "TX" : null,
      category: "Employee",
    };
    await prisma.workforceEmployee.upsert({
      where: { organizationId_code: { organizationId: org, code } },
      create: { organizationId: org, ...employee },
      update: {},
    });
  }
  const manager = await prisma.user.findUniqueOrThrow({
    where: { oidcSubject: "dev-portal-manager" },
  });
  const employees = await prisma.workforceEmployee.findMany({
    where: { organizationId: org },
  });
  for (const costCenter of ["1234", "1235"]) {
    const rows = employees
      .flatMap((e) =>
        employeeRows(
          e,
          period,
          costCenter === "1234" ? "3302844" : "2460 HW update",
        ),
      )
      .filter((r) => r.costCenter === costCenter);
    for (const row of rows)
      if (row.employeeCode === "325924") {
        row.hours = 120;
        row.remarks = "";
      }
    await prisma.businessTimesheet.upsert({
      where: {
        organizationId_period_costCenter: {
          organizationId: org,
          period,
          costCenter,
        },
      },
      create: {
        organizationId: org,
        period,
        costCenter,
        businessGroup: costCenter === "1234" ? "AUTOSOL" : "ECOE",
        managerUserId: manager.id,
        rows,
      },
      update: {},
    });
  }
  console.log(
    "Portal demo roles, reference data, and monthly timesheets seeded.",
  );
}
