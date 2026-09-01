import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { StaticDataService } from "../data/static-data.service";

@Injectable()
export class EmployeeAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly data: StaticDataService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const subject = await this.resolveSubject(request);
    const user = this.data.users.find((item) => item.oidcSubject === subject);

    if (!user?.active || user.role !== "EMPLOYEE" || !user.employeeId) {
      throw new UnauthorizedException(
        "An active Employee account is required.",
      );
    }

    request.actor = {
      employeeId: user.employeeId,
      organizationId: user.organizationId,
      role: user.role,
      userId: user.id,
    };
    return true;
  }

  private async resolveSubject(request: Request): Promise<string> {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
      const issuer = this.config.get<string>("OIDC_ISSUER");
      const audience = this.config.get<string>("OIDC_AUDIENCE");
      const jwksUrl = this.config.get<string>("OIDC_JWKS_URL");
      if (!issuer || !audience || !jwksUrl) {
        throw new ServiceUnavailableException("OIDC is not configured.");
      }

      try {
        const result = await jwtVerify(
          authorization.slice("Bearer ".length),
          createRemoteJWKSet(new URL(jwksUrl)),
          { issuer, audience },
        );
        if (!result.payload.sub) throw new Error("Token subject is missing");
        return result.payload.sub;
      } catch {
        throw new UnauthorizedException(
          "The access token is invalid or expired.",
        );
      }
    }

    const isProduction =
      this.config.get<string>("NODE_ENV") === "production";
    const devAuthSetting = this.config.get<string>("ALLOW_DEV_AUTH");
    const devAuthEnabled =
      devAuthSetting === "true" ||
      (devAuthSetting === undefined && !isProduction);

    if (devAuthEnabled) {
      return (
        this.config.get<string>("DEV_AUTH_SUBJECT") ?? "dev-employee-avery"
      );
    }

    throw new UnauthorizedException("A bearer access token is required.");
  }
}
