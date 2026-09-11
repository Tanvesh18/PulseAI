import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  cycleDates,
  employeeRows,
  validateRows,
  validateMaster,
} from "../src/portal/portal.rules";
import type { EmployeeInput } from "../src/portal/portal.types";
const employee: EmployeeInput = {
  code: "E1",
  name: "Employee One",
  email: "one@example.test",
  businessGroup: "AUTOSOL",
  grade: "Grade 5",
  billingGrade: "Grade 5",
  costCenter: "1234",
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
const projects = new Set(["P1"]);
const centers = new Set(["1234"]);
it("uses the configured monthly billing cycle", () => {
  expect(cycleDates("2026-09")).toEqual({
    start: "2026-08-23",
    end: "2026-09-22",
    standardHours: 167,
  });
});
it("generates full standard hours for an employee active all cycle", () => {
  expect(employeeRows(employee, "2026-09", "P1")[0].hours).toBe(167);
});
it("prorates a new joiner and removes employees who left before the cycle", () => {
  expect(
    employeeRows({ ...employee, joinDate: "2026-09-01" }, "2026-09", "P1")[0]
      .hours,
  ).toBeLessThan(167);
  expect(
    employeeRows({ ...employee, exitDate: "2026-08-01" }, "2026-09", "P1"),
  ).toEqual([]);
});
it("splits transfers and travel while preserving total expected hours", () => {
  const rows = employeeRows(
    {
      ...employee,
      previousCostCenter: "1235",
      transferDate: "2026-09-01",
      travelFrom: "2026-09-02",
      travelTo: "2026-09-10",
      usState: "TX",
    },
    "2026-09",
    "P1",
  );
  expect(rows.map((r) => r.costCenter)).toContain("1235");
  expect(rows.map((r) => r.location)).toContain("US");
  expect(rows.reduce((sum, r) => sum + r.hours, 0)).toBeCloseTo(167, 1);
});
it("requires short-hour remarks at submission but permits drafts", () => {
  const original = employeeRows(employee, "2026-09", "P1");
  const rows = [{ ...original[0], hours: 120 }];
  expect(() =>
    validateRows(rows, original, false, false, projects, centers),
  ).not.toThrow();
  expect(() =>
    validateRows(rows, original, false, true, projects, centers),
  ).toThrow("add remarks");
  expect(() =>
    validateRows(
      [{ ...rows[0], remarks: "Medical leave" }],
      original,
      false,
      true,
      projects,
      centers,
    ),
  ).not.toThrow();
});
it("prevents manager edits to HR identity, finance-only grades, and unknown assignments", () => {
  const original = employeeRows(employee, "2026-09", "P1");
  expect(() =>
    validateRows(
      [{ ...original[0], employeeName: "Other" }],
      original,
      true,
      false,
      projects,
      centers,
    ),
  ).toThrow(ForbiddenException);
  expect(() =>
    validateRows(
      [{ ...original[0], grade: "Grade 9" }],
      original,
      false,
      false,
      projects,
      centers,
    ),
  ).toThrow(ForbiddenException);
  expect(() =>
    validateRows(
      [{ ...original[0], projectCode: "other" }],
      original,
      false,
      false,
      projects,
      centers,
    ),
  ).toThrow(BadRequestException);
});
it("rejects deleting HR rows and invalid hour values", () => {
  const original = employeeRows(employee, "2026-09", "P1");
  expect(() =>
    validateRows([], original, false, false, projects, centers),
  ).toThrow("shared resource actions");
  for (const hours of [-1, NaN, Infinity, 745])
    expect(() =>
      validateRows(
        [{ ...original[0], hours }],
        original,
        false,
        false,
        projects,
        centers,
      ),
    ).toThrow(BadRequestException);
});
it("rejects invalid reference rates and date settings", () => {
  expect(() => validateMaster("fx", { usd: 0, eur: 90 })).toThrow();
  expect(() =>
    validateMaster("rate", { rate: 1, salaryMin: 200, salaryMax: 100 }),
  ).toThrow();
  expect(() =>
    validateMaster("cycle", { standardHours: 167, startDay: 31, endDay: 22 }),
  ).toThrow();
});
