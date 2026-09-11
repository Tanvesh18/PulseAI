export type PortalRole = "MANAGER" | "FINANCE" | "HR" | "DIRECTOR";
export type MasterKind =
  "business-group" | "project" | "cost-center" | "rate" | "fx" | "cycle";
export type MasterData = Record<string, string | number | boolean>;
export type MonthlyRow = {
  id: string;
  employeeCode: string;
  employeeName: string;
  businessGroup: string;
  grade: string;
  billingGrade: string;
  costCenter: string;
  projectCode: string;
  location: "US" | "Non-US";
  usState: string;
  hours: number;
  expectedHours: number;
  remarks: string;
  shared: boolean;
};
export type EmployeeInput = {
  code: string;
  name: string;
  email: string;
  businessGroup: string;
  grade: string;
  billingGrade: string;
  costCenter: string;
  joinDate: string;
  exitDate: string | null;
  transferDate: string | null;
  previousCostCenter: string | null;
  annualSalary: number;
  travelFrom: string | null;
  travelTo: string | null;
  usState: string | null;
  category: string;
};
