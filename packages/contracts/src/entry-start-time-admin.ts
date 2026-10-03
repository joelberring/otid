import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
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

export const entryStartTimeAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(/^otid_org_entry_start_time_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/)
}).strict();
export const entryStartTimeAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, capability: z.literal("CHANGE_ENTRY_START_TIME"),
  expiresAt: z.iso.datetime({ offset: true })
}).strict();
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
  expectedSnapshotVersion: version, expectedFixedStartTime: fixedStartTimeSchema.nullable(),
  fixedStartTime: fixedStartTimeSchema
}).strict();
export const entryStartTimeChangeIdempotencyKeySchema = z.string().regex(
  /^entry-start-time-change:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
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
export type EntryStartTimeAdminLoginRequest = z.infer<typeof entryStartTimeAdminLoginRequestSchema>;
export type EntryStartTimeAdminListResponse = z.infer<typeof entryStartTimeAdminListResponseSchema>;
export type EntryStartTimeChangeRequest = z.infer<typeof entryStartTimeChangeRequestSchema>;
export type EntryStartTimeChangeResponse = z.infer<typeof entryStartTimeChangeResponseSchema>;
