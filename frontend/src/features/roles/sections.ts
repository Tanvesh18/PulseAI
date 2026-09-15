import type { Role } from "@/features/portal/types";
import { directorSections } from "@/features/director/director-sections";
import { financeSections } from "./finance/sections";
import { hrSections } from "./hr/sections";
import { managerSections } from "./manager/sections";

export type PortalSection =
  | "overview"
  | "timesheets"
  | "approvals"
  | "reports"
  | "masters"
  | "access"
  | "imports"
  | "notifications"
  | "audit";

export const roleSections: Record<Role, readonly PortalSection[]> = {
  MANAGER: managerSections,
  HR: hrSections,
  FINANCE: financeSections,
  DIRECTOR: directorSections,
};
