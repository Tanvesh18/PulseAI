import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmployeeDashboardPage from "@/app/(app)/employee/page";
import TimesheetHistoryPage from "@/app/(app)/employee/timesheets/history/page";
import { CurrentTimesheetScreen } from "@/features/employee/components/current-timesheet-screen";
import { TimesheetEditor } from "@/features/employee/components/timesheet-editor";
import { currentTimesheet } from "@/features/employee/data/mock-employee";

const employeeApi = vi.hoisted(() => ({
  getCurrentTimesheet: vi.fn(),
  getEmployeeProfile: vi.fn(),
  isEmployeeAccessError: () => false,
  listTimesheets: vi.fn(),
  saveTimesheet: vi.fn(),
  submitTimesheet: vi.fn(),
}));

vi.mock("@/features/employee/data/employee-api", () => employeeApi);

describe("employee experience", () => {
  beforeEach(() => {
    employeeApi.getCurrentTimesheet.mockReset();
    employeeApi.getEmployeeProfile.mockReset();
    employeeApi.listTimesheets.mockReset();
    employeeApi.getCurrentTimesheet.mockRejectedValue(new Error("Unavailable"));
    employeeApi.getEmployeeProfile.mockRejectedValue(new Error("Unavailable"));
    employeeApi.listTimesheets.mockRejectedValue(new Error("Unavailable"));
  });

  it("presents the current period and primary timesheet action accessibly", async () => {
    const { container } = render(<EmployeeDashboardPage />);

    expect(
      screen.getByRole("heading", { name: "Welcome back, Avery" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open timesheet/i }),
    ).toHaveAttribute("href", "/employee/timesheets/current");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("presents historical periods in a labelled table", async () => {
    const { container } = render(<TimesheetHistoryPage />);

    expect(
      screen.getByRole("table", { name: "Employee timesheet history" }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("provides an accessible weekly entry experience", async () => {
    const { container } = render(
      <TimesheetEditor timesheet={currentTimesheet} />,
    );

    expect(
      screen.getByRole("heading", { name: "My timesheet" }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText(/hours/i).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("recomputes warnings from the edited entries", () => {
    render(<TimesheetEditor timesheet={currentTimesheet} />);

    fireEvent.change(
      screen.getByLabelText("Friday, Internal operations, Team support, hours"),
      { target: { value: "8" } },
    );
    expect(
      screen.queryByText("1 hour remains unrecorded"),
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByLabelText("Wednesday, Client portal, Implementation, hours", {
        selector: "#hours-client-duplicate-wed",
      }),
      { target: { value: "0" } },
    );
    expect(
      screen.queryByText("Potential duplicate entry on Wednesday"),
    ).not.toBeInTheDocument();
  });

  it("shows the populated static week when the backend is unavailable", async () => {
    render(<CurrentTimesheetScreen />);

    expect(
      await screen.findByRole("heading", { name: "My timesheet" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Client portal").length).toBeGreaterThan(0);
    expect(screen.getByText("Demo data")).toBeInTheDocument();
  });
});
