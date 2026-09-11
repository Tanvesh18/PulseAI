import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalService } from "./portal.service";
import { PortalWorkbookService } from "./portal-workbook.service";

@Controller("portal")
@UseGuards(PortalAuthGuard)
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly workbooks: PortalWorkbookService,
  ) {}
  @Get("session") session(@Req() req: Request) {
    return this.portal.session(req.actor);
  }
  @Get("overview") overview(
    @Req() req: Request,
    @Query("period") period: string,
  ) {
    return this.portal.overview(req.actor, period);
  }
  @Get("timesheets") sheets(
    @Req() req: Request,
    @Query("period") period: string,
  ) {
    return this.portal.listSheets(req.actor, period);
  }
  @Patch("timesheets/:id") update(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: Parameters<PortalService["updateSheet"]>[2],
  ) {
    return this.portal.updateSheet(req.actor, id, body);
  }
  @Post("timesheets/:id/action") action(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: Parameters<PortalService["action"]>[2],
  ) {
    return this.portal.action(req.actor, id, body);
  }
  @Post("timesheets/:id/shared") shared(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: Parameters<PortalService["shared"]>[2],
  ) {
    return this.portal.shared(req.actor, id, body);
  }
  @Get("masters") masters(@Req() req: Request) {
    return this.portal.masters(req.actor);
  }
  @Post("masters") saveMaster(
    @Req() req: Request,
    @Body() body: Parameters<PortalService["saveMaster"]>[1],
  ) {
    return this.portal.saveMaster(req.actor, body);
  }
  @Get("employees") employees(@Req() req: Request) {
    return this.portal.employees(req.actor);
  }
  @Get("access") access(@Req() req: Request) {
    return this.portal.access(req.actor);
  }
  @Post("access") grant(
    @Req() req: Request,
    @Body() body: Parameters<PortalService["grant"]>[1],
  ) {
    return this.portal.grant(req.actor, body);
  }
  @Patch("access/:id") setAccess(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: { active: boolean },
  ) {
    return this.portal.setAccess(req.actor, id, body.active);
  }
  @Post("reminders") reminders(
    @Req() req: Request,
    @Body() body: { period: string; kind: string },
  ) {
    return this.portal.reminders(req.actor, body);
  }
  @Get("notifications") notifications(@Req() req: Request) {
    return this.portal.notifications(req.actor);
  }
  @Patch("notifications/:id") read(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.portal.readNotification(req.actor, id);
  }
  @Get("audit") audit(@Req() req: Request) {
    return this.portal.auditEvents(req.actor);
  }
  @Post("imports/hr") importHR(
    @Req() req: Request,
    @Body() body: Parameters<PortalWorkbookService["importHR"]>[1],
  ) {
    return this.workbooks.importHR(req.actor, body);
  }
  @Post("imports/projects") importProjects(
    @Req() req: Request,
    @Body() body: Parameters<PortalWorkbookService["importProjects"]>[1],
  ) {
    return this.workbooks.importProjects(req.actor, body);
  }
  @Get("reports") reports(
    @Req() req: Request,
    @Query() query: Record<string, string>,
  ) {
    return this.workbooks.report(req.actor, query);
  }
  @Get("reports/export") async reportExport(
    @Req() req: Request,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    this.send(
      res,
      await this.workbooks.download(
        await this.workbooks.report(req.actor, query),
        "Timesheet report",
      ),
      "timesheet-report.xlsx",
    );
  }
  @Get("imports/template") async template(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.portal.run(req.actor, ["HR", "FINANCE"], () =>
      Promise.resolve(true),
    );
    this.send(
      res,
      await this.workbooks.template(),
      "hr-employee-template.xlsx",
    );
  }
  @Post("exports/oracle") async oracle(
    @Req() req: Request,
    @Body() body: { period: string },
    @Res() res: Response,
  ) {
    this.send(
      res,
      await this.workbooks.exportOracle(req.actor, body.period),
      `oracle-staging-${body.period}.xlsx`,
    );
  }
  @Get("masters/export") async masterExport(
    @Req() req: Request,
    @Query("kind") kind: string,
    @Res() res: Response,
  ) {
    const masters = (await this.portal.masters(req.actor)).filter(
      (item) => item.kind === kind,
    );
    this.send(
      res,
      await this.workbooks.download(
        masters.map((item) => ({
          Code: item.code,
          ...Object.fromEntries(
            Object.entries(item.data as Record<string, unknown>).map(
              ([key, value]) => [key, String(value)],
            ),
          ),
        })),
        "Master data",
      ),
      "master-data.xlsx",
    );
  }
  private send(res: Response, buffer: Buffer, name: string) {
    res.setHeader(
      "content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("content-disposition", `attachment; filename="${name}"`);
    res.send(buffer);
  }
}
