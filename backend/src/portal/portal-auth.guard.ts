import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";
import { EmployeeAuthGuard } from "../auth/employee-auth.guard";

@Injectable()
export class PortalAuthGuard extends EmployeeAuthGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const role = request.headers["x-dev-role"];
    const demo =
      this.config.get<string>("NODE_ENV") !== "production" &&
      this.config.get<string>("ALLOW_DEV_AUTH") !== "false";
    const subject =
      demo &&
      !request.headers.authorization &&
      typeof role === "string" &&
      ["MANAGER", "FINANCE", "HR", "DIRECTOR"].includes(role)
        ? `dev-portal-${role.toLowerCase()}`
        : await this.resolveSubject(request);
    const user = await this.data.user.findUnique({
      where: { oidcSubject: subject },
    });
    if (
      !user?.active ||
      !["MANAGER", "FINANCE", "HR", "DIRECTOR"].includes(user.role)
    )
      throw new UnauthorizedException("Sign in with an active portal account.");
    const focusRole = this.config.get<string>("WORKSPACE_FOCUS_ROLE");
    if (focusRole && user.role !== focusRole)
      throw new ForbiddenException("This workspace is locked for now. Sign in as Director.");
    request.actor = {
      userId: user.id,
      employeeId: user.employeeId,
      organizationId: user.organizationId,
      role: user.role,
    };
    return true;
  }
}
