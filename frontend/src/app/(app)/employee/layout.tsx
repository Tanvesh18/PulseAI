import type { ReactNode } from "react";
import { AppShell } from "@/features/employee/app-shell";
import { redirect } from "next/navigation";
import { isWorkspaceEnabled } from "@/config/workspace-focus";

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  if (!isWorkspaceEnabled("EMPLOYEE")) redirect("/");
  return <AppShell>{children}</AppShell>;
}
