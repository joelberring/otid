import { z } from "zod";
import { storedAccountEmailSchema } from "./account";
import { raceTypeSchema } from "./race-settings";
import { UUID_SOURCE as canonicalUuidPattern } from "./ids";
import { raceNameSchema } from "./race-name";

/** Superadmin (ADR-0172 beslut 2): översikt över konton och tävlingar, åtgärder och logg. */
const uuid = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const instant = z.iso.datetime({ offset: true });
const reason = z.string().trim().min(1).max(500);
export const SUPERADMIN_LIST_LIMIT = 50;

export const superadminActionKindSchema = z.enum([
  "GRANT_SUPERADMIN", "REVOKE_SUPERADMIN", "HIDE_RACE", "UNHIDE_RACE", "DELETE_EVENT",
  "BLOCK_ACCOUNT", "UNBLOCK_ACCOUNT", "DELETE_ACCOUNT", "CREATE_RESET_LINK",
  /** ADR-0172 tillägg 2026-11-12: bekräftade kontots e-postadress (i appen eller med serverkommandot). */
  "VERIFY_EMAIL",
  /** Ägaren 2026-11-13: satte kontots egna gränser för kartlagring och laserrutor (migration 0118). */
  "SET_ACCOUNT_LIMITS"
]);

/** Kontots egna gränser; null = installationens förval. */
export const accountMapQuotaMbSchema = z.number().int().min(1).max(1_000_000).nullable();
export const accountGeoTilesPerMonthSchema = z.number().int().min(0).max(100_000).nullable();
/** Konton som använt minst så här stor andel av en gräns visas i listan "nära gränsen". */
export const SUPERADMIN_NEAR_LIMIT_SHARE = 0.7;

export const superadminAccountSchema = z.object({
  accountId: uuid,
  email: storedAccountEmailSchema,
  displayName: z.string().trim().min(1).max(120),
  createdAt: instant,
  lastLoginAt: instant.nullable(),
  eventCount: z.number().int().min(0),
  blocked: z.boolean(),
  superadmin: z.boolean(),
  /** Användartest 2026-11-12: om adressen är bekräftad (ADR-0186 beslut 9). */
  emailVerified: z.boolean(),
  /** Kontots egna gränser (null = förvalet), för att fylla i formuläret "Ändra gränser". */
  mapQuotaMb: accountMapQuotaMbSchema,
  geoTilesPerMonth: accountGeoTilesPerMonthSchema
}).strict();

/** Ett konto i listan över förbrukning: kartlagring och månadens laserrutor mot kontots gällande gränser. */
export const superadminAccountUsageSchema = z.object({
  accountId: uuid,
  email: storedAccountEmailSchema,
  displayName: z.string().trim().min(1).max(120),
  mapUsedBytes: z.number().int().min(0),
  /** Gällande gräns i byte (den egna eller förvalet); null = ingen gräns. */
  mapLimitBytes: z.number().int().min(0).nullable(),
  mapQuotaMb: accountMapQuotaMbSchema,
  geoTilesUsed: z.number().int().min(0),
  geoTilesLimit: z.number().int().min(0),
  geoTilesPerMonth: accountGeoTilesPerMonthSchema
}).strict();

export const superadminLimitsSchema = z.object({
  /** Installationens förval: lagring per konto i MB (null = ingen gräns) och laserrutor per månad. */
  defaultMapQuotaMb: z.number().int().min(1).nullable(),
  defaultGeoTilesPerMonth: z.number().int().min(0),
  /** All kartlagring på installationen mot dess gräns (null = ingen gräns). */
  totalUsedBytes: z.number().int().min(0),
  totalLimitBytes: z.number().int().min(0).nullable(),
  /** Konton nära en gräns eller med egna gränser, de som ligger närmast först. */
  accounts: z.array(superadminAccountUsageSchema).max(SUPERADMIN_LIST_LIMIT)
}).strict();

export const superadminRaceSchema = z.object({
  raceId: uuid,
  eventId: uuid,
  eventName: z.string().trim().min(1).max(160),
  raceName: raceNameSchema,
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
  log: z.array(superadminLogEntrySchema).max(SUPERADMIN_LIST_LIMIT),
  limits: superadminLimitsSchema
}).strict();

export const superadminActionRequestSchema = z.discriminatedUnion("action", [
  z.object({ formatVersion: z.literal(1), action: z.enum(["HIDE_RACE", "UNHIDE_RACE"]), raceId: uuid, reason }).strict(),
  z.object({ formatVersion: z.literal(1), action: z.literal("DELETE_EVENT"), eventId: uuid, reason,
    confirmation: z.string().max(200) }).strict(),
  z.object({ formatVersion: z.literal(1), action: z.enum(["BLOCK_ACCOUNT", "UNBLOCK_ACCOUNT", "CREATE_RESET_LINK", "VERIFY_EMAIL"]),
    accountId: uuid, reason }).strict(),
  z.object({ formatVersion: z.literal(1), action: z.literal("DELETE_ACCOUNT"), accountId: uuid, reason,
    confirmation: z.string().max(320) }).strict(),
  z.object({ formatVersion: z.literal(1), action: z.literal("SET_ACCOUNT_LIMITS"), accountId: uuid, reason,
    mapQuotaMb: accountMapQuotaMbSchema, geoTilesPerMonth: accountGeoTilesPerMonthSchema }).strict()
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
