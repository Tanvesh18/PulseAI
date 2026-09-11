import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SheetEditor } from "@/features/portal/timesheets";
import type { Master, Sheet } from "@/features/portal/types";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  execute: vi.fn(),
  role: "MANAGER",
}));
vi.mock("@/features/portal/api", () => ({ api: mocks.api, download: vi.fn() }));
vi.mock("@/features/portal/portal-shell", () => ({
  usePortal: () => ({
    session: { role: mocks.role, costCenters: ["C1"] },
    busy: false,
    execute: mocks.execute,
  }),
}));
const sheet: Sheet = {
  id: "s1",
  period: "2026-09",
  businessGroup: "BG",
  costCenter: "C1",
  managerUserId: "m1",
  status: "DRAFT",
  version: 1,
  submittedAt: null,
  returnReason: null,
  exportedAt: null,
  rows: [
    {
      id: "r1",
      employeeCode: "E1",
      employeeName: "Test Employee",
      businessGroup: "BG",
      grade: "Grade 5",
      billingGrade: "Grade 5",
      costCenter: "C1",
      projectCode: "P1",
      location: "Non-US",
      usState: "",
      hours: 120,
      expectedHours: 167,
      remarks: "",
      shared: false,
    },
  ],
};
const masters: Master[] = [
  { id: "p1", kind: "project", code: "P1", data: {} },
  { id: "c1", kind: "cost-center", code: "C1", data: {} },
];
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  mocks.api.mockReset();
  mocks.execute.mockReset();
  mocks.role = "MANAGER";
  mocks.execute.mockImplementation(async (action: () => Promise<unknown>) => {
    await action();
    return true;
  });
});
it("preserves locked HR fields and provides an accessible monthly editor", async () => {
  const { container } = render(<SheetEditor sheet={sheet} masters={masters} />);
  expect(
    screen.queryByLabelText("Test Employee Oracle grade"),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Test Employee Hours")).toHaveValue(120);
  expect(await axe(container)).toHaveNoViolations();
});
it("requires short-hours remarks before confirming submission", () => {
  render(<SheetEditor sheet={sheet} masters={masters} />);
  fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
  expect(screen.getByRole("button", { name: "Confirm submit" })).toBeDisabled();
});
it("saves edited hours and remarks using the current version", async () => {
  mocks.api.mockResolvedValue({ ...sheet, version: 2 });
  render(<SheetEditor sheet={sheet} masters={masters} />);
  fireEvent.change(screen.getByLabelText("Test Employee Hours"), {
    target: { value: "130" },
  });
  fireEvent.change(screen.getByLabelText("Test Employee Remarks"), {
    target: { value: "Medical leave" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith(
      "timesheets/s1",
      expect.objectContaining({
        expectedVersion: 1,
        rows: [
          expect.objectContaining({ hours: 130, remarks: "Medical leave" }),
        ],
      }),
      "PATCH",
    ),
  );
});
it("locks submitted timesheets for managers", () => {
  render(
    <SheetEditor sheet={{ ...sheet, status: "SUBMITTED" }} masters={masters} />,
  );
  expect(
    screen.queryByLabelText("Test Employee Hours"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save draft" }),
  ).not.toBeInTheDocument();
});
it("gives Finance grade editing and explains reapproval", () => {
  mocks.role = "FINANCE";
  render(
    <SheetEditor sheet={{ ...sheet, status: "APPROVED" }} masters={masters} />,
  );
  expect(
    screen.getByLabelText("Test Employee Oracle grade"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/fresh|back for director approval/),
  ).toBeInTheDocument();
});
