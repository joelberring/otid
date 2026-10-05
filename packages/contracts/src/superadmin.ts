import { z } from "zod";
import { storedAccountEmailSchema } from "./account";
import { raceTypeSchema } from "./race-settings";

/** Superadmin (ADR-0172 beslut 2): översikt över konton och tävlingar, åtgärder och logg. */
const canonicalUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const instant = z.iso.datetime({ offset: true });
const reason = z.string().trim().min(1).max(500);
export const SUPERADMIN_LIST_LIMIT = 50;

export const superadminActionKindSchema = z.enum([
  "GRANT_SUPERADMIN", "REVOKE_SUPERADMIN", "HIDE_RACE", "UNHIDE_RACE", "DELETE_EVENT",
  "BLOCK_ACCOUNT", "UNBLOCK_ACCOUNT", "DELETE_ACCOUNT", "CREATE_RESET_LINK"
]);

export const superadminAccountSchema = z.object({
  accountId: uuid,
  email: storedAccountEmailSchema,
  displayName: z.string().trim().min(1).max(120),
  createdAt: instant,
  lastLoginAt: instant.nullable(),
  eventCount: z.number().int().min(0),
  blocked: z.boolean(),
  superadmin: z.boolean()
}).strict();

export const superadminRaceSchema = z.object({
  raceId: uuid,
  eventId: uuid,
  eventName: z.string().trim().min(1).max(160),
  raceName: z.string().trim().min(1).max(160),
  raceDate: z.iso.date(),
  raceType: raceTypeSchema,
  ownerEmail: storedAccountEmailSchema.nullable(),
  createdAt: instant,
  hidden: z.boolean()
}).strict();

export const superadminLogEntrySchema = z.object({
  id: uuid,
  createdAt: instant,
  actorLabel: z.string().min(1).max(254),
  action: superadminActionKindSchema,
  targetType: z.enum(["ACCOUNT", "EVENT", "RACE"]),
  targetLabel: z.string().min(1).max(320),
  reason: z.string().min(1).max(500)
}).strict();

export const superadminOverviewSchema = z.object({
  formatVersion: z.literal(1),
  accounts: z.array(superadminAccountSchema).max(SUPERADMIN_LIST_LIMIT),
  accountTotal: z.number().int().min(0),
  races: z.array(superadminRaceSchema).max(SUPERADMIN_LIST_LIMIT),
  raceTotal: z.number().int().min(0),
  log: z.array(superadminLogEntrySchema).max(SUPERADMIN_LIST_LIMIT)
}).strict();

export const superadminActionRequestSchema = z.discriminatedUnion("action", [
  z.object({ formatVersion: z.literal(1), action: z.enum(["HIDE_RACE", "UNHIDE_RACE"]), raceId: uuid, reason }).strict(),
  z.object({ formatVersion: z.literal(1), action: z.literal("DELETE_EVENT"), eventId: uuid, reason,
    confirmation: z.string().max(200) }).strict(),
  z.object({ formatVersion: z.literal(1), action: z.enum(["BLOCK_ACCOUNT", "UNBLOCK_ACCOUNT", "CREATE_RESET_LINK"]),
    accountId: uuid, reason }).strict(),
  z.object({ formatVersion: z.literal(1), action: z.literal("DELETE_ACCOUNT"), accountId: uuid, reason,
    confirmation: z.string().max(320) }).strict()
]);

export const superadminActionResponseSchema = z.object({
  formatVersion: z.literal(1),
  action: superadminActionKindSchema,
  /** Bara för CREATE_RESET_LINK: länken visas en gång och sparas inte i klartext. */
  resetUrl: z.string().url().optional(),
  resetExpiresAt: instant.optional()
}).strict();

export type SuperadminActionKind = z.infer<typeof superadminActionKindSchema>;
export type SuperadminOverview = z.infer<typeof superadminOverviewSchema>;
export type SuperadminActionRequest = z.infer<typeof superadminActionRequestSchema>;
export type SuperadminActionResponse = z.infer<typeof superadminActionResponseSchema>;
