import { redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import Home from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("root route", () => {
  it("redirects to the employee experience", () => {
    Home();

    expect(redirect).toHaveBeenCalledWith("/employee");
  });
});
