import { z } from "zod";
import { fixedStartTimeSchema } from "./entry-start-time-admin";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const instant = fixedStartTimeSchema.refine(value => Date.parse(value) >= -62_135_596_800_000 && Date.parse(value) <= 253_402_300_799_999);
const timeZone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("sv-SE", { timeZone: value }); return true; } catch { return false; }
});

const slotSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("VACANT"), fixedStartTime: instant }).strict(),
  z.object({ state: z.literal("OCCUPIED"), fixedStartTime: instant,
    entry: z.object({ id: uuid, displayName: z.string().min(1).max(321) }).strict() }).strict()
]);

const availablePlanSchema = z.object({
  status: z.literal("AVAILABLE"), firstStartTime: instant,
  intervalSeconds: z.number().int().min(1).max(3_600), drawnAt: instant,
  slots: z.array(slotSchema).min(1).max(10_000),
  unassignedEntries: z.array(z.object({ id: uuid, displayName: z.string().min(1).max(321) }).strict()).max(10_000)
}).strict().superRefine((value, context) => {
  const first = Date.parse(value.firstStartTime);
  if (value.slots.some((slot, index) => Date.parse(slot.fixedStartTime) !== first + index * value.intervalSeconds * 1_000)) {
    context.addIssue({ code: "custom", message: "Planerade starttider följer inte sparad lottning" });
  }
  if (new Set(value.slots.map(slot => slot.fixedStartTime)).size !== value.slots.length ||
      new Set(value.slots.filter(slot => slot.state === "OCCUPIED").map(slot => slot.state === "OCCUPIED" ? slot.entry.id : "")).size !== value.slots.filter(slot => slot.state === "OCCUPIED").length ||
      new Set(value.unassignedEntries.map(entry => entry.id)).size !== value.unassignedEntries.length) {
    context.addIssue({ code: "custom", message: "Dubbla deltagare eller tider i startplanen" });
  }
});

const unavailablePlanSchema = z.object({
  status: z.literal("UNAVAILABLE"), reason: z.enum(["NO_SAVED_DRAW", "PLAN_CHANGED"])
}).strict();

export const fixedStartSlotPlanResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version, timeZone,
  classes: z.array(z.object({
    classId: uuid, className: z.string().min(1).max(160), entryCount: z.number().int().min(0).max(10_000),
    maxEntries: z.number().int().min(1).max(10_000).nullable(), capacityRemaining: z.number().int().min(0).max(10_000).nullable(),
    plan: z.union([availablePlanSchema, unavailablePlanSchema])
  }).strict()).max(1_000)
}).strict().superRefine((value, context) => {
  if (new Set(value.classes.map(item => item.classId)).size !== value.classes.length) {
    context.addIssue({ code: "custom", message: "Dubbla klasser" });
  }
  for (const item of value.classes) {
    if ((item.maxEntries === null) !== (item.capacityRemaining === null) ||
      (item.maxEntries !== null && item.capacityRemaining !== item.maxEntries - item.entryCount)) {
      context.addIssue({ code: "custom", message: "Klasskapaciteten är inkonsekvent" });
    }
  }
});

export type FixedStartSlotPlanResponse = z.infer<typeof fixedStartSlotPlanResponseSchema>;
