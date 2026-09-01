import { afterEach, describe, expect, it, vi } from "vitest";
import { currentTimesheet } from "./mock-employee";
import { saveTimesheet } from "./employee-api";

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
});
