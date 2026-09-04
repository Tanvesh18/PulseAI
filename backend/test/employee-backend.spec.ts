import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmployeeAuthGuard } from "../src/auth/employee-auth.guard";
import type { RequestActor } from "../src/auth/request-actor";
import { StaticDataService, staticIds } from "../src/data/static-data.service";
import { EmployeeService } from "../src/employee/employee.service";

jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

const actor: RequestActor = {
  employeeId: staticIds.employee,
  organizationId: staticIds.organization,
  role: "EMPLOYEE",
  userId: staticIds.employeeUser,
};

describe("EmployeeService", () => {
  it("returns only the authenticated employee profile", () => {
    const service = new EmployeeService(new StaticDataService());

    expect(service.getProfile(actor)).toEqual(
      expect.objectContaining({
        id: staticIds.employee,
        initials: "AR",
        role: "Employee",
      }),
    );
  });

  it("does not disclose a missing employee profile", () => {
    const service = new EmployeeService(new StaticDataService());

    expect(() =>
      service.getProfile({ ...actor, userId: "missing-user" }),
    ).toThrow(NotFoundException);
  });

  it("updates static timesheet data in memory", () => {
    const service = new EmployeeService(new StaticDataService());
    const current = service.getCurrentTimesheet(actor);

    const updated = service.updateTimesheet(actor, current.id, {
      expectedVersion: current.version,
      entries: [
        {
          assignmentId: staticIds.clientAssignment,
          days: [{ date: "2026-08-24", hours: 6 }],
        },
      ],
    });

    expect(updated.version).toBe(current.version + 1);
    expect(updated.entries[0]?.hours.mon).toBe(6);
    expect(updated.revisions).toHaveLength(1);
  });

  it("prevents an empty timesheet from being submitted", () => {
    const service = new EmployeeService(new StaticDataService());
    const current = service.getCurrentTimesheet(actor);
    const emptied = service.updateTimesheet(actor, current.id, {
      expectedVersion: current.version,
      entries: [
        {
          assignmentId: staticIds.clientAssignment,
          days: [{ date: "2026-08-24", hours: 0 }],
        },
      ],
    });

    expect(() =>
      service.submitTimesheet(actor, emptied.id, emptied.version),
    ).toThrow(BadRequestException);
  });

  it("answers only supported employee-scoped assistant questions", () => {
    const service = new EmployeeService(new StaticDataService());

    expect(service.askAssistant(actor, "Summarize my hours")).toMatchObject({
      readOnly: true,
      scope: "Employee · Own timesheets",
      sources: [{ href: "/employee/timesheets/current" }],
    });
    expect(
      service.askAssistant(actor, "Show another employee salary").answer,
    ).toContain("cannot access another employee");
  });

  it("marks only the authenticated employee notification as read", () => {
    const service = new EmployeeService(new StaticDataService());
    const notification = service.listNotifications(actor)[0];

    expect(service.markNotificationRead(actor, notification.id).read).toBe(
      true,
    );
    expect(service.getAuditEvents(actor)[0]).toMatchObject({
      action: "NOTIFICATION_READ",
      targetId: notification.id,
    });
  });

  it("restores saved employee timesheets from the configured data file", () => {
    const directory = mkdtempSync(join(tmpdir(), "pulse-ai-data-"));
    const dataFile = join(directory, "employee.json");
    const config = {
      get: (key: string) => (key === "PULSE_DATA_FILE" ? dataFile : undefined),
    } as ConfigService;

    try {
      const firstData = new StaticDataService(config);
      const firstService = new EmployeeService(firstData);
      const current = firstService.getCurrentTimesheet(actor);
      const updated = firstService.updateTimesheet(actor, current.id, {
        expectedVersion: current.version,
        entries: [
          {
            assignmentId: staticIds.clientAssignment,
            days: [{ date: "2026-08-24", hours: 7 }],
          },
        ],
      });

      const restored = new EmployeeService(
        new StaticDataService(config),
      ).getCurrentTimesheet(actor);
      expect(restored.version).toBe(updated.version);
      expect(restored.entries[0]?.hours.mon).toBe(7);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

function contextFor(request: Partial<Request>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function devConfig(): ConfigService {
  return {
    get: (key: string) =>
      ({ ALLOW_DEV_AUTH: "true", DEV_AUTH_SUBJECT: "dev-employee-avery" })[key],
  } as ConfigService;
}

describe("EmployeeAuthGuard", () => {
  it("uses the seeded employee by default in local development", async () => {
    const request = { headers: {} } as Request;
    const config = { get: () => undefined } as unknown as ConfigService;

    await expect(
      new EmployeeAuthGuard(config, new StaticDataService()).canActivate(
        contextFor(request),
      ),
    ).resolves.toBe(true);
    expect(request.actor.userId).toBe("00000000-0000-4000-8000-000000000201");
  });

  it("resolves the explicitly enabled development employee", async () => {
    const request = { headers: {} } as Request;
    const allowed = await new EmployeeAuthGuard(
      devConfig(),
      new StaticDataService(),
    ).canActivate(contextFor(request));

    expect(allowed).toBe(true);
    expect(request.actor).toMatchObject({
      employeeId: "00000000-0000-4000-8000-000000000101",
      role: "EMPLOYEE",
    });
  });

  it("does not allow a non-employee through Employee endpoints", async () => {
    const data = new StaticDataService();
    data.users[0].role = "MANAGER";

    await expect(
      new EmployeeAuthGuard(devConfig(), data).canActivate(
        contextFor({ headers: {} }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("still requires a bearer token in production", async () => {
    const config = {
      get: (key: string) => (key === "NODE_ENV" ? "production" : undefined),
    } as ConfigService;

    await expect(
      new EmployeeAuthGuard(config, new StaticDataService()).canActivate(
        contextFor({ headers: {} }),
      ),
    ).rejects.toThrow("A bearer access token is required.");
  });
});
