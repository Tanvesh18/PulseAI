import type { UserRole } from "../data/static-data.service";

export type RequestActor = {
  employeeId: string | null;
  organizationId: string;
  role: UserRole;
  userId: string;
};

declare module "express-serve-static-core" {
  interface Request {
    actor: RequestActor;
  }
}
