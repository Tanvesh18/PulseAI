import { NotFoundException } from "@nestjs/common";
import type { RequestActor } from "../auth/request-actor";
import {
  StaticDataService,
  staticIds,
} from "../data/static-data.service";
import { EmployeeService } from "./employee.service";

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
  });
});
