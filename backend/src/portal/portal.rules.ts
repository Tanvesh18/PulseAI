import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { EmployeeInput, MasterData, MonthlyRow } from "./portal.types";

export function textField(
  value: unknown,
  label: string,
  required = true,
): string {
  if (
    typeof value !== "string" ||
    value.length > 500 ||
    (required && !value.trim())
  ) {
    throw new BadRequestException(
      `${label} is required and must be at most 500 characters.`,
    );
  }
  return value.trim();
}
export function periodValue(value: unknown): string {
  const period = textField(value, "Billing month");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
    throw new BadRequestException("Use YYYY-MM for the billing month.");
  return period;
}
export function dateValue(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`Invalid date: ${value}. Use YYYY-MM-DD.`);
  }
  return value;
}
export function cycleDates(period: string, settings: MasterData = {}) {
  periodValue(period);
  const [year, month] = period.split("-").map(Number);
  const startDay = Number(settings.startDay ?? 23);
  const endDay = Number(settings.endDay ?? 22);
  const start = new Date(Date.UTC(year, month - 2, startDay))
    .toISOString()
    .slice(0, 10);
  const end = new Date(Date.UTC(year, month - 1, endDay))
    .toISOString()
    .slice(0, 10);
  return { start, end, standardHours: Number(settings.standardHours ?? 167) };
}
function workingDates(start: string, end: string): string[] {
  const days: string[] = [];
  for (
    const date = new Date(start);
    date <= new Date(end);
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
      days.push(date.toISOString().slice(0, 10));
  }
  return days;
}
export function employeeRows(
  employee: EmployeeInput,
  period: string,
  projectCode: string,
  settings: MasterData = {},
): MonthlyRow[] {
  const cycle = cycleDates(period, settings);
  const all = workingDates(cycle.start, cycle.end);
  const active = all.filter(
    (date) =>
      date >= employee.joinDate &&
      (!employee.exitDate || date <= employee.exitDate),
  );
  if (!active.length) return [];
  const groups = new Map<
    string,
    { costCenter: string; location: "US" | "Non-US"; dates: string[] }
  >();
  for (const date of active) {
    const costCenter =
      employee.transferDate &&
      employee.previousCostCenter &&
      date < employee.transferDate
        ? employee.previousCostCenter
        : employee.costCenter;
    const location =
      employee.travelFrom &&
      employee.travelTo &&
      date >= employee.travelFrom &&
      date <= employee.travelTo
        ? "US"
        : "Non-US";
    const key = `${costCenter}-${location}`;
    const group = groups.get(key) ?? { costCenter, location, dates: [] };
    group.dates.push(date);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const expectedHours =
      Math.round(
        ((cycle.standardHours * group.dates.length) / all.length) * 100,
      ) / 100;
    return {
      id: `${employee.code}-${group.costCenter}-${group.location}`,
      employeeCode: employee.code,
      employeeName: employee.name,
      businessGroup: employee.businessGroup,
      grade: employee.grade,
      billingGrade: employee.billingGrade,
      costCenter: group.costCenter,
      projectCode,
      location: group.location,
      usState: group.location === "US" ? (employee.usState ?? "") : "",
      hours: expectedHours,
      expectedHours,
      remarks:
        group.location === "US"
          ? "B1 travel"
          : active.length < all.length
            ? "Pro-rated active working days"
            : "",
      shared: false,
    };
  });
}
export function validateRows(
  rows: MonthlyRow[],
  previous: MonthlyRow[],
  finance: boolean,
  submitting: boolean,
  projects: Set<string>,
  centers: Set<string>,
) {
  if (!Array.isArray(rows) || rows.length > 1000)
    throw new BadRequestException("Provide at most 1,000 timesheet rows.");
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new BadRequestException("Duplicate timesheet rows are not allowed.");
  if (
    rows.length !== previous.length ||
    previous.some((row) => !rows.some((item) => item.id === row.id))
  )
    throw new BadRequestException(
      "Use the shared resource actions to add or remove rows.",
    );
  for (const row of rows) {
    const old = previous.find((item) => item.id === row.id)!;
    for (const field of [
      "employeeCode",
      "employeeName",
      "shared",
      "expectedHours",
    ] as const) {
      if (row[field] !== old[field])
        throw new ForbiddenException(
          `${field} comes from HR and cannot be edited here.`,
        );
    }
    if (
      !finance &&
      (["businessGroup", "grade", "billingGrade"] as const).some(
        (key) => row[key] !== old[key],
      )
    )
      throw new ForbiddenException(
        "Only Finance can edit grade and business group fields.",
      );
    for (const key of [
      "id",
      "businessGroup",
      "grade",
      "billingGrade",
      "costCenter",
      "projectCode",
      "usState",
      "remarks",
    ] as const)
      textField(row[key], key, !["remarks", "usState"].includes(key));
    if (
      typeof row.hours !== "number" ||
      !Number.isFinite(row.hours) ||
      row.hours < 0 ||
      row.hours > 744
    )
      throw new BadRequestException("Hours must be between 0 and 744.");
    if (!["US", "Non-US"].includes(row.location))
      throw new BadRequestException("Choose US or Non-US.");
    if (row.location === "US" && !/^[A-Z]{2}$/.test(row.usState))
      throw new BadRequestException("US rows require a two-letter state.");
    if (!projects.has(row.projectCode) || !centers.has(row.costCenter))
      throw new BadRequestException(
        "Choose a valid project and assigned cost center.",
      );
    if (submitting && row.hours < row.expectedHours && !row.remarks.trim())
      throw new BadRequestException(
        `${row.employeeName}: add remarks for hours below ${row.expectedHours}.`,
      );
  }
  if (submitting && !rows.some((row) => row.hours > 0))
    throw new BadRequestException("Record hours before submitting.");
}

