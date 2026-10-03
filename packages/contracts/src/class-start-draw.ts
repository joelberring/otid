import { z } from "zod";
import { fixedStartTimeSchema } from "./entry-start-time-admin";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().min(1).max(10_000);
const seed = z.number().int().min(1).max(4_294_967_295);
const algorithm = z.literal("xorshift32-fisher-yates-v1");
const instant = fixedStartTimeSchema.refine(value => Date.parse(value) >= -62_135_596_800_000 && Date.parse(value) <= 253_402_300_799_999);
const timeZone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("sv-SE", { timeZone: value }); return true; } catch { return false; }
});

export const classStartDrawParametersSchema = z.object({
  algorithmVersion: algorithm, seed, firstStartTime: instant,
  intervalSeconds: z.number().int().min(1).max(3_600)
}).strict();
export const classStartDrawAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1), accessCredential: z.string().regex(/^otid_org_class_start_draw_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/)
}).strict();
export const classStartDrawAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, capability: z.literal("DRAW_CLASS_START_TIMES"), expiresAt: instant
}).strict();
export const classStartDrawClassesResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version, timeZone, seed,
  classes: z.array(z.object({ id: uuid, name: z.string().min(1).max(160), entryCount: z.number().int().min(0).max(10_000) }).strict()).max(1_000)
}).strict().refine(value => new Set(value.classes.map(item => item.id)).size === value.classes.length);
export const classStartDrawPreviewRequestSchema = z.object({
  formatVersion: z.literal(1), classId: uuid, parameters: classStartDrawParametersSchema
}).strict();
export const classStartDrawRequestSchema = z.object({
  formatVersion: z.literal(1), classId: uuid, parameters: classStartDrawParametersSchema,
  expectedSnapshotVersion: version, sourceHash: hash
}).strict();
export const classStartDrawIdempotencyKeySchema = z.string().regex(/^class-start-draw:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const classStartDrawPreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, classId: uuid, className: z.string().min(1).max(160),
  snapshotVersion: version, sourceHash: hash, timeZone, parameters: classStartDrawParametersSchema,
  entries: z.array(z.object({ entryId: uuid, entryVersion: version, displayName: z.string().min(1).max(321),
    previousFixedStartTime: instant.nullable(), fixedStartTime: instant, changed: z.boolean()
  }).strict()).min(1).max(10_000)
}).strict().superRefine((value, context) => {
  if (new Set(value.entries.map(entry => entry.entryId)).size !== value.entries.length) context.addIssue({ code: "custom", message: "Dubbla deltagare" });
  const first = Date.parse(value.parameters.firstStartTime);
  if (value.entries.some((entry, index) => Date.parse(entry.fixedStartTime) !== first + index * value.parameters.intervalSeconds * 1_000 ||
    entry.changed !== (entry.previousFixedStartTime !== entry.fixedStartTime))) {
    context.addIssue({ code: "custom", message: "Startplanen stämmer inte med parametrarna" });
  }
});
export const classStartDrawResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, requestId: uuid, replayed: z.boolean(), classId: uuid,
  sourceHash: hash, parameters: classStartDrawParametersSchema, entryCount: count, changedEntryCount: count,
  snapshotVersionBefore: version, snapshotVersionAfter: version, changedAt: instant
}).strict().refine(value => value.changedEntryCount <= value.entryCount && value.snapshotVersionAfter === value.snapshotVersionBefore + 1);
export { entryClassAdminErrorResponseSchema as classStartDrawAdminErrorResponseSchema } from "./entry-class-admin";
export type ClassStartDrawParameters = z.infer<typeof classStartDrawParametersSchema>;
export type ClassStartDrawClassesResponse = z.infer<typeof classStartDrawClassesResponseSchema>;
export type ClassStartDrawPreviewRequest = z.infer<typeof classStartDrawPreviewRequestSchema>;
export type ClassStartDrawPreviewResponse = z.infer<typeof classStartDrawPreviewResponseSchema>;
export type ClassStartDrawRequest = z.infer<typeof classStartDrawRequestSchema>;
export type ClassStartDrawResponse = z.infer<typeof classStartDrawResponseSchema>;
