import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./env";

describe("parseEnvironment", () => {
  it("accepts the supported Next.js environments", () => {
    expect(parseEnvironment({ NODE_ENV: "test" })).toEqual({
      BACKEND_API_URL: "http://localhost:4000",
      NODE_ENV: "test",
    });
  });

  it("rejects unsupported environments", () => {
    expect(() => parseEnvironment({ NODE_ENV: "staging" })).toThrow();
  });
});
