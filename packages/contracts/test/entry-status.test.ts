import { describe, expect, it } from "vitest";
import { entryStatusConflictSchema, entryStatusIdempotencyKeySchema, entryStatusRequestSchema } from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";

describe("steg 23: ett statuskontrakt (ADR-0173 beslut 1)", () => {
  it("tar emot varje beslut som en diskriminerad union med förväntad revision", () => {
    for (const decision of [{ kind: "DID_NOT_START" }, { kind: "DID_NOT_FINISH" }, { kind: "DISQUALIFIED", reason: "Fusk" },
      { kind: "OUT_OF_COMPETITION" }, { kind: "WITHOUT_TIMING" }, { kind: "APPROVE_MANUALLY" },
      { kind: "FINISH_TIME", finishTime: "2026-09-12T10:20:00.000Z" }, { kind: "START_TIME", startTime: "2026-09-12T10:00:00+02:00" },
      { kind: "WITHDRAW" }]) {
      expect(entryStatusRequestSchema.safeParse({ formatVersion: 1, requestId, expectedRevision: 2, decision }).success).toBe(true);
    }
    expect(entryStatusRequestSchema.safeParse({ formatVersion: 1, requestId, expectedRevision: -1, decision: { kind: "WITHDRAW" } }).success).toBe(false);
    expect(entryStatusRequestSchema.safeParse({ formatVersion: 1, requestId, expectedRevision: 0,
      decision: { kind: "FINISH_TIME" } }).success).toBe(false);
    expect(entryStatusRequestSchema.safeParse({ formatVersion: 1, requestId, expectedRevision: 0,
      decision: { kind: "DID_NOT_START", extra: true } }).success).toBe(false);
  });

  it("binder idempotensnyckeln till begärans id och bär det nya läget i en konflikt", () => {
    expect(entryStatusIdempotencyKeySchema.safeParse(`entry-status:${requestId}`).success).toBe(true);
    expect(entryStatusIdempotencyKeySchema.safeParse(`did-not-start:${requestId}`).success).toBe(false);
    expect(entryStatusConflictSchema.parse({ formatVersion: 1, error: "CONFLICT", headRevision: 4, readiness: "STALE_RESULT" }).headRevision).toBe(4);
  });
});
