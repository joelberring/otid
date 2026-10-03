import { describe, expect, it } from "vitest";
import { authenticatePairingAdminSessionForProtectedRead } from "../src/pairing-admin";

type Transaction = Parameters<typeof authenticatePairingAdminSessionForProtectedRead>[0];
const input = { sessionToken: null, raceId: "10000000-0000-4000-8000-000000000002", capability: "VIEW_SPEAKER_BOARD" as const };
const failing = (error: unknown) => ({ transaction: async () => { throw error; } }) as unknown as Transaction;

describe("protected-read auth savepoint failure", () => {
  it("mappar endast direkt eller Drizzle-wrappad 40001 till avvisad auth", async () => {
    for (const error of [{ code: "40001" }, new Error("query failed", { cause: { code: "40001" } })]) {
      await expect(authenticatePairingAdminSessionForProtectedRead(failing(error), input))
        .resolves.toEqual({ status: "unauthorized" });
    }
  });
  it("propagerar timeout/deadlock/andra fel och tål cyklisk cause utan loop", async () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    for (const error of [{ code: "55P03" }, { code: "40P01" }, new Error("database unavailable"), cyclic]) {
      await expect(authenticatePairingAdminSessionForProtectedRead(failing(error), input)).rejects.toBe(error);
    }
  });
});
