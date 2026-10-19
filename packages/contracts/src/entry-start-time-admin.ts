import { z } from "zod";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";

const version = z.number().int().positive().max(2_147_483_647);
export const eventTimeZoneSchema = z.string().trim().min(1).max(100).refine((value) => {
  try { new Intl.DateTimeFormat("sv-SE", { timeZone: value }); return true; }
  catch { return false; }
});

export const fixedStartTimeSchema = z.iso.datetime({ offset: true }).refine((value) => {
  const match = /T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  return match[1] === "Z" || (Number(match[2]) <= 14 && Number(match[3]) <= 59 &&
    (Number(match[2]) < 14 || Number(match[3]) === 0));
}).transform((value) => new Date(value).toISOString());

export const entryStartTimeAdminListResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version, timeZone: eventTimeZoneSchema,
  entries: z.array(z.object({
    id: uuid, displayName: z.string().min(1).max(321),
    classId: uuid, className: z.string().min(1).max(160),
    version, fixedStartTime: fixedStartTimeSchema.nullable()
  }).strict()).max(10_000)
}).strict().refine((value) => new Set(value.entries.map((entry) => entry.id)).size === value.entries.length);

export const entryStartTimeChangeRequestSchema = z.object({
  formatVersion: z.literal(1), expectedEntryVersion: version, expectedClassId: uuid,
  expectedFixedStartTime: fixedStartTimeSchema.nullable(),
  fixedStartTime: fixedStartTimeSchema
}).strict();
export const entryStartTimeChangeIdempotencyKeySchema = z.string().regex(
  prefixedUuidPattern("entry-start-time-change")
);
export const entryStartTimeChangeResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid,
  entryId: uuid, classId: uuid, previousFixedStartTime: fixedStartTimeSchema.nullable(),
  fixedStartTime: fixedStartTimeSchema, entryVersionBefore: version, entryVersionAfter: version,
  snapshotVersionBefore: version, snapshotVersionAfter: version,
  changedAt: z.iso.datetime({ offset: true })
}).strict().refine((value) => value.previousFixedStartTime !== value.fixedStartTime &&
  value.entryVersionAfter === value.entryVersionBefore + 1 &&
  value.snapshotVersionAfter === value.snapshotVersionBefore + 1);

export { entryClassAdminErrorResponseSchema as entryStartTimeAdminErrorResponseSchema } from "./entry-class-admin";
export type { EntryClassAdminErrorCode as EntryStartTimeAdminErrorCode } from "./entry-class-admin";
export type EntryStartTimeAdminListResponse = z.infer<typeof entryStartTimeAdminListResponseSchema>;
export type EntryStartTimeChangeRequest = z.infer<typeof entryStartTimeChangeRequestSchema>;
export type EntryStartTimeChangeResponse = z.infer<typeof entryStartTimeChangeResponseSchema>;
