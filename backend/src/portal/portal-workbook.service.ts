import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import ExcelJS from "exceljs";
import type { RequestActor } from "../auth/request-actor";
import { PortalService, jsonData, sheetRows } from "./portal.service";
import {
  dateValue,
  employeeRows,
  periodValue,
  textField,
  validateMaster,
} from "./portal.rules";
import type { EmployeeInput, MasterData } from "./portal.types";

const headers: Record<string, keyof EmployeeInput> = {
  "Employee Code": "code",
  "Employee Name": "name",
  Email: "email",
  "Business Group": "businessGroup",
  "Oracle Grade": "grade",
  "Billing Grade": "billingGrade",
  "Cost Center": "costCenter",
  "Join Date": "joinDate",
  "Exit Date": "exitDate",
  "Transfer Date": "transferDate",
  "Previous Cost Center": "previousCostCenter",
  "Annual Salary": "annualSalary",
  "Travel From": "travelFrom",
  "Travel To": "travelTo",
  "US State": "usState",
  Category: "category",
};
const tabs = [
  "All Employees",
  "Transfer Resources",
  "Contract Resources",
  "Departures",
  "Interns",
  "Salary Change",
];
type ReportRow = Record<string, string | number>;

@Injectable()
export class PortalWorkbookService {
  constructor(private readonly portal: PortalService) {}
  async workbook(filename: unknown, base64: unknown) {
    if (
      !textField(filename, "Filename").toLowerCase().endsWith(".xlsx") ||
      typeof base64 !== "string" ||
      base64.length > 8_000_000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    )
      throw new BadRequestException(
        "Upload an .xlsx workbook smaller than 6 MB.",
      );
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(
        Buffer.from(base64, "base64") as unknown as Parameters<
          typeof workbook.xlsx.load
        >[0],
      );
    } catch {
      throw new BadRequestException(
        "This file is not a readable Excel workbook.",
      );
    }
    return workbook;
  }
  async download(rows: ReportRow[], name: string) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(name.slice(0, 31));
    const columns = Object.keys(rows[0] ?? { Result: "" });
    sheet.columns = columns.map((key) => ({
      header: key,
      key,
      width: Math.min(35, Math.max(key.length + 3, 18)),
    }));
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  async template() {
    const workbook = new ExcelJS.Workbook();
    for (const name of tabs) {
      const sheet = workbook.addWorksheet(name);
      sheet.addRow(Object.keys(headers));
      sheet.getRow(1).font = { bold: true };
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  async importHR(
    actor: RequestActor,
    body: { period: string; filename: string; base64: string },
  ) {
    periodValue(body.period);
    // Authorize before parsing user-supplied workbooks.
    await this.portal.run(actor, ["HR", "FINANCE"], () =>
      Promise.resolve(true),
    );
    const workbook = await this.workbook(body.filename, body.base64);
    if (!workbook.getWorksheet("All Employees"))
      throw new BadRequestException(
        "The workbook needs an All Employees tab. Download the template for the column names.",
      );
    return this.portal.run(actor, ["HR", "FINANCE"], async (tx, user) => {
      const existing = await tx.workforceEmployee.findMany({
        where: { organizationId: user.organizationId },
      });
      const employees = new Map<string, EmployeeInput>(
        existing.map((e) => [e.code, e]),
      );
      const changed = new Set<string>();
      const errors: string[] = [];
      let records = 0;
      for (const name of tabs) {
        const sheet = workbook.getWorksheet(name);
        if (!sheet) continue;
        if (sheet.rowCount > 2001)
          throw new BadRequestException(
            "Each workbook tab supports at most 2,000 rows.",
          );
        const columns = new Map<number, keyof EmployeeInput>();
        sheet.getRow(1).eachCell((cell, index) => {
          const key = headers[cell.text.trim()];
          if (key) columns.set(index, key);
        });
        if (![...columns.values()].includes("code"))
          throw new BadRequestException(
            `${name}: Employee Code column is missing.`,
          );
        const seen = new Set<string>();
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const values: Record<string, string | number | null> = {};
          columns.forEach((key, col) => {
            const cell = row.getCell(col);
            if (cell.value !== null && cell.text.trim() !== "")
              values[key] =
                cell.value instanceof Date
                  ? cell.value.toISOString().slice(0, 10)
                  : key === "annualSalary"
                    ? Number(cell.value)
                    : cell.text.trim();
          });
          if (!Object.keys(values).length) return;
          const code = String(values.code ?? "");
          if (!code || seen.has(code)) {
            errors.push(
              `${name}, row ${rowNumber}: missing or duplicate employee code.`,
            );
            return;
          }
          seen.add(code);
          records++;
          const employee = {
            code,
            name: "",
            email: "",
            businessGroup: "",
            grade: "",
            billingGrade: "",
            costCenter: "",
            joinDate: "",
            exitDate: null,
            transferDate: null,
            previousCostCenter: null,
            annualSalary: 0,
            travelFrom: null,
            travelTo: null,
            usState: null,
            category:
              name === "Contract Resources"
                ? "Contract"
                : name === "Interns"
                  ? "Intern"
                  : "Employee",
            ...employees.get(code),
            ...values,
          };
          try {
            for (const key of [
              "code",
              "name",
              "email",
              "businessGroup",
              "grade",
              "costCenter",
              "joinDate",
            ] as const)
              textField(employee[key], key);
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email))
              throw new Error("Email is invalid.");
            for (const key of [
              "joinDate",
              "exitDate",
              "transferDate",
              "travelFrom",
              "travelTo",
            ] as const)
              if (employee[key]) dateValue(employee[key]);
            if (
              !Number.isFinite(employee.annualSalary) ||
              employee.annualSalary < 0
            )
              throw new Error("Annual Salary must be non-negative.");
            if (employee.exitDate && employee.exitDate < employee.joinDate)
              throw new Error("Exit Date precedes Join Date.");
            if (
              Boolean(employee.transferDate) !==
              Boolean(employee.previousCostCenter)
            )
              throw new Error(
                "Transfers require both Transfer Date and Previous Cost Center.",
              );
            if (
              Boolean(employee.travelFrom) !== Boolean(employee.travelTo) ||
              (employee.travelFrom &&
                employee.travelTo &&
                employee.travelTo < employee.travelFrom)
            )
              throw new Error("Travel dates must form a valid range.");
            if (
              employee.travelFrom &&
              !/^[A-Z]{2}$/.test(employee.usState ?? "")
            )
              throw new Error("B1 travel requires a two-letter US State.");
            if (name === "Departures" && !employee.exitDate)
              throw new Error("Departures require Exit Date.");
            employees.set(code, employee);
            changed.add(code);
          } catch (error) {
            errors.push(
              `${name}, row ${rowNumber}: ${error instanceof Error ? error.message : "Invalid data"}`,
            );
          }
        });
      }
      if (errors.length) throw new BadRequestException(errors.slice(0, 30));
      if (!records)
        throw new BadRequestException(
          "The workbook contains no employee records.",
        );
      const masters = await tx.masterRecord.findMany({
        where: { organizationId: user.organizationId },
      });
      for (const code of changed) {
        const employee = employees.get(code)!;
        for (const [kind, value] of [
          ["business-group", employee.businessGroup],
          ["cost-center", employee.costCenter],
          ...(employee.previousCostCenter
            ? [["cost-center", employee.previousCostCenter]]
            : []),
        ])
          if (!masters.some((m) => m.kind === kind && m.code === value))
            throw new BadRequestException(
              `${code}: ${kind} ${value} is not in master data.`,
            );
        const rates = masters.filter(
          (m) =>
            m.kind === "rate" &&
            employee.annualSalary >= Number((m.data as MasterData).salaryMin) &&
            employee.annualSalary <= Number((m.data as MasterData).salaryMax),
        );
        if (employee.annualSalary > 0 && rates.length !== 1)
          throw new BadRequestException(
            `${code}: salary must match exactly one configured billing grade.`,
          );
        if (rates[0]) employee.billingGrade = rates[0].code;
        if (!employee.billingGrade)
          throw new BadRequestException(
            `${code}: provide Billing Grade or a salary with a configured rate band.`,
          );
        const {
          code: employeeCode,
          name,
          email,
          businessGroup,
          grade,
          billingGrade,
          costCenter,
          joinDate,
          exitDate,
          transferDate,
          previousCostCenter,
          annualSalary,
          travelFrom,
          travelTo,
          usState,
          category,
        } = employee;
        const values = {
          code: employeeCode,
          name,
          email,
          businessGroup,
          grade,
          billingGrade,
          costCenter,
          joinDate,
          exitDate,
          transferDate,
          previousCostCenter,
          annualSalary,
          travelFrom,
          travelTo,
          usState,
          category,
        };
        await tx.workforceEmployee.upsert({
          where: {
            organizationId_code: { organizationId: user.organizationId, code },
          },
          create: { organizationId: user.organizationId, ...values },
          update: values,
        });
      }
      const cycle = masters.find(
        (m) => m.kind === "cycle" && m.code === body.period,
      )?.data as MasterData | undefined;
      const rows = [...employees.values()].flatMap((employee) =>
        employeeRows(
          employee,
          body.period,
          masters.find(
            (m) =>
              m.kind === "project" &&
              (m.data as MasterData).businessGroup === employee.businessGroup,
          )?.code ?? "",
          cycle,
        ),
      );
      let generated = 0;
      let locked = 0;
      for (const center of masters.filter((m) => m.kind === "cost-center")) {
        const current = await tx.businessTimesheet.findUnique({
          where: {
            organizationId_period_costCenter: {
              organizationId: user.organizationId,
              period: body.period,
              costCenter: center.code,
            },
          },
        });
        if (current && !["DRAFT", "REJECTED"].includes(current.status)) {
          locked++;
          continue;
        }
        const manager = await tx.user.findFirst({
          where: {
            organizationId: user.organizationId,
            role: "MANAGER",
            active: true,
            costCenters: { has: center.code },
          },
        });
        if (!manager) continue;
        const centerRows = rows.filter((row) => row.costCenter === center.code);
        const previous = current ? sheetRows(current.rows) : [];
        const merged = centerRows.map((row) => {
          const old = previous.find((item) => item.id === row.id);
          return old && current!.version > 1
            ? {
                ...row,
                hours: old.hours,
                projectCode: old.projectCode,
                remarks: old.remarks,
              }
            : row;
        });
        merged.push(
          ...previous.filter(
            (row) =>
              row.shared &&
              !merged.some((item) => item.employeeCode === row.employeeCode),
          ),
        );
        if (!merged.length && !current) continue;
        const values = {
          rows: jsonData(merged),
          businessGroup: String((center.data as MasterData).businessGroup),
          managerUserId: manager.id,
        };
        await tx.businessTimesheet.upsert({
          where: {
            organizationId_period_costCenter: {
              organizationId: user.organizationId,
              period: body.period,
              costCenter: center.code,
            },
          },
          create: {
            organizationId: user.organizationId,
            period: body.period,
            costCenter: center.code,
            ...values,
          },
          update: { ...values, version: { increment: 1 } },
        });
        generated++;
      }
      const summary = {
        records,
        newEmployees: [...changed].filter(
          (code) => !existing.some((e) => e.code === code),
        ).length,
        transfers: [...changed].filter(
          (code) => employees.get(code)?.transferDate,
        ).length,
        departures: [...changed].filter((code) => employees.get(code)?.exitDate)
          .length,
        generated,
        locked,
      };
      await tx.hRImport.create({
        data: {
          organizationId: user.organizationId,
          period: body.period,
          actorUserId: user.id,
          filename: body.filename,
          summary,
        },
      });
      await this.portal.audit(
        tx,
        user,
        "HR_IMPORT",
        body.period,
        JSON.stringify(summary),
      );
      const managers = await tx.user.findMany({
        where: {
          organizationId: user.organizationId,
          active: true,
          role: "MANAGER",
        },
      });
      await this.portal.notify(
        tx,
        managers.map((m) => m.id),
        "HR data imported",
        `${body.period}: timesheets are ready for review.`,
      );
      return summary;
    });
  }
  async importProjects(
    actor: RequestActor,
    body: { filename: string; base64: string },
  ) {
    await this.portal.run(actor, ["FINANCE"], () => Promise.resolve(true));
    const workbook = await this.workbook(body.filename, body.base64);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount > 2001)
      throw new BadRequestException(
        "Provide a worksheet with at most 2,000 projects.",
      );
    const rows: { code: string; data: MasterData }[] = [];
    sheet.eachRow((row, index) => {
      if (index > 1)
        rows.push({
          code: row.getCell(1).text.trim(),
          data: {
            description: row.getCell(2).text.trim(),
            businessGroup: row.getCell(3).text.trim(),
          },
        });
    });
    for (const row of rows) {
      textField(row.code, "Project Code");
      validateMaster("project", row.data);
    }
    if (new Set(rows.map((r) => r.code)).size !== rows.length)
      throw new BadRequestException("Duplicate project codes in workbook.");
    return this.portal.run(actor, ["FINANCE"], async (tx, user) => {
      for (const row of rows)
        await tx.masterRecord.upsert({
          where: {
            organizationId_kind_code: {
              organizationId: user.organizationId,
              kind: "project",
              code: row.code,
            },
          },
          create: {
            organizationId: user.organizationId,
            kind: "project",
            ...row,
            data: jsonData(row.data),
          },
          update: { data: jsonData(row.data) },
        });
      await this.portal.audit(
        tx,
        user,
        "PROJECTS_IMPORTED",
        body.filename,
        `${rows.length} projects imported.`,
      );
      return { records: rows.length };
    });
  }
  report(actor: RequestActor, query: Record<string, string>): Promise<ReportRow[]> {
    return this.portal.run(
      actor,
      ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
      async (tx, user) => {
        const kind = query.kind ?? "platform";
        if (
          ![
            "platform",
            "hours",
            "headcount",
            "travel",
            "parameters",
            "oracle",
          ].includes(kind)
        )
          throw new BadRequestException("Unknown report.");
        if (kind === "oracle" && user.role !== "FINANCE")
          throw new BadRequestException("Finance access is required.");
        const from = periodValue(query.from || query.period);
        const to = periodValue(query.to || query.period);
        if (from > to)
          throw new BadRequestException(
            "The start period must precede the end period.",
          );
        const masters = await tx.masterRecord.findMany({
          where: { organizationId: user.organizationId },
        });
        const employees = await tx.workforceEmployee.findMany({
          where: this.portal.scope(user),
        });
        const sheets = await tx.businessTimesheet.findMany({
          where: {
            ...this.portal.scope(user),
            period: { gte: from, lte: to },
            ...(kind === "oracle" ? { status: "APPROVED" } : {}),
          },
          orderBy: { period: "asc" },
        });
        const rows: ReportRow[] = [];
        for (const sheet of sheets)
          for (const row of sheetRows(sheet.rows)) {
            const group = masters.find(
              (m) =>
                m.kind === "business-group" && m.code === row.businessGroup,
            )?.data as MasterData | undefined;
            if (
              (query.businessGroup &&
                query.businessGroup !== row.businessGroup) ||
              (query.employeeCode && query.employeeCode !== row.employeeCode) ||
              (query.platform && query.platform !== group?.platform) ||
              (query.unit && query.unit !== group?.unit) ||
              (query.usState && query.usState !== row.usState)
            )
              continue;
            if (kind === "travel" && row.location !== "US") continue;
            if (
              kind === "hours" &&
              (query.hours === "below"
                ? row.hours >= row.expectedHours
                : query.hours === "above"
                  ? row.hours <= row.expectedHours
                  : row.hours === row.expectedHours)
            )
              continue;
            const employee = employees.find((e) => e.code === row.employeeCode);
            if (
              kind === "travel" &&
              ((query.dateFrom &&
                (employee?.travelTo ?? "") < query.dateFrom) ||
                (query.dateTo && (employee?.travelFrom ?? "") > query.dateTo))
            )
              continue;
            const center = masters.find(
              (m) => m.kind === "cost-center" && m.code === row.costCenter,
            )?.data as MasterData | undefined;
            if (
              kind === "oracle" &&
              (row.hours <= 0 ||
                !row.projectCode ||
                !row.employeeCode ||
                center?.backCharging !== true)
            )
              continue;
            const result: ReportRow = {
              Period: sheet.period,
              "Employee Code": row.employeeCode,
              Name: row.employeeName,
              "Business Group": row.businessGroup,
              Platform: String(group?.platform ?? ""),
              "Business Unit": String(group?.unit ?? ""),
              "Cost Center": row.costCenter,
              "Project Code": row.projectCode,
              "Billing Grade": row.billingGrade,
              Location: row.location,
              "US State": row.usState,
              "Expected Hours": row.expectedHours,
              Hours: row.hours,
              Variance: Math.round((row.hours - row.expectedHours) * 100) / 100,
              Remarks: row.remarks,
              Status: sheet.status,
            };
            if (kind === "travel")
              Object.assign(result, {
                "Travel From": employee?.travelFrom ?? "",
                "Travel To": employee?.travelTo ?? "",
                "Remaining Hours": sheetRows(sheet.rows)
                  .filter(
                    (r) =>
                      r.employeeCode === row.employeeCode &&
                      r.location !== "US",
                  )
                  .reduce((sum, r) => sum + r.hours, 0),
              });
            if (
              ["FINANCE", "DIRECTOR"].includes(user.role) &&
              query.revenue !== "false" &&
              ["platform", "parameters", "oracle"].includes(kind)
            ) {
              const rate = masters.find(
                (m) => m.kind === "rate" && m.code === row.billingGrade,
              )?.data as MasterData | undefined;
              const fx = masters.find(
                (m) => m.kind === "fx" && m.code === sheet.period,
              )?.data as MasterData | undefined;
              if (kind === "oracle" && (!rate || !fx || Number(fx.usd) <= 0))
                throw new BadRequestException(
                  `Configure the billing rate and FX rate for ${row.billingGrade} / ${sheet.period} before export.`,
                );
              Object.assign(result, {
                "Rate INR": rate ? Number(rate.rate) : "Not configured",
                "Revenue INR": rate
                  ? Math.round(row.hours * Number(rate.rate) * 100) / 100
                  : "Not configured",
                "FX INR/USD": fx ? Number(fx.usd) : "Not configured",
                "Revenue USD":
                  rate && fx && Number(fx.usd) > 0
                    ? Math.round(
                        ((row.hours * Number(rate.rate)) / Number(fx.usd)) *
                          100,
                      ) / 100
                    : "Not configured",
              });
            }
            if (kind === "oracle")
              Object.assign(result, {
                "Source Timesheet": sheet.id,
                "Source Version": sheet.version,
              });
            rows.push(result);
          }
        if (kind === "headcount") {
          return [...new Set(employees.map((e) => e.businessGroup))]
            .filter(
              (group) => !query.businessGroup || query.businessGroup === group,
            )
            .map((group) => {
              const members = employees.filter(
                (e) => e.businessGroup === group,
              );
              const end = `${to}-31`;
              const start = `${from}-01`;
              return {
                "Business Group": group,
                Active: members.filter(
                  (e) => e.joinDate <= end && (!e.exitDate || e.exitDate > end),
                ).length,
                "New Joiners": members.filter(
                  (e) => e.joinDate >= start && e.joinDate <= end,
                ).length,
                Departures: members.filter(
                  (e) => e.exitDate && e.exitDate >= start && e.exitDate <= end,
                ).length,
                Transfers: members.filter(
                  (e) =>
                    e.transferDate &&
                    e.transferDate >= start &&
                    e.transferDate <= end,
                ).length,
                "B1 Travel": members.filter(
                  (e) =>
                    e.travelFrom &&
                    e.travelTo &&
                    e.travelFrom <= end &&
                    e.travelTo >= start,
                ).length,
                Hours: rows
                  .filter((r) => r["Business Group"] === group)
                  .reduce((sum, r) => sum + Number(r.Hours), 0),
              };
            });
        }
        return rows;
      },
    );
  }
  async exportOracle(actor: RequestActor, period: string) {
    periodValue(period);
    const rows = await this.report(actor, { kind: "oracle", period });
    if (!rows.length)
      throw new BadRequestException(
        "No approved, back-charging rows with hours are ready to export.",
      );
    // Export is a downloadable staging workbook, not an Oracle API upload.
    const buffer = await this.download(rows, "Oracle staging");
    await this.portal.run(actor, ["FINANCE"], async (tx, user) => {
      const included = [
        ...new Map(
          rows.map((row) => [
            String(row["Source Timesheet"]),
            {
              id: String(row["Source Timesheet"]),
              version: Number(row["Source Version"]),
            },
          ]),
        ).values(),
      ];
      for (const sheet of included) {
        const updated = await tx.businessTimesheet.updateMany({
          where: {
            id: sheet.id,
            organizationId: user.organizationId,
            version: sheet.version,
            status: "APPROVED",
          },
          data: {
            exportedAt: new Date().toISOString(),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1)
          throw new ConflictException(
            "An approved timesheet changed during export. Generate the workbook again.",
          );
      }
      await this.portal.audit(
        tx,
        user,
        "ORACLE_STAGING_EXPORTED",
        period,
        `${rows.length} approved rows exported to a staging workbook.`,
      );
    });
    return buffer;
  }
}
