import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { StaticDataService } from "../data/static-data.service";
import { EmployeeAuthGuard } from "./employee-auth.guard";

jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

function contextFor(request: Partial<Request>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function devConfig(): ConfigService {
  return {
    get: (key: string) =>
      ({ ALLOW_DEV_AUTH: "true", DEV_AUTH_SUBJECT: "dev-employee-avery" })[
        key
      ],
  } as ConfigService;
}

describe("EmployeeAuthGuard", () => {
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
});
