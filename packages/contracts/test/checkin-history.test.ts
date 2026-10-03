import { expect, it } from "vitest";
import { checkinHistoryResponseSchema } from "../src";

it("TASK057 distinguishes durable conflict from applied state and rejects source mismatch or duplicate rows", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const row = { requestId: id, observedAt: "2026-09-12T10:00:00.000Z", receivedAt: "2026-09-12T10:01:00.000Z",
    source: "MANAGE_RACE", sourceLabel: "Administration", action: { kind: "MARK_START", state: "STARTED" },
    effect: { kind: "CONFLICT", reason: "STALE_REVISION", revision: 3 } };
  const response = { formatVersion: 1, raceId: id, entryId: id, rows: [row], nextCursor: null };
  expect(checkinHistoryResponseSchema.parse(response).rows[0]?.effect.kind).toBe("CONFLICT");
  for (const changed of [{ rows: [row, row] }, { rows: [{ ...row, source: "FINISH_FOREST_WATCH" }] },
    { rows: [{ ...row, credential: "not allowed" }] }, { rows: [], nextCursor: "abc" }, { nextCursor: "bad/cursor" }]) {
    expect(checkinHistoryResponseSchema.safeParse({ ...response, ...changed }).success).toBe(false);
  }
  expect(checkinHistoryResponseSchema.safeParse({ ...response, rows: [{ ...row,
    action: { kind: "FINISH_CORRECTION", state: "STARTED", manualReturnRegistered: false },
    effect: { kind: "APPLIED", revision: 4, revisionId: id } }] }).success).toBe(true);
});
