import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CurrentTimesheetScreen } from "./current-timesheet-screen";

const { getCurrentTimesheet } = vi.hoisted(() => ({
  getCurrentTimesheet: vi.fn(),
}));

vi.mock("../data/employee-api", () => ({
  getCurrentTimesheet,
  saveTimesheet: vi.fn(),
  submitTimesheet: vi.fn(),
}));

describe("CurrentTimesheetScreen", () => {
  beforeEach(() => {
    getCurrentTimesheet.mockReset();
  });

  it("shows the populated static week when the backend is unavailable", async () => {
    getCurrentTimesheet.mockRejectedValueOnce(new Error("Unavailable"));

    render(<CurrentTimesheetScreen />);

    expect(
      await screen.findByRole("heading", { name: "My timesheet" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Client portal").length).toBeGreaterThan(0);
    expect(screen.getByText("Demo data")).toBeInTheDocument();
  });
});
