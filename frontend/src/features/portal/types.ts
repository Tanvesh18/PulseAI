export type Role = "MANAGER" | "FINANCE" | "HR" | "DIRECTOR";
export type Session = {
  id: string;
  name: string;
  role: Role;
  costCenters: string[];
  demoAuth: boolean;
};
export type Row = {
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
export type Sheet = {
  id: string;
  period: string;
  businessGroup: string;
  costCenter: string;
  managerUserId: string;
  status: string;
  version: number;
  rows: Row[];
  submittedAt: string | null;
  returnReason: string | null;
  exportedAt: string | null;
};
export type Master = {
  id: string;
  kind: string;
  code: string;
  data: Record<string, string | number | boolean>;
};
export type Employee = {
  code: string;
  name: string;
  businessGroup: string;
  grade: string;
  billingGrade: string;
  costCenter: string;
};
export type Notice = {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
};
export type Audit = {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
  targetId: string;
};
export type Access = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  active: boolean;
  costCenters: string[];
  oidcSubject: string;
};
export type ImportSummary = {
  records: number;
  newEmployees: number;
  transfers: number;
  departures: number;
  generated: number;
  locked: number;
};
export type Overview = {
  sheets: Sheet[];
  employees: number;
  shortHours: number;
  cycle: { start: string; end: string; standardHours: number };
  imports: {
    id: string;
    filename: string;
    createdAt: string;
    summary: ImportSummary;
  }[];
};
export type ReportRow = Record<string, string | number>;