export function validateMaster(kind: string, data: MasterData) {
  const required: Record<string, string[]> = {
    "business-group": ["name", "platform"],
    project: ["description", "businessGroup"],
    "cost-center": ["name", "businessGroup", "owner"],
    rate: ["rate", "salaryMin", "salaryMax"],
    fx: ["usd", "eur"],
    cycle: ["standardHours", "startDay", "endDay"],
  };
  if (!(kind in required))
    throw new BadRequestException("Unknown master data category.");
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new BadRequestException("Master data must be an object.");
  for (const field of required[kind]) {
    const value = data[field];
    if (value === undefined || value === "")
      throw new BadRequestException(`${field} is required.`);
  }
  for (const [field, value] of Object.entries(data)) {
    if (
      !["string", "number", "boolean"].includes(typeof value) ||
      String(value).length > 500
    )
      throw new BadRequestException(`Invalid ${field}.`);
  }
  const numeric =
    kind === "rate"
      ? ["rate", "salaryMin", "salaryMax"]
      : kind === "fx"
        ? ["usd", "eur"]
        : kind === "cycle"
          ? ["standardHours", "startDay", "endDay"]
          : [];
  for (const key of numeric)
    if (!Number.isFinite(Number(data[key])) || Number(data[key]) < 0)
      throw new BadRequestException(`${key} must be a non-negative number.`);
  if (kind === "rate" && Number(data.salaryMax) < Number(data.salaryMin))
    throw new BadRequestException(
      "Salary maximum must be at least the minimum.",
    );
  if (kind === "fx" && (Number(data.usd) <= 0 || Number(data.eur) <= 0))
    throw new BadRequestException("FX rates must be positive.");
  if (
    kind === "cycle" &&
    (!Number.isInteger(Number(data.startDay)) ||
      !Number.isInteger(Number(data.endDay)) ||
      Number(data.startDay) < 1 ||
      Number(data.startDay) > 28 ||
      Number(data.endDay) < 1 ||
      Number(data.endDay) > 28 ||
      Number(data.standardHours) <= 0)
  )
    throw new BadRequestException(
      "Cycle days must be 1–28 and standard hours must be positive.",
    );
}
