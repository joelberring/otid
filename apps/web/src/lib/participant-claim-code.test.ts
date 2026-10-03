import { describe, expect, it } from "vitest";
import { participantClaimRedeemRequestSchema } from "@o-tid/contracts";
import { createParticipantClaimMaterial } from "./participant-claim-code";

describe("participant one-time code creation", () => {
  it("creates a canonical 128-bit base64url code and a SHA-256 hex hash", async () => {
    const material = await createParticipantClaimMaterial();
    expect(material.code).toMatch(/^[A-Za-z0-9_-]{21}[AQgw]$/);
    expect(material.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(participantClaimRedeemRequestSchema.safeParse({ formatVersion: 1,
      requestId: "10000000-0000-4000-8000-000000000001", code: material.code }).success).toBe(true);
  });
});
