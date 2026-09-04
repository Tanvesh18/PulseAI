import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { EmployeeAuthGuard } from "../auth/employee-auth.guard";
import { SubmitTimesheetDto } from "./dto/submit-timesheet.dto";
import { UpdateTimesheetDto } from "./dto/update-timesheet.dto";
import { AskAssistantDto } from "./dto/ask-assistant.dto";
import { EmployeeService } from "./employee.service";

@Controller("employee")
@UseGuards(EmployeeAuthGuard)
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get("me")
  getProfile(@Req() request: Request) {
    return this.employeeService.getProfile(request.actor);
  }

  @Get("timesheets/current")
  getCurrentTimesheet(@Req() request: Request) {
    return this.employeeService.getCurrentTimesheet(request.actor);
  }

  @Get("timesheets")
  listTimesheets(@Req() request: Request) {
    return this.employeeService.listTimesheets(request.actor);
  }

  @Get("timesheets/:timesheetId")
  getTimesheet(
    @Req() request: Request,
    @Param("timesheetId") timesheetId: string,
  ) {
    return this.employeeService.getTimesheet(request.actor, timesheetId);
  }

  @Patch("timesheets/:timesheetId")
  updateTimesheet(
    @Req() request: Request,
    @Param("timesheetId") timesheetId: string,
    @Body() dto: UpdateTimesheetDto,
  ) {
    return this.employeeService.updateTimesheet(
      request.actor,
      timesheetId,
      dto,
    );
  }

  @Post("timesheets/:timesheetId/submit")
  submitTimesheet(
    @Req() request: Request,
    @Param("timesheetId") timesheetId: string,
    @Body() dto: SubmitTimesheetDto,
  ) {
    return this.employeeService.submitTimesheet(
      request.actor,
      timesheetId,
      dto.expectedVersion,
    );
  }

  @Get("notifications")
  listNotifications(@Req() request: Request) {
    return this.employeeService.listNotifications(request.actor);
  }

  @Patch("notifications/:notificationId/read")
  markNotificationRead(
    @Req() request: Request,
    @Param("notificationId") notificationId: string,
  ) {
    return this.employeeService.markNotificationRead(
      request.actor,
      notificationId,
    );
  }

  @Get("audit-events")
  getAuditEvents(@Req() request: Request) {
    return this.employeeService.getAuditEvents(request.actor);
  }

  @Post("assistant/query")
  askAssistant(@Req() request: Request, @Body() dto: AskAssistantDto) {
    return this.employeeService.askAssistant(request.actor, dto.question);
  }
}
