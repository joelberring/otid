import { describe, expect, it } from "vitest";
import { startDrawIdempotencyKeySchema, startDrawPreviewRequestSchema, startDrawPreviewResponseSchema, startDrawRequestSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const settings = { formatVersion: 1, firstStartTime: "2026-10-08T08:00:00.000Z", clubSeparation: true,
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
      startGroups: [], warnings: [], existingClasses: [], timeline: [], replacesStartTimes: true, readOutCount: 0, becomesOkCount: 0, becomesMispunchedCount: 0, unchangedCount: 0,
      notRecalculatedCount: 0, changes: [], requiresConfirmation: true };
    expect(startDrawPreviewResponseSchema.safeParse(preview).success).toBe(true);
    expect(startDrawPreviewResponseSchema.safeParse({ ...preview, requiresConfirmation: false }).success).toBe(false);
    expect(startDrawPreviewResponseSchema.safeParse({ ...preview, replacesStartTimes: false }).success).toBe(false);
  });

  it("tar emot avancerade regler, senare start och seedning (PLAN.md steg 26)", () => {
    const rules = { groupControls: 2, maxPerMinute: 4, maxPerMinutePerPen: 2, lastStartTime: "2026-10-08T09:00:00.000Z",
      seeding: "SPREAD", classOrder: [id] };
    const advanced = { ...settings, rules, seeds: [{ entryId: other, rank: 1 }],
      classes: [{ ...settings.classes[0], laterStart: { kind: "OFFSET", minutes: 30 } }] };
    expect(startDrawPreviewRequestSchema.safeParse(advanced).success).toBe(true);
    expect(startDrawPreviewRequestSchema.safeParse({ ...advanced, classes: [{ ...settings.classes[0],
      laterStart: { kind: "CLOCK", startTime: "2026-10-08T08:30:00.000Z" } }] }).success).toBe(true);
    for (const change of [{ rules: { ...rules, groupControls: 4 } }, { rules: { ...rules, maxPerMinute: 0 } },
      { rules: { ...rules, lastStartTime: "2026-10-08T09:00:30.000Z" } }, { rules: { ...rules, seeding: "FIRST" } },
      { seeds: [{ entryId: other, rank: 0 }] }, { seeds: [{ entryId: other, rank: 1 }, { entryId: other, rank: 2 }] },
      { classes: [{ ...settings.classes[0], laterStart: { kind: "OFFSET", minutes: 0 } }] }]) {
      expect(startDrawPreviewRequestSchema.safeParse({ ...advanced, ...change }).success).toBe(false);
    }
  });
});
