import { expect, it } from "vitest";
import { reportedStartMinutes } from "./reported-start-age";

it("TASK061 uses the report instant, preserves unknown/future observations and rounds down", () => {
  expect(reportedStartMinutes("2026-09-12T10:00:00.000Z", "2026-09-12T10:20:59.999Z")).toBe(20);
  expect(reportedStartMinutes(null, "2026-09-12T10:20:00.000Z")).toBeNull();
  expect(reportedStartMinutes("2026-09-12T10:21:00.000Z", "2026-09-12T10:20:00.000Z")).toBeNull();
  expect(reportedStartMinutes("invalid", "invalid")).toBeNull();
});
