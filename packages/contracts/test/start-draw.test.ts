import { describe, expect, it } from "vitest";
import { startDrawIdempotencyKeySchema, startDrawPreviewRequestSchema, startDrawPreviewResponseSchema, startDrawRequestSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const settings = { formatVersion: 1, expectedSnapshotVersion: 3, firstStartTime: "2026-10-08T08:00:00.000Z", clubSeparation: true,
  classes: [{ classId: id, method: "MINUTE", intervalMinutes: 2, vacancies: { kind: "COUNT", value: 1 } }] };

describe("lottningens kontrakt (PLAN.md steg 9)", () => {
  it("kräver hel minut, giltigt intervall, giltiga vakanser och unika klasser", () => {
    expect(startDrawPreviewRequestSchema.safeParse(settings).success).toBe(true);
    for (const change of [{ firstStartTime: "2026-10-08T08:00:30.000Z" }, { firstStartTime: "2026-10-08T10:00" },
      { classes: [] }, { classes: [settings.classes[0], settings.classes[0]] },
      { classes: [{ ...settings.classes[0], intervalMinutes: 0 }] },
      { classes: [{ ...settings.classes[0], vacancies: { kind: "PERCENT", value: 101 } }] },
      { classes: [{ ...settings.classes[0], method: "CHASE" }] }]) {
      expect(startDrawPreviewRequestSchema.safeParse({ ...settings, ...change }).success).toBe(false);
    }
  });

  it("binder sparandet till frö, begäran-id och bekräftelse", () => {
    const request = { ...settings, requestId: other, seed: 42, confirmChanges: false };
    expect(startDrawRequestSchema.safeParse(request).success).toBe(true);
    expect(startDrawRequestSchema.safeParse({ ...request, seed: 0 }).success).toBe(false);
    expect(startDrawRequestSchema.safeParse({ ...request, confirmChanges: undefined }).success).toBe(false);
    expect(startDrawIdempotencyKeySchema.safeParse(`start-draw:${other}`).success).toBe(true);
    expect(startDrawIdempotencyKeySchema.safeParse(`class-start-draw:${other}`).success).toBe(false);
  });

  it("kräver bekräftelse när starttider ersätts", () => {
    const preview = { formatVersion: 1, raceId: id, snapshotVersion: 3, timeZone: "Europe/Stockholm", seed: 42,
      classes: [{ classId: id, className: "H21", method: "MINUTE", firstStartTime: "2026-10-08T08:00:00.000Z", intervalMinutes: 2,
        vacancyCount: 1, replacesStartTimes: true, slots: [{ startTime: "2026-10-08T08:00:00.000Z", entry: null }] }],
      startGroups: [], replacesStartTimes: true, readOutCount: 0, becomesOkCount: 0, becomesMispunchedCount: 0, unchangedCount: 0,
      notRecalculatedCount: 0, changes: [], requiresConfirmation: true };
    expect(startDrawPreviewResponseSchema.safeParse(preview).success).toBe(true);
    expect(startDrawPreviewResponseSchema.safeParse({ ...preview, requiresConfirmation: false }).success).toBe(false);
    expect(startDrawPreviewResponseSchema.safeParse({ ...preview, replacesStartTimes: false }).success).toBe(false);
  });
});
