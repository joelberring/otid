import { describe, expect, it } from "vitest";
import { requireRaceRole } from "../src/race-session";

type Executor = Parameters<typeof requireRaceRole>[0];
const input = { sessionToken: null, raceId: "10000000-0000-4000-8000-000000000002", role: "FUNCTIONARY" as const };
const failing = (error: unknown) => ({ transaction: async () => { throw error; } }) as unknown as Executor;

describe("rollkontrollens savepoint vid läsning", () => {
  it("mappar endast direkt eller Drizzle-wrappad 40001 till avvisad auth", async () => {
    for (const error of [{ code: "40001" }, new Error("query failed", { cause: { code: "40001" } })]) {
      await expect(requireRaceRole(failing(error), input, new Date(), "share")).resolves.toEqual({ status: "unauthorized" });
    }
  });
  it("propagerar timeout/deadlock/andra fel och tål cyklisk cause utan loop", async () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    for (const error of [{ code: "55P03" }, { code: "40P01" }, new Error("database unavailable"), cyclic]) {
      await expect(requireRaceRole(failing(error), input, new Date(), "share")).rejects.toBe(error);
    }
  });
});
