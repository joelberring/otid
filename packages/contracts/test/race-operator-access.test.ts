import { describe, expect, it } from "vitest";
import { raceOperatorAccessIssueRequestSchema, raceOperatorAccessIssueResponseSchema } from "../src/race-operator-access";

const id = "11111111-1111-4111-8111-111111111111";

describe("TASK102 web-issued operator access contracts", () => {
  it("accepts only the three deliberate roles and a matching transient credential", () => {
    const request = { formatVersion: 1 as const, capability: "START_CHECKIN" as const, label: "Start", expiresAt: "2026-09-20T12:00:00.000Z" };
    expect(raceOperatorAccessIssueRequestSchema.parse(request)).toEqual(request);
    expect(raceOperatorAccessIssueRequestSchema.safeParse({ ...request, capability: "PAIR_STATION" }).success).toBe(false);
    expect(raceOperatorAccessIssueResponseSchema.parse({
      formatVersion: 1, accessCredential: `otid_org_start_checkin_v1.${id}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
      access: { formatVersion: 1, credentialId: id, raceId: id, capability: "START_CHECKIN", label: "Start",
        issuedAt: "2026-09-20T10:00:00.000Z", expiresAt: "2026-09-20T12:00:00.000Z", revokedAt: null }
    }).access.capability).toBe("START_CHECKIN");
  });
});
