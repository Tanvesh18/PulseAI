import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { AppShell } from "@/components/shell/app-shell";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  usePathname: () => "/employee",
}));

describe("application entry points", () => {
  it("redirects the root route to the employee experience", () => {
    Home();

    expect(redirect).toHaveBeenCalledWith("/employee");
  });

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
