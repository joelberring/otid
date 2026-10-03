import { describe, expect, it } from "vitest";
import { classStartDrawParametersSchema, classStartDrawPreviewResponseSchema, classStartDrawRequestSchema, classStartDrawResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const parameters = { algorithmVersion: "xorshift32-fisher-yates-v1", seed: 7, firstStartTime: "2026-09-04T10:00:00.123+02:00", intervalSeconds: 60 };
const preview = { formatVersion: 1, raceId: id, classId: id, className: "H21", snapshotVersion: 1, sourceHash: "a".repeat(64), timeZone: "Europe/Stockholm", parameters,
  entries: [{ entryId: id, entryVersion: 1, displayName: "Ada A", previousFixedStartTime: null, fixedStartTime: "2026-09-04T08:00:00.123Z", changed: true }] };

describe("TASK 006U klasslottningskontrakt", () => {
  it("normaliserar offset och avvisar ogiltiga parametrar utan fallback", () => {
    expect(classStartDrawParametersSchema.parse(parameters).firstStartTime).toBe("2026-09-04T08:00:00.123Z");
    for (const invalid of [{ seed: 0 }, { seed: 4_294_967_296 }, { seed: 1.1 }, { intervalSeconds: 0 }, { intervalSeconds: 3_601 },
      { intervalSeconds: 0.5 }, { algorithmVersion: "next" }, { firstStartTime: "2026-09-04T10:00:00" },
      { firstStartTime: "2026-02-30T10:00:00Z" }, { firstStartTime: "2026-09-04T10:00:00+14:01" },
      { firstStartTime: "9999-12-31T23:59:59-14:00" }, { override: true }]) {
      expect(classStartDrawParametersSchema.safeParse({ ...parameters, ...invalid }).success).toBe(false);
    }
  });
  it("binder unik granskning till tidsslots och verkliga ändringsflaggor", () => {
    expect(classStartDrawPreviewResponseSchema.safeParse(preview).success).toBe(true);
    const entry = preview.entries[0]!;
    for (const entries of [[], [entry, entry], [{ ...entry, changed: false }], [{ ...entry, fixedStartTime: "2026-09-04T08:01:00.123Z" }]]) {
      expect(classStartDrawPreviewResponseSchema.safeParse({ ...preview, entries }).success).toBe(false);
    }
    expect(classStartDrawPreviewResponseSchema.safeParse({ ...preview, timeZone: "Bad/Zone" }).success).toBe(false);
  });
  it("avvisar klientplan i write och omöjliga kvittenser", () => {
    const request = { formatVersion: 1, classId: id, expectedSnapshotVersion: 1, sourceHash: "a".repeat(64), parameters };
    expect(classStartDrawRequestSchema.safeParse(request).success).toBe(true);
    expect(classStartDrawRequestSchema.safeParse({ ...request, entries: preview.entries }).success).toBe(false);
    const receipt = { formatVersion: 1, raceId: id, requestId: id, classId: id, replayed: false, sourceHash: "a".repeat(64), parameters,
      entryCount: 1, changedEntryCount: 1, snapshotVersionBefore: 1, snapshotVersionAfter: 2, changedAt: "2026-09-04T07:00:00Z" };
    expect(classStartDrawResponseSchema.safeParse(receipt).success).toBe(true);
    for (const invalid of [{ changedEntryCount: 0 }, { changedEntryCount: 2 }, { snapshotVersionAfter: 1 }]) {
      expect(classStartDrawResponseSchema.safeParse({ ...receipt, ...invalid }).success).toBe(false);
    }
  });
});
