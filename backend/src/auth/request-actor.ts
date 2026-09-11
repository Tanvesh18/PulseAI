import type { UserRole } from "../data/employee-data";

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
