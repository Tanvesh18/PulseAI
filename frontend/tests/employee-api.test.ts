import { afterEach, describe, expect, it, vi } from "vitest";
import { currentTimesheet } from "@/features/employee/data/mock-employee";
import {
  askAssistant,
  markNotificationRead,
  saveTimesheet,
} from "@/features/employee/data/employee-api";

describe("employee API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends normalized assignment days with the expected version", async () => {
    const response = { ...currentTimesheet, version: 4 };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(response)));

    await saveTimesheet(currentTimesheet, currentTimesheet.entries, 3);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      expectedVersion: 3,
      entries: expect.arrayContaining([
        expect.objectContaining({ assignmentId: "client-implementation" }),
      ]),
    });
  });

  it("preserves the server recovery message on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ message: "Refresh before saving again." }),
        {
          status: 409,
        },
      ),
    );

    await expect(
      saveTimesheet(currentTimesheet, currentTimesheet.entries, 1),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "Refresh before saving again.",
        status: 409,
      }),
    );
  });

  it("uses employee-scoped notification and assistant endpoints", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ read: true })));

    await markNotificationRead("notification-1");
    await askAssistant("Summarize my current timesheet");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/backend/employee/notifications/notification-1/read",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/backend/employee/assistant/query",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      question: "Summarize my current timesheet",
    });
  });
});
