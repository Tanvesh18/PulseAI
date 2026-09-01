import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/employee",
}));

describe("application shell", () => {
  it("provides labelled employee navigation and utility controls", async () => {
    const { container } = render(
      <AppShell>
        <h1>Employee overview</h1>
      </AppShell>,
    );

    expect(
      screen.getByRole("navigation", { name: "Employee navigation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open notifications, 2 unread" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open pulse ai assistant/i }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
