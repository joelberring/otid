import { z } from "zod";
import { fixedStartTimeSchema } from "./entry-start-time-admin";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const fields = {
  CLASS: ["CLASS"], TRANSFER: ["CLASS", "START_TIME"], CARD: ["CARD"], START_TIME: ["START_TIME"],
  IDENTITY: ["GIVEN_NAME", "FAMILY_NAME", "ORGANISATION"],
  REGISTRATION: ["CLASS", "START_TIME", "CARD", "GIVEN_NAME", "FAMILY_NAME", "ORGANISATION"],
  RENTAL: ["RENTAL"], RENTAL_RETURN: ["RENTAL_RETURN"], RENTAL_REUSE: ["RENTAL_REUSE", "CARD"]
} as const;
const change = z.object({
  field: z.enum(["CLASS", "START_TIME", "CARD", "GIVEN_NAME", "FAMILY_NAME", "ORGANISATION", "RENTAL", "RENTAL_RETURN", "RENTAL_REUSE"]),
  before: z.string().min(1).max(321).nullable(), after: z.string().min(1).max(321).nullable()
}).strict().refine(value => value.field !== "START_TIME" || [value.before, value.after].every(
  instant => instant === null || fixedStartTimeSchema.safeParse(instant).success
)).refine(value => !["RENTAL", "RENTAL_RETURN"].includes(value.field) ||
  (value.before !== value.after && [value.before, value.after].every(state => state === "true" || state === "false"))
).refine(value => value.field !== "RENTAL_REUSE" ||
  (value.before === "RETURNED_RENTAL" && value.after === "GIVEN_AWAY") ||
  (value.before === "NO_ACTIVE_CARD" && value.after === "RECEIVED_NOT_RETURNED")
);
export const administratorEntryChangeSchema = z.object({
  kind: z.enum(["CLASS", "TRANSFER", "CARD", "START_TIME", "IDENTITY", "REGISTRATION", "RENTAL", "RENTAL_RETURN", "RENTAL_REUSE"]),
  requestId: uuid, changedAt: z.iso.datetime({ offset: true }), entryVersionAfter: version,
  snapshotVersionAfter: version, changes: z.array(change).min(1).max(6)
}).strict().refine(value => {
  const expected = fields[value.kind];
  return expected.length === value.changes.length &&
    expected.every(field => value.changes.filter(row => row.field === field).length === 1) &&
    (value.kind === "REGISTRATION" ? value.entryVersionAfter === 1 && value.changes.every(row => row.before === null) : value.entryVersionAfter > 1);
});
export const administratorEntryChangesResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, entryId: uuid, entryVersion: version, snapshotVersion: version,
  generatedAt: z.iso.datetime({ offset: true }), timeZone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("sv-SE", { timeZone: value }); return true; } catch { return false; }
  }), items: z.array(administratorEntryChangeSchema).max(20), nextBeforeVersion: version.nullable()
}).strict().refine(value => new Set(value.items.map(item => `${item.kind}:${item.requestId}`)).size === value.items.length && value.items.every((item, index) =>
  item.entryVersionAfter <= value.entryVersion && item.snapshotVersionAfter <= value.snapshotVersion &&
  (index === 0 || item.entryVersionAfter < value.items[index - 1]!.entryVersionAfter)
) && (value.nextBeforeVersion === null || (value.items.length === 20 &&
  value.nextBeforeVersion === value.items.at(-1)?.entryVersionAfter && value.nextBeforeVersion > 1)));

export type AdministratorEntryChangesResponse = z.infer<typeof administratorEntryChangesResponseSchema>;
export type AdministratorEntryChange = z.infer<typeof administratorEntryChangeSchema>;
