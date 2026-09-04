import type { Metadata } from "next";
import { EmployeeOverviewScreen } from "@/features/employee/components/employee-overview-screen";

export const metadata: Metadata = {
  title: "Employee overview",
};

export default function EmployeeDashboardPage() {
  return <EmployeeOverviewScreen />;
}
