import { describe, expect, it } from "vitest";
import {
  publicResultFollowIdempotencyKey,
  publicResultFollowListResponseSchema,
  publicResultFollowSetRequestSchema,
  publicResultFollowSetResponseSchema
} from "../src";

const raceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const publicResultId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const result = {
  className: "D21",
  givenName: "Ada",
  familyName: "Löpare",
  organisationName: "Centrum OK",
  revision: 2,
  status: "OK" as const,
  reason: "COMPLETE" as const,
  elapsedMs: 3_600_000,
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000, legMs: 600_000 }],
  rankingState: "RANKED" as const,
  position: 1,
  timeBehindMs: 0,
  publicResultId,
  missingControls: [],
  extraPunches: []
};

describe("public result follow contracts", () => {
  it("validates canonical Set request UUIDs and creates the stable idempotency key", () => {
    const request = {
      formatVersion: 1,
      requestId,
      raceId,
      publicResultId,
      followed: true
    };
    expect(publicResultFollowSetRequestSchema.parse(request)).toEqual(request);
    expect(publicResultFollowIdempotencyKey(requestId)).toBe(`public-result-follow:${requestId}`);
    expect(publicResultFollowSetRequestSchema.safeParse({ ...request, requestId: requestId.toUpperCase() }).success)
      .toBe(false);
    expect(publicResultFollowSetRequestSchema.safeParse({ ...request, entryId: raceId }).success).toBe(false);
  });

  it("accepts the minimal replay-aware response and rejects internal sequence or extra fields", () => {
    const response = {
      formatVersion: 1,
      requestId,
      raceId,
      publicResultId,
      followed: true,
      replayed: false
    };
    expect(publicResultFollowSetResponseSchema.parse(response)).toEqual(response);
    expect(publicResultFollowSetResponseSchema.safeParse({ ...response, sequence: 1 }).success).toBe(false);
    expect(publicResultFollowSetResponseSchema.safeParse({ ...response, entryId: raceId }).success).toBe(false);
  });

  it("validates a bounded public list with V7 result or null and excludes private fields", () => {
    const response = {
      formatVersion: 1,
      items: [{ raceId, publicResultId, eventName: "Klubbtävling", raceName: "Medel", result }]
    };
    expect(publicResultFollowListResponseSchema.parse(response)).toEqual(response);
    expect(publicResultFollowListResponseSchema.safeParse({
      formatVersion: 1,
      items: [{ ...response.items[0], result: null }]
    }).success).toBe(true);
    expect(publicResultFollowListResponseSchema.safeParse({
      formatVersion: 1,
      items: [{ ...response.items[0], entryId: raceId }]
    }).success).toBe(false);
    expect(publicResultFollowListResponseSchema.safeParse({
      formatVersion: 1,
      items: Array.from({ length: 1001 }, () => response.items[0])
    }).success).toBe(false);
  });
});
