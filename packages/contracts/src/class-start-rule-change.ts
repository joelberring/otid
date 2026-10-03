import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const startRule = z.enum(["FIXED", "PUNCH"]);
const utcMilliseconds = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(
  (value) => Number(value.slice(0, 4)) >= 1 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
);

export const classStartRuleChangeRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  expectedSnapshotVersion: version,
  expectedStartRule: startRule,
  startRule,
  reason: z.string().trim().min(1).max(500)
}).strict();

export const classStartRuleChangeResponseSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  raceId: uuid,
  classId: uuid,
  previousStartRule: startRule,
  startRule,
  snapshotVersionBefore: version,
  snapshotVersionAfter: version,
  entryCount: z.number().int().min(0).max(10000),
  clearedStartTimes: z.number().int().min(0).max(10000),
  changed: z.boolean(),
  changedAt: utcMilliseconds
}).strict().superRefine((value, context) => {
  if (value.clearedStartTimes > value.entryCount) {
    context.addIssue({ code: "custom", path: ["clearedStartTimes"], message: "Får inte överstiga deltagarantalet" });
  }
  if (!value.changed) {
    if (value.previousStartRule !== value.startRule) {
      context.addIssue({ code: "custom", path: ["startRule"], message: "Oförändrat svar måste behålla startregeln" });
    }
    if (value.snapshotVersionAfter !== value.snapshotVersionBefore) {
      context.addIssue({ code: "custom", path: ["snapshotVersionAfter"], message: "Oförändrat svar får inte öka snapshotversionen" });
    }
    if (value.clearedStartTimes !== 0) {
      context.addIssue({ code: "custom", path: ["clearedStartTimes"], message: "Oförändrat svar får inte tömma starttider" });
    }
  } else {
    if (value.previousStartRule === value.startRule) {
      context.addIssue({ code: "custom", path: ["startRule"], message: "Ändrat svar måste byta startregel" });
    }
    if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1) {
      context.addIssue({ code: "custom", path: ["snapshotVersionAfter"], message: "Ändrat svar måste öka snapshotversionen exakt ett steg" });
    }
  }
});

export type ClassStartRuleChangeRequest = z.infer<typeof classStartRuleChangeRequestSchema>;
export type ClassStartRuleChangeResponse = z.infer<typeof classStartRuleChangeResponseSchema>;

export const classStartRulePreviewSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, classId: uuid, className: z.string().min(1).max(256),
  snapshotVersion: version, startRule, entryCount: z.number().int().min(0).max(10000),
  fixedStartTimeCount: z.number().int().min(0).max(10000),
  entriesWithResults: z.number().int().min(0).max(10000), generatedAt: utcMilliseconds
}).strict().refine(value => value.fixedStartTimeCount <= value.entryCount && value.entriesWithResults <= value.entryCount,
  "Antalet berörda får inte överstiga deltagarantalet");
export type ClassStartRulePreview = z.infer<typeof classStartRulePreviewSchema>;
