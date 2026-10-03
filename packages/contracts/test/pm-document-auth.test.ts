import { describe, expect, it } from "vitest";
import { pmDocumentLoginRequestSchema } from "../src";

const raceId = "a0000000-0000-4000-8000-000000000002";
const accessCredential = `otid_org_pm_document_v1.${raceId}.${"A".repeat(43)}`;

describe("TASK013 PM-document capability login contract", () => {
  it("accepts only the exact PM-document prefix, canonical UUID and base64url secret", () => {
    expect(pmDocumentLoginRequestSchema.parse({ formatVersion: 1, accessCredential })).toEqual({ formatVersion: 1, accessCredential });
    for (const invalid of [
      accessCredential.replace("pm_document", "speaker_board"),
      accessCredential.replace(raceId, raceId.toUpperCase()),
      `${accessCredential}.suffix`,
      accessCredential.slice(0, -1),
      accessCredential.replace(/A$/, "+")
    ]) expect(pmDocumentLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential: invalid }).success).toBe(false);
  });

  it("is strict and does not provide an accidental upload intent", () => {
    expect(pmDocumentLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential, title: "PM" }).success).toBe(false);
    expect(pmDocumentLoginRequestSchema.safeParse({ formatVersion: 2, accessCredential }).success).toBe(false);
    expect(pmDocumentLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential: 42 }).success).toBe(false);
  });
});
