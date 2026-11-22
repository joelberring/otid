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
  "SET_ACCOUNT_LIMITS",
  /** ADR-0229: satte installationens gränser (mellanlagrets tak och kartlagringens totala gräns, migration 0133). */
  "SET_INSTALLATION_LIMITS",
  /** PLAN.md steg M3: beställde flytten av befintligt kartinnehåll till förrådet nu («Flytta nu»). */
  "MIGRATE_MAP_CONTENT_NOW",
  /** PLAN.md steg M7: satte klubbens gräns för eget material (migration 0140). */
  "SET_CLUB_LIMITS"
]);

/** Kontots egna gränser; null = installationens förval. */
export const accountMapQuotaMbSchema = z.number().int().min(1).max(1_000_000).nullable();
export const accountGeoTilesPerMonthSchema = z.number().int().min(0).max(100_000).nullable();
/** PLAN.md steg M7: klubbens gräns för eget material i MB; null = förvalet (2 048 MB). */
export const clubMapQuotaMbSchema = z.number().int().min(1).max(1_000_000).nullable();
/** ADR-0229: installationens gränser; null = förvalet. Totalgränsen 0 = ingen gräns. */
export const installationCacheMaxMbSchema = z.number().int().min(100).max(10_000_000).nullable();
export const installationMapQuotaTotalMbSchema = z.number().int().min(0).max(100_000_000).nullable();
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
  geoTilesPerMonth: accountGeoTilesPerMonthSchema,
  /** ADR-0229: kontots gräns för återskapbart innehåll (null = förvalet; används i PLAN.md steg M4). */
  regenerableQuotaMb: accountMapQuotaMbSchema
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
  geoTilesPerMonth: accountGeoTilesPerMonthSchema,
  regenerableQuotaMb: accountMapQuotaMbSchema
}).strict();

/** PLAN.md steg M7: en klubb och dess lagring (klubbarkivet) mot klubbens gällande gräns. */
export const superadminClubUsageSchema = z.object({
  clubId: uuid,
  name: z.string().trim().min(1).max(200),
  usedBytes: z.number().int().min(0),
  limitBytes: z.number().int().min(0),
  /** Klubbens egen gräns (null = förvalet). */
  mapQuotaMb: clubMapQuotaMbSchema
}).strict();

/** ADR-0229: förrådet och mellanlagret för installationen. */
export const superadminInstallationSchema = z.object({
  /** off = allt i databasen; on = nytt innehåll i förrådet; incomplete = på men uppgifterna eller mellanlagret saknas. */
  storeMode: z.enum(["off", "on", "incomplete"]),
  /** Mellanlagrets tak: inställningen (null = förvalet) och det gällande. */
  cacheMaxMb: installationCacheMaxMbSchema,
  cacheMaxMbDefault: z.number().int().min(1),
  /** Hur fullt mellanlagret är, eller null när katalogen inte går att läsa här. */
  cacheUsedBytes: z.number().int().min(0).nullable(),
  cacheFiles: z.number().int().min(0).nullable(),
  /** Hämtningar ur förrådet i dag och i går (svensk tid). */
  storeFetchesToday: z.number().int().min(0),
  storeFetchBytesToday: z.number().int().min(0),
  storeFetchesYesterday: z.number().int().min(0),
  /** Kartlagringens totala gräns: inställningen (null = förvalet ur miljön) och förvalet i MB (null = ingen gräns). */
  mapQuotaTotalMb: installationMapQuotaTotalMbSchema,
  mapQuotaTotalDefaultMb: z.number().int().min(0).nullable(),
  /** PLAN.md steg M2: gränsen för det fastspikade (null = förvalet) och förvalet i MB. */
  pinMaxMb: z.number().int().min(0).nullable(),
  pinMaxMbDefault: z.number().int().min(1),
  /** PLAN.md steg M4: dagar orört innan återskapbart tas bort ur förrådet (null = förvalet, 0 = av); saknas i äldre svar. */
  regenerableIdleDays: z.number().int().min(0).nullable().optional(),
  regenerableIdleDaysDefault: z.number().int().min(1).optional(),
  /**
   * Tävlingars och träningars kartor som är fastspikade från dagen före till dagen efter, och det av dem som saknas i
   * mellanlagret (`missingRaceDay`: något som saknas behövs av en tävling i dag). Null med förrådet av eller när
   * mellanlagret inte går att läsa här.
   */
  pinned: z.object({
    count: z.number().int().min(0), bytes: z.number().int().min(0), missing: z.number().int().min(0),
    missingBytes: z.number().int().min(0), missingRaceDay: z.boolean(), overLimit: z.boolean()
  }).strict().nullable(),
  /**
   * PLAN.md steg M3: flytten av befintligt innehåll ur databasen till förrådet – kvar i databasen, i förrådet, flyttat men med
   * delarna kvar tills fristen gått ut, om «Flytta nu» väntar, och senaste varvet. Null med förrådet av.
   */
  migration: z.object({
    enabled: z.boolean(),
    window: z.string().max(20),
    dbCount: z.number().int().min(0), dbBytes: z.number().int().min(0),
    storeCount: z.number().int().min(0), storeBytes: z.number().int().min(0),
    pendingCount: z.number().int().min(0), pendingBytes: z.number().int().min(0),
    requested: z.boolean(),
    raceDay: z.boolean(),
    last: z.object({
      at: instant, trigger: z.enum(["NIGHT", "MANUAL", "COMMAND"]),
      stopped: z.enum(["RACE_DAY", "WINDOW", "BUDGET", "BUSY"]).nullable(),
      moved: z.number().int().min(0), movedBytes: z.number().int().min(0), freed: z.number().int().min(0),
      freedBytes: z.number().int().min(0), failed: z.number().int().min(0), errors: z.array(z.string().max(200)).max(3)
    }).strict().nullable()
  }).strict().nullable()
}).strict();

