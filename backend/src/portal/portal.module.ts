import { Module } from "@nestjs/common";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalService } from "./portal.service";
import { PortalWorkbookService } from "./portal-workbook.service";
import { PortalController } from "./portal.controller";
@Module({
  providers: [PortalAuthGuard, PortalService, PortalWorkbookService],
  controllers: [PortalController],
})
export class PortalModule {}
