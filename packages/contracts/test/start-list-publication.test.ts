import { describe, expect, it } from "vitest";
import { publicStartListResponseSchema, startListPublicationPreviewResponseSchema, startListPublicationRequestSchema } from "../src";
const entry = { displayName: "Ada A", organisationName: null, fixedStartTime: "2026-09-04T08:00:00.000Z" };
const raceClass = { name: "D21", startRule: "FIXED" as const, entries: [entry] };
const content = { eventName: "E", raceName: "R", raceDate: "2026-09-04", timeZone: "Europe/Stockholm", classes: [raceClass] };
const published = { formatVersion: 1, revision: 1, publishedAt: "2026-09-04T07:00:00.000Z", content };
describe("TASK 006S publiceringskontrakt", () => {
  it("är strikt och lämnar aldrig id eller bricka offentligt", () => {
    expect(publicStartListResponseSchema.safeParse(published).success).toBe(true);
    for (const invalid of [
      { ...content, classes: [{ ...raceClass, id: "x" }] },
      { ...content, classes: [{ ...raceClass, entries: [{ ...entry, cardNumber: "1" }] }] },
      { ...content, classes: [{ ...raceClass, startRule: "PUNCH" }] },
      { ...content, classes: [] },
      { ...content, timeZone: "Bad/Zone" },
    ]) expect(publicStartListResponseSchema.safeParse({ ...published, content: invalid }).success).toBe(false);
  });
  it("binder nullable preview och mutationsintent", () => {
    const base = { formatVersion: 1, raceId: "10000000-0000-4000-8000-000000000001", snapshotVersion: 1, latestDecision: null };
    expect(startListPublicationPreviewResponseSchema.safeParse({ ...base, sourceHash: null, content: null }).success).toBe(true);
    expect(startListPublicationPreviewResponseSchema.safeParse({ ...base, sourceHash: "a".repeat(64), content: null }).success).toBe(false);
    expect(startListPublicationRequestSchema.safeParse({ formatVersion: 1, action: "PUBLISH", expectedSnapshotVersion: 1, expectedSourceHash: "a".repeat(64), expectedRevision: 0 }).success).toBe(true);
    expect(startListPublicationRequestSchema.safeParse({ formatVersion: 1, action: "WITHDRAW", expectedRevision: 0 }).success).toBe(false);
  });
});