export const superadminLimitsSchema = z.object({
  /** Installationens förval: lagring per konto i MB (null = ingen gräns) och laserrutor per månad. */
  defaultMapQuotaMb: z.number().int().min(1).nullable(),
  defaultGeoTilesPerMonth: z.number().int().min(0),
  /** ADR-0229: förvalet för återskapbart innehåll per konto i MB. */
  defaultRegenerableQuotaMb: z.number().int().min(1),
  installation: superadminInstallationSchema,
  /** All kartlagring på installationen mot dess gräns (null = ingen gräns). */
  totalUsedBytes: z.number().int().min(0),
  totalLimitBytes: z.number().int().min(0).nullable(),
  /** Konton nära en gräns eller med egna gränser, de som ligger närmast först. */
  accounts: z.array(superadminAccountUsageSchema).max(SUPERADMIN_LIST_LIMIT),
  /** PLAN.md steg M7: klubbarnas förval i MB och klubbarna, den som ligger närmast sin gräns först. */
  defaultClubMapQuotaMb: z.number().int().min(1),
  clubs: z.array(superadminClubUsageSchema).max(SUPERADMIN_LIST_LIMIT)
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
  targetType: z.enum(["ACCOUNT", "EVENT", "RACE", "INSTALLATION", "CLUB"]),
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
    mapQuotaMb: accountMapQuotaMbSchema, geoTilesPerMonth: accountGeoTilesPerMonthSchema,
    /** ADR-0229; saknas (äldre sida) = oförändrad. */
    regenerableQuotaMb: accountMapQuotaMbSchema.optional() }).strict(),
  z.object({ formatVersion: z.literal(1), action: z.literal("SET_INSTALLATION_LIMITS"), reason,
    cacheMaxMb: installationCacheMaxMbSchema, mapQuotaTotalMb: installationMapQuotaTotalMbSchema,
    /** PLAN.md steg M2; saknas (äldre sida) = oförändrad. */
    pinMaxMb: installationCacheMaxMbSchema.optional(),
    /** PLAN.md steg M4; saknas (äldre sida) = oförändrad, null = förvalet 90, 0 = av. */
    regenerableIdleDays: z.number().int().min(0).max(3650).nullable().optional() }).strict(),
  z.object({ formatVersion: z.literal(1), action: z.literal("MIGRATE_MAP_CONTENT_NOW"), reason }).strict(),
  z.object({ formatVersion: z.literal(1), action: z.literal("SET_CLUB_LIMITS"), clubId: uuid, reason, mapQuotaMb: clubMapQuotaMbSchema }).strict()
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
