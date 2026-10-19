import { z } from "zod";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";
const version = z.number().int().positive().max(2_147_483_647);
export const classMaxEntriesSchema = z.number().int().min(0).max(10_000).nullable();
export const classCapacityRequestSchema = z.object({ formatVersion: z.literal(1),
  expectedCapacityVersion: version, expectedMaxEntries: classMaxEntriesSchema, maxEntries: classMaxEntriesSchema
}).strict().refine(value => value.expectedMaxEntries !== value.maxEntries);
export const classCapacityKeySchema = z.string().regex(prefixedUuidPattern("class-capacity"));
export const classCapacityResponseSchema = z.object({ formatVersion: z.literal(1), replayed: z.boolean(),
  requestId: uuid, raceId: uuid, classId: uuid, previousMaxEntries: classMaxEntriesSchema, maxEntries: classMaxEntriesSchema,
  versionBefore: version, versionAfter: version, entryCount: z.number().int().min(0), changedAt: z.iso.datetime({ offset: true })
}).strict().refine(value => value.previousMaxEntries !== value.maxEntries && value.versionAfter === value.versionBefore + 1 &&
  (value.maxEntries === null || value.entryCount <= value.maxEntries));
export type ClassCapacityRequest = z.infer<typeof classCapacityRequestSchema>;
