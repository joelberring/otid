import { expect, it } from "vitest";
import { raceSessionResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";

it("sessionssvaret bär bara administratörens eller funktionärens roll", () => {
  const value = { formatVersion: 1, raceId: id, role: "ADMIN", expiresAt: "2026-09-12T14:00:00Z" };
  expect(raceSessionResponseSchema.safeParse(value).success).toBe(true);
  expect(raceSessionResponseSchema.safeParse({ ...value, role: "FUNCTIONARY" }).success).toBe(true);
  expect(raceSessionResponseSchema.safeParse({ ...value, role: "MANAGE_RACE" }).success).toBe(false);
});
