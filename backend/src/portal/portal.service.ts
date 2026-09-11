import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { Prisma, User } from "../generated/prisma/client";
import { PrismaService } from "../data/prisma.service";
import type { RequestActor } from "../auth/request-actor";
import type { MasterData, MonthlyRow, PortalRole } from "./portal.types";
import {
  cycleDates,
  periodValue,
  textField,
  validateMaster,
  validateRows,
} from "./portal.rules";

type Tx = Prisma.TransactionClient;
export const jsonData = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const sheetRows = (value: unknown) => value as MonthlyRow[];

@Injectable()
export class PortalService {
  constructor(
    readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async run<T>(
    actor: RequestActor,
    roles: string[],
    operation: (tx: Tx, user: User) => Promise<T> | T,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${actor.organizationId}))) AS portal_lock`;
        const user = await tx.user.findUnique({ where: { id: actor.userId } });
        if (
          !user?.active ||
          user.organizationId !== actor.organizationId ||
          user.role !== actor.role
        )
          throw new UnauthorizedException(
            "Your access has changed. Sign in again.",
          );
        if (!roles.includes(user.role))
          throw new ForbiddenException("Your role cannot perform this action.");
        return operation(tx, user);
      },
      { maxWait: 15000, timeout: 60000 },
    );
  }
  scope(user: User) {
    return {
      organizationId: user.organizationId,
      ...(user.role === "MANAGER"
        ? { costCenter: { in: user.costCenters } }
        : {}),
    };
  }
  async audit(
    tx: Tx,
    user: User,
    action: string,
    targetId: string,
    summary: string,
  ) {
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: user.id,
        action,
        targetId,
        summary,
        createdAt: new Date().toISOString(),
      },
    });
  }
  async notify(tx: Tx, userIds: string[], title: string, message: string) {
    if (userIds.length)
      await tx.notification.createMany({
        data: userIds.map((userId) => ({
          id: randomUUID(),
          userId,
          category: "timesheet",
          createdAt: new Date().toISOString(),
          href: "/portal/approvals",
          message,
          title,
          read: false,
        })),
      });
  }
  session(actor: RequestActor) {
    return this.run(
      actor,
      ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
      (_tx, user) => ({
        id: user.id,
        name: user.displayName,
        role: user.role,
        costCenters: user.costCenters,
        demoAuth:
          this.config.get<string>("NODE_ENV") !== "production" &&
          this.config.get<string>("ALLOW_DEV_AUTH") !== "false",
      }),
    );
  }
  overview(actor: RequestActor, period: string) {
    periodValue(period);
    return this.run(
      actor,
      ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
      async (tx, user) => {
        const sheets = await tx.businessTimesheet.findMany({
          where: { ...this.scope(user), period },
          orderBy: { costCenter: "asc" },
        });
        const employees = await tx.workforceEmployee.count({
          where: this.scope(user),
        });
        const imports = await tx.hRImport.findMany({
          where: { organizationId: user.organizationId, period },
          orderBy: { createdAt: "desc" },
          take: 5,
        });
        const masters = await tx.masterRecord.findMany({
          where: {
            organizationId: user.organizationId,
            kind: "cycle",
            code: period,
          },
        });
        const cycle = cycleDates(
          period,
          masters[0]?.data as MasterData | undefined,
        );
        return {
          sheets,
          employees,
          imports,
          cycle,
          shortHours: sheets
            .flatMap((sheet) => sheetRows(sheet.rows))
            .filter((row) => row.hours < row.expectedHours).length,
        };
      },
    );
  }
  listSheets(actor: RequestActor, period: string) {
    periodValue(period);
    return this.run(
      actor,
      ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
      (tx, user) =>
        tx.businessTimesheet.findMany({
          where: { ...this.scope(user), period },
          orderBy: { costCenter: "asc" },
        }),
    );
  }
  async ownedSheet(tx: Tx, user: User, id: string) {
    const sheet = await tx.businessTimesheet.findFirst({
      where: { id, ...this.scope(user) },
    });
    if (!sheet)
      throw new NotFoundException("Timesheet not found in your scope.");
    return sheet;
  }
  editable(status: string, role: string) {
    if (
      !["DRAFT", "REJECTED"].includes(status) &&
      !(
        role === "FINANCE" &&
        ["SUBMITTED", "RESUBMITTED", "APPROVED"].includes(status)
      )
    )
      throw new ConflictException(
        "This timesheet is locked. Return it for correction first.",
      );
  }
  version(actual: number, expected: unknown) {
    if (!Number.isInteger(expected) || actual !== expected)
      throw new ConflictException(
        "This timesheet changed. Refresh before trying again.",
      );
  }
  updateSheet(
    actor: RequestActor,
    id: string,
    body: { expectedVersion: number; rows: MonthlyRow[] },
  ) {
    return this.run(actor, ["MANAGER", "FINANCE"], async (tx, user) => {
      const sheet = await this.ownedSheet(tx, user, id);
      this.version(sheet.version, body.expectedVersion);
      this.editable(sheet.status, user.role);
      if (sheet.exportedAt)
        throw new ConflictException("Exported timesheets are locked.");
      const masters = await tx.masterRecord.findMany({
        where: { organizationId: user.organizationId },
      });
      validateRows(
        body.rows,
        sheetRows(sheet.rows),
        user.role === "FINANCE",
        false,
        new Set(masters.filter((m) => m.kind === "project").map((m) => m.code)),
        new Set(
          masters
            .filter(
              (m) =>
                m.kind === "cost-center" &&
                (user.role !== "MANAGER" || user.costCenters.includes(m.code)),
            )
            .map((m) => m.code),
        ),
      );
      // Finance changes after review require a fresh approval.
      const status = ["APPROVED", "SUBMITTED", "RESUBMITTED"].includes(
        sheet.status,
      )
        ? "SUBMITTED"
        : sheet.status;
      const updated = await tx.businessTimesheet.update({
        where: { id },
        data: {
          rows: jsonData(body.rows),
          version: { increment: 1 },
          status,
          ...(status === "SUBMITTED"
            ? { reviewedAt: null, reviewerUserId: null }
            : {}),
        },
      });
      await this.audit(
        tx,
        user,
        "TEAM_TIMESHEET_UPDATED",
        id,
        `Updated ${sheet.period} / ${sheet.costCenter}. Previous rows: ${JSON.stringify(sheet.rows)}`,
      );
      return updated;
    });
  }
  action(
    actor: RequestActor,
    id: string,
    body: { action: string; expectedVersion: number; reason?: string },
  ) {
    const roles =
      body.action === "submit"
        ? ["MANAGER", "FINANCE"]
        : ["DIRECTOR", "FINANCE"];
    if (!["submit", "approve", "return"].includes(body.action))
      throw new BadRequestException("Unknown workflow action.");
    return this.run(actor, roles, async (tx, user) => {
      const sheet = await this.ownedSheet(tx, user, id);
      this.version(sheet.version, body.expectedVersion);
      if (sheet.exportedAt)
        throw new ConflictException("Exported timesheets are locked.");
      let status: "SUBMITTED" | "RESUBMITTED" | "APPROVED" | "REJECTED";
      if (body.action === "submit") {
        if (!["DRAFT", "REJECTED"].includes(sheet.status))
          throw new ConflictException(
            "This timesheet has already been submitted.",
          );
        const masters = await tx.masterRecord.findMany({
          where: { organizationId: user.organizationId },
        });
        validateRows(
          sheetRows(sheet.rows),
          sheetRows(sheet.rows),
          true,
          true,
          new Set(
            masters.filter((m) => m.kind === "project").map((m) => m.code),
          ),
          new Set(
            masters.filter((m) => m.kind === "cost-center").map((m) => m.code),
          ),
        );
        status = sheet.status === "REJECTED" ? "RESUBMITTED" : "SUBMITTED";
      } else {
        if (!["SUBMITTED", "RESUBMITTED"].includes(sheet.status))
          throw new ConflictException(
            "Only submitted timesheets can be reviewed.",
          );
        if (sheet.managerUserId === user.id)
          throw new ForbiddenException(
            "You cannot approve your own submission.",
          );
        if (body.action === "return")
          textField(body.reason, "Reason for return");
        status = body.action === "approve" ? "APPROVED" : "REJECTED";
      }
      const updated = await tx.businessTimesheet.update({
        where: { id },
        data: {
          status,
          version: { increment: 1 },
          ...(body.action === "submit"
            ? { submittedAt: new Date().toISOString(), returnReason: null }
            : {
                reviewedAt: new Date().toISOString(),
                reviewerUserId: user.id,
                returnReason:
                  body.action === "return" ? body.reason!.trim() : null,
              }),
        },
      });
      await this.audit(
        tx,
        user,
        `TEAM_TIMESHEET_${status}`,
        id,
        `${sheet.period} / ${sheet.costCenter}: ${status}. ${body.reason ?? ""}`,
      );
      const reviewers =
        body.action === "submit"
          ? await tx.user.findMany({
              where: {
                organizationId: user.organizationId,
                active: true,
                role: "DIRECTOR",
              },
            })
          : [{ id: sheet.managerUserId }];
      await this.notify(
        tx,
        reviewers.map((item) => item.id),
        `Timesheet ${status.toLowerCase()}`,
        `${sheet.period} / ${sheet.costCenter}. ${body.reason ?? ""}`,
      );
      return updated;
    });
  }
  shared(
    actor: RequestActor,
    id: string,
    body: {
      expectedVersion: number;
      employeeCode?: string;
      projectCode?: string;
      costCenter?: string;
      hours?: number;
      removeId?: string;
    },
  ) {
    return this.run(actor, ["MANAGER", "FINANCE"], async (tx, user) => {
      const sheet = await this.ownedSheet(tx, user, id);
      this.version(sheet.version, body.expectedVersion);
      if (!["DRAFT", "REJECTED"].includes(sheet.status))
        throw new ConflictException(
          "Shared resources can only change on editable drafts.",
        );
      const rows = sheetRows(sheet.rows);
      if (body.removeId) {
        const row = rows.find((row) => row.id === body.removeId);
        if (!row?.shared)
          throw new ForbiddenException("Only shared resources can be removed.");
        rows.splice(rows.indexOf(row), 1);
      } else {
        const employee = await tx.workforceEmployee.findUnique({
          where: {
            organizationId_code: {
              organizationId: user.organizationId,
              code: textField(body.employeeCode, "Employee code"),
            },
          },
        });
        if (!employee)
          throw new NotFoundException(
            "Employee code was not found in the HR master.",
          );
        if (rows.some((row) => row.employeeCode === employee.code))
          throw new ConflictException(
            "This employee is already on the timesheet.",
          );
        const project = await tx.masterRecord.findFirst({
          where: {
            organizationId: user.organizationId,
            kind: "project",
            code: textField(body.projectCode, "Project code"),
          },
        });
        if (!project || body.costCenter !== sheet.costCenter)
          throw new BadRequestException(
            "Select a valid project and this timesheet's cost center.",
          );
        if (
          typeof body.hours !== "number" ||
          !Number.isFinite(body.hours) ||
          body.hours <= 0 ||
          body.hours > 744
        )
          throw new BadRequestException(
            "Shared hours must be greater than zero and at most 744.",
          );
        rows.push({
          id: randomUUID(),
          employeeCode: employee.code,
          employeeName: employee.name,
          businessGroup: employee.businessGroup,
          grade: employee.grade,
          billingGrade: employee.billingGrade,
          costCenter: sheet.costCenter,
          projectCode: project.code,
          location: "Non-US",
          usState: "",
          hours: body.hours,
          expectedHours: body.hours,
          remarks: "Shared resource",
          shared: true,
        });
      }
      const updated = await tx.businessTimesheet.update({
        where: { id },
        data: { rows: jsonData(rows), version: { increment: 1 } },
      });
      await this.audit(
        tx,
        user,
        body.removeId ? "SHARED_RESOURCE_REMOVED" : "SHARED_RESOURCE_ADDED",
        id,
        `Shared resource updated in ${sheet.period} / ${sheet.costCenter}.`,
      );
      return updated;
    });
  }
  masters(actor: RequestActor) {
    return this.run(
      actor,
      ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
      (tx, user) =>
        tx.masterRecord.findMany({
          where: {
            organizationId: user.organizationId,
            ...(user.role === "MANAGER"
              ? { kind: { notIn: ["rate", "fx"] } }
              : {}),
          },
          orderBy: [{ kind: "asc" }, { code: "asc" }],
        }),
    );
  }
  saveMaster(
    actor: RequestActor,
    body: { kind: string; code: string; data: MasterData },
  ) {
    textField(body.code, "Code");
    validateMaster(body.kind, body.data);
    if (["fx", "cycle"].includes(body.kind)) periodValue(body.code);
    return this.run(actor, ["FINANCE"], async (tx, user) => {
      const saved = await tx.masterRecord.upsert({
        where: {
          organizationId_kind_code: {
            organizationId: user.organizationId,
            kind: body.kind,
            code: body.code,
          },
        },
        create: {
          organizationId: user.organizationId,
          kind: body.kind,
          code: body.code,
          data: jsonData(body.data),
        },
        update: { data: jsonData(body.data) },
      });
      await this.audit(
        tx,
        user,
        "MASTER_DATA_UPDATED",
        saved.id,
        `${body.kind}: ${body.code}.`,
      );
      return saved;
    });
  }
  employees(actor: RequestActor) {
    return this.run(
      actor,
      ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
      async (tx, user) => {
        const employees = await tx.workforceEmployee.findMany({
          where: { organizationId: user.organizationId },
          orderBy: { code: "asc" },
        });
        return employees.map((employee) => ({
          code: employee.code,
          name: employee.name,
          businessGroup: employee.businessGroup,
          grade: employee.grade,
          billingGrade: employee.billingGrade,
          costCenter: employee.costCenter,
        }));
      },
    );
  }
  access(actor: RequestActor) {
    return this.run(actor, ["FINANCE"], (tx, user) =>
      tx.user.findMany({
        where: { organizationId: user.organizationId },
        select: {
          id: true,
          displayName: true,
          email: true,
          role: true,
          active: true,
          costCenters: true,
          oidcSubject: true,
        },
        orderBy: { displayName: "asc" },
      }),
    );
  }
  grant(
    actor: RequestActor,
    body: {
      employeeCode: string;
      role: PortalRole;
      costCenters: string[];
      oidcSubject: string;
    },
  ) {
    if (!["MANAGER", "FINANCE", "HR", "DIRECTOR"].includes(body.role))
      throw new BadRequestException("Select a portal role.");
    textField(body.oidcSubject, "Identity provider subject");
    if (
      !Array.isArray(body.costCenters) ||
      body.costCenters.some((c) => typeof c !== "string") ||
      (body.role === "MANAGER" && !body.costCenters.length)
    )
      throw new BadRequestException("Managers require assigned cost centers.");
    return this.run(actor, ["FINANCE"], async (tx, user) => {
      const employee = await tx.workforceEmployee.findUnique({
        where: {
          organizationId_code: {
            organizationId: user.organizationId,
            code: textField(body.employeeCode, "Employee code"),
          },
        },
      });
      if (!employee)
        throw new NotFoundException("Employee not found in HR master.");
      const validCenters = await tx.masterRecord.findMany({
        where: { organizationId: user.organizationId, kind: "cost-center" },
      });
      if (
        body.costCenters.some(
          (code) => !validCenters.some((c) => c.code === code),
        )
      )
        throw new BadRequestException("Unknown cost center.");
      const existing = await tx.user.findFirst({
        where: {
          OR: [{ email: employee.email }, { oidcSubject: body.oidcSubject }],
        },
      });
      if (
        existing &&
        (existing.organizationId !== user.organizationId ||
          existing.email !== employee.email ||
          existing.oidcSubject !== body.oidcSubject)
      )
        throw new ConflictException(
          "Email or identity subject belongs to another account.",
        );
      if (existing?.id === user.id)
        throw new ForbiddenException("You cannot change your own access.");
      const values = {
        role: body.role,
        costCenters: body.costCenters,
        active: true,
      };
      const saved = existing
        ? await tx.user.update({ where: { id: existing.id }, data: values })
        : await tx.user.create({
            data: {
              ...values,
              id: randomUUID(),
              displayName: employee.name,
              email: employee.email,
              employeeId: employee.id,
              oidcSubject: body.oidcSubject,
              organizationId: user.organizationId,
            },
          });
      await this.audit(
        tx,
        user,
        "ACCESS_GRANTED",
        saved.id,
        `${employee.name}: ${body.role}.`,
      );
      return { id: saved.id };
    });
  }
  setAccess(actor: RequestActor, id: string, active: boolean) {
    if (typeof active !== "boolean")
      throw new BadRequestException("Active must be true or false.");
    return this.run(actor, ["FINANCE"], async (tx, user) => {
      if (user.id === id)
        throw new ForbiddenException("You cannot revoke your own access.");
      const target = await tx.user.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!target) throw new NotFoundException("User not found.");
      await tx.user.update({ where: { id }, data: { active } });
      await this.audit(
        tx,
        user,
        active ? "ACCESS_RESTORED" : "ACCESS_REVOKED",
        id,
        `${target.displayName}: ${active ? "active" : "revoked"}.`,
      );
      return { active };
    });
  }
  reminders(actor: RequestActor, body: { period: string; kind: string }) {
    periodValue(body.period);
    if (!["hr", "managers"].includes(body.kind))
      throw new BadRequestException("Choose HR or manager reminders.");
    return this.run(actor, ["FINANCE"], async (tx, user) => {
      const candidates = await tx.user.findMany({
        where: {
          organizationId: user.organizationId,
          active: true,
          role: body.kind === "hr" ? "HR" : "MANAGER",
        },
      });
      const sheets = await tx.businessTimesheet.findMany({
        where: { organizationId: user.organizationId, period: body.period },
      });
      const recipients =
        body.kind === "hr"
          ? candidates
          : candidates.filter((manager) =>
              manager.costCenters.some(
                (center) =>
                  !sheets.some(
                    (sheet) =>
                      sheet.costCenter === center &&
                      ["SUBMITTED", "RESUBMITTED", "APPROVED"].includes(
                        sheet.status,
                      ),
                  ),
              ),
            );
      await this.notify(
        tx,
        recipients.map((person) => person.id),
        body.kind === "hr"
          ? "Employee workbook requested"
          : "Timesheet submission reminder",
        `${body.period}: ${body.kind === "hr" ? "please upload the monthly HR workbook." : "please complete and submit your team's timesheets."}`,
      );
      await this.audit(
        tx,
        user,
        "REMINDERS_SENT",
        body.period,
        `${recipients.length} ${body.kind} reminders sent in the portal.`,
      );
      return { recipients: recipients.length };
    });
  }
  notifications(actor: RequestActor) {
    return this.run(
      actor,
      ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
      (tx, user) =>
        tx.notification.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
    );
  }
  readNotification(actor: RequestActor, id: string) {
    return this.run(
      actor,
      ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
      async (tx, user) => {
        await tx.notification.updateMany({
          where: { id, userId: user.id },
          data: { read: true },
        });
        return { read: true };
      },
    );
  }
  auditEvents(actor: RequestActor) {
    return this.run(
      actor,
      ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
      async (tx, user) => {
        const users =
          user.role === "MANAGER"
            ? [user]
            : await tx.user.findMany({
                where: { organizationId: user.organizationId },
              });
        return tx.auditEvent.findMany({
          where: { actorUserId: { in: users.map((item) => item.id) } },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
      },
    );
  }
}
