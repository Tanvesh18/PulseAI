import { Injectable } from "@nestjs/common";
import type { RequestActor } from "../auth/request-actor";
import { EmployeeRepository } from "../data/employee.repository";
import type { UpdateTimesheetDto } from "./dto/update-timesheet.dto";
import { EmployeeWorkflow } from "./employee.workflow";

@Injectable()
export class EmployeeService {
  constructor(private readonly repository: EmployeeRepository) {}

  getProfile(actor: RequestActor) {
    return this.repository.run(actor, false, (data) =>
      new EmployeeWorkflow(data).getProfile(actor),
    );
  }

  getCurrentTimesheet(actor: RequestActor) {
    return this.repository.run(actor, false, (data) =>
      new EmployeeWorkflow(data).getCurrentTimesheet(actor),
    );
  }

  listTimesheets(actor: RequestActor) {
    return this.repository.run(actor, false, (data) =>
      new EmployeeWorkflow(data).listTimesheets(actor),
    );
  }

  getTimesheet(actor: RequestActor, timesheetId: string) {
    return this.repository.run(actor, false, (data) =>
      new EmployeeWorkflow(data).getTimesheet(actor, timesheetId),
    );
  }

  updateTimesheet(actor: RequestActor, timesheetId: string, dto: UpdateTimesheetDto) {
    return this.repository.run(actor, true, (data) =>
      new EmployeeWorkflow(data).updateTimesheet(actor, timesheetId, dto),
    );
  }

  submitTimesheet(actor: RequestActor, timesheetId: string, expectedVersion: number) {
    return this.repository.run(actor, true, (data) =>
      new EmployeeWorkflow(data).submitTimesheet(actor, timesheetId, expectedVersion),
    );
  }

  listNotifications(actor: RequestActor) {
    return this.repository.run(actor, true, (data) =>
      new EmployeeWorkflow(data).listNotifications(actor),
    );
  }

  markNotificationRead(actor: RequestActor, notificationId: string) {
    return this.repository.run(actor, true, (data) =>
      new EmployeeWorkflow(data).markNotificationRead(actor, notificationId),
    );
  }

  getAuditEvents(actor: RequestActor) {
    return this.repository.run(actor, false, (data) =>
      new EmployeeWorkflow(data).getAuditEvents(actor),
    );
  }

  askAssistant(actor: RequestActor, question: string) {
    return this.repository.run(actor, false, (data) =>
      new EmployeeWorkflow(data).askAssistant(actor, question),
    );
  }
}
