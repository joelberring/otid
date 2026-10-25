import { z } from "zod";
import { courseVariantCodeSchema } from "./course-edit";
import { newEntryCardNumberSchema } from "./entry-card-admin";
import { uuidSchema as uuid } from "./ids";

/**
 * Stafett (ADR-0169 beslut 3): stafettklass med sträckor, lag med sträcklöpare,
 * byte av sträcklöpare, start- och omstartstider, lagvy och publika lagresultat.
 */
const version = z.number().int().positive().max(2_147_483_647);
const count = z.number().int().nonnegative().max(10_000);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const milliseconds = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const name = z.string().trim().min(1).max(160);
const person = z.string().trim().min(1).max(160);
const club = z.string().trim().min(1).max(200).nullable();
const card = newEntryCardNumberSchema.nullable();
/** Steg 47: upp till 30 sträckor (25-manna ryms med marginal). */
const legNumber = z.number().int().min(1).max(30);
const MAX_LEGS = 30;
const teamNumber = z.number().int().min(1).max(99_999);
const resultStatus = z.enum(["OK", "OVERTIME", "MP", "DSQ", "DNF", "OOC", "NT", "DNS"]);

export const relayStartMethodSchema = z.enum(["MASS_START", "CHANGEOVER", "RESTART", "FLYING_RESTART"]);
/** Steg 47: placering av lag i omstart (SOFT TR 5.8.2 = AFTER_NORMAL) och utjämnad gaffling eller fulgaffling. */
export const relayRestartRankingSchema = z.enum(["AFTER_NORMAL", "BY_TIME"]);
export const relayForkingSchema = z.enum(["EVEN", "UNEVEN"]);
const restartAfter = z.number().int().min(1).max(720);
export const relayTeamStatusSchema = z.enum(["OK", "OVERTIME", "MP", "DSQ", "DNF", "OOC", "NT", "DNS", "RUNNING"]);

/**
 * En sträcka. Steg 47: `courseId` = sträckans egen bana (null = klassens), `restartAfterMinutes` = flygande omstarts
 * gräns efter ledarens växling. Båda kan utelämnas (null).
 */
export const relayLegSettingSchema = z.object({
  leg: legNumber, startMethod: relayStartMethodSchema, startTime: instant.nullable(), variantCode: courseVariantCodeSchema.nullable(),
  courseId: uuid.nullable().default(null), restartAfterMinutes: restartAfter.nullable().default(null)
}).strict()
  .refine(value => (value.startMethod === "CHANGEOVER" || value.startMethod === "FLYING_RESTART") === (value.startTime === null),
    "Masstart och omstart kräver en tid")
  .refine(value => (value.startMethod === "FLYING_RESTART") === (value.restartAfterMinutes !== null), "Flygande omstart kräver minuter");

const legs = z.array(relayLegSettingSchema).min(2).max(MAX_LEGS).refine(value => value.every((leg, index) => leg.leg === index + 1) &&
  value[0]?.startMethod === "MASS_START", "Sträckorna numreras 1..n och sträcka 1 är masstart");

export const relayClassCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, name, courseId: uuid, legs,
  restartRanking: relayRestartRankingSchema.default("AFTER_NORMAL"), forking: relayForkingSchema.default("EVEN")
}).strict();
export const relayClassCreateIdempotencyKeySchema = z.string().regex(/^relay-class:[0-9a-f-]{36}$/);
export const relayClassCreateResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, classId: uuid,
  request: relayClassCreateRequestSchema, snapshotVersionAfter: version, createdAt: instant
}).strict();

export const relayRunnerSchema = z.object({ givenName: person, familyName: person, organisationName: club, cardNumber: card }).strict();

export const relayTeamCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, classId: uuid,
  /** null = nästa lediga lagnummer. */
  number: teamNumber.nullable(), name, organisationName: club, runners: z.array(relayRunnerSchema).min(2).max(MAX_LEGS)
}).strict().refine(value => {
  const cards = value.runners.flatMap(runner => runner.cardNumber === null ? [] : [runner.cardNumber]);
  return new Set(cards).size === cards.length;
}, "Varje sträcka behöver en egen bricka");
export const relayTeamCreateIdempotencyKeySchema = z.string().regex(/^relay-team:[0-9a-f-]{36}$/);
export const relayTeamCreateResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, teamId: uuid, number: teamNumber,
  request: relayTeamCreateRequestSchema, snapshotVersionAfter: version, createdAt: instant
}).strict();

export const relayLegRunnerRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, teamId: uuid, leg: legNumber,
  expectedEntryVersion: version, runner: relayRunnerSchema
}).strict();
export const relayLegRunnerIdempotencyKeySchema = z.string().regex(/^relay-leg-runner:[0-9a-f-]{36}$/);
export const relayLegRunnerResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, teamId: uuid, leg: legNumber, entryId: uuid,
  request: relayLegRunnerRequestSchema, recalculatedCount: count, snapshotVersionAfter: version, changedAt: instant
}).strict();

export const relayStartTimesRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, classId: uuid,
  legs: z.array(z.object({ leg: legNumber, startTime: instant }).strict()).min(1).max(MAX_LEGS)
}).strict();
export const relayStartTimesIdempotencyKeySchema = z.string().regex(/^relay-start-times:[0-9a-f-]{36}$/);
export const relayStartTimesResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, classId: uuid,
  request: relayStartTimesRequestSchema, recalculatedCount: count, snapshotVersionAfter: version, changedAt: instant
}).strict();

const overviewLeg = z.object({
  leg: legNumber, entryId: uuid, entryVersion: version, givenName: z.string().max(160), familyName: z.string().max(160),
  organisationName: z.string().max(240).nullable(), cardNumber: z.string().min(1).max(32).nullable(),
  variantCode: courseVariantCodeSchema.nullable(), startTime: instant.nullable(), status: resultStatus.nullable(),
  elapsedMs: milliseconds.nullable(), restarted: z.boolean(),
  /** Steg 47: sträckans måltid (växlingen ut) och om sträckan har ett resultat som går att ändra. */
  finishTime: instant.nullable(), hasResult: z.boolean(), resultRevision: z.number().int().min(0).max(2_147_483_647)
}).strict();

const fairnessPoint = z.union([z.literal("START"), z.literal("FINISH"), z.number().int().min(1).max(999)]);
const fairnessLeg = z.object({ from: fairnessPoint, to: fairnessPoint }).strict();

/** Lagvyn i arbetsytan: stafettklasser med sträckor och lag med sträcklöpare, bricka och status. */
export const relayOverviewSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version, timeZone: z.string().min(1).max(100),
  classes: z.array(z.object({
    id: uuid, name, courseId: uuid, courseName: name, courseVariants: z.array(courseVariantCodeSchema).max(100),
    legs: z.array(relayLegSettingSchema).min(2).max(MAX_LEGS), teamCount: count,
    /** Steg 47: inställningar, banan per sträcka med varianter, omstarterna och rättvisekontrollen per lag. */
    restartRanking: relayRestartRankingSchema, forking: relayForkingSchema,
    legCourses: z.array(z.object({ leg: legNumber, courseId: uuid, courseName: name,
      variants: z.array(courseVariantCodeSchema).max(100) }).strict()).max(MAX_LEGS),
    restarts: z.array(z.object({ leg: legNumber, time: instant.nullable(), leaderChangeover: instant.nullable(),
      leaderTeamNumber: teamNumber.nullable(), restartAfterMinutes: restartAfter.nullable() }).strict()).max(MAX_LEGS),
    unfairTeams: z.array(z.object({ teamId: uuid, missing: z.array(fairnessLeg).max(200), extra: z.array(fairnessLeg).max(200) }).strict())
      .max(10_000)
  }).strict()).max(1000),
  teams: z.array(z.object({
    id: uuid, classId: uuid, number: teamNumber, name, organisationName: z.string().max(200).nullable(),
    status: relayTeamStatusSchema, elapsedMs: milliseconds.nullable(), position: z.number().int().positive().nullable(),
    currentLeg: legNumber.nullable(), legs: z.array(overviewLeg).max(MAX_LEGS),
    /** Steg 47: laget har deltagit i en omstart; laget har något resultat (kan då bara strykas). */
    restarted: z.boolean(), hasResult: z.boolean()
  }).strict()).max(10_000)
}).strict();

const publicLeg = z.object({
  leg: legNumber, givenName: z.string().max(160), familyName: z.string().max(160), organisationName: z.string().max(240).nullable(),
  publicResultId: uuid, status: resultStatus.nullable(), elapsedMs: milliseconds.nullable(),
  legPosition: z.number().int().positive().nullable(), restarted: z.boolean(), variantCode: courseVariantCodeSchema.nullable(),
  /** Steg 47: sträckans bana när den inte är klassens. */
  courseName: z.string().max(160).nullable()
}).strict();

/** Publika stafettresultat: lagresultat per klass med sträckorna och sträckresultat per sträcka. */
export const publicRelayResultsSchema = z.object({
  formatVersion: z.literal(1),
  classes: z.array(z.object({
    name, legCount: legNumber,
    teams: z.array(z.object({
      number: teamNumber, name, organisationName: z.string().max(200).nullable(), status: relayTeamStatusSchema,
      elapsedMs: milliseconds.nullable(), position: z.number().int().positive().nullable(), timeBehindMs: milliseconds.nullable(),
      currentLeg: legNumber.nullable(), legs: z.array(publicLeg).max(MAX_LEGS), restarted: z.boolean()
    }).strict()).max(10_000),
    legs: z.array(z.object({
      leg: legNumber,
      results: z.array(z.object({
        position: z.number().int().positive().nullable(), timeBehindMs: milliseconds.nullable(), givenName: z.string().max(160),
        familyName: z.string().max(160), teamNumber, teamName: name, status: resultStatus, elapsedMs: milliseconds.nullable(),
        variantCode: courseVariantCodeSchema.nullable(), restarted: z.boolean()
      }).strict()).max(10_000)
    }).strict()).max(MAX_LEGS)
  }).strict()).max(1000)
}).strict();

/**
 * Stafettdelen i avläsningspaketet: sträckornas startsätt, lagen och sträckresultaten som
 * servern kände till när paketet hämtades. Avläsningsvyn räknar sträckans start och lagets
 * tid lokalt, även utan nät.
 */
export const relayReadoutSchema = z.object({
  classes: z.array(z.object({ classId: uuid, legs: z.array(z.object({
    leg: legNumber, startMethod: relayStartMethodSchema, startTime: z.iso.datetime({ offset: true }).nullable(),
    restartAfterMinutes: restartAfter.nullable().default(null) }).strict()).min(2).max(MAX_LEGS)
  }).strict()).max(1000),
  teams: z.array(z.object({ id: uuid, classId: uuid, number: teamNumber, name,
    legs: z.array(z.object({ leg: legNumber, entryId: uuid }).strict()).max(MAX_LEGS) }).strict()).max(10_000),
  legResults: z.array(z.object({ entryId: uuid, status: resultStatus, finishTime: z.iso.datetime({ offset: true }).nullable(),
    elapsedMs: milliseconds.nullable() }).strict()).max(10_000)
}).strict();

/** Steg 47: ändra stafettklassen (namn, sträckor, startsätt och tider, bana och variant per sträcka, inställningar). */
export const relayClassEditRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, classId: uuid, name, legs,
  restartRanking: relayRestartRankingSchema, forking: relayForkingSchema, confirmResultChanges: z.boolean()
}).strict();
export const relayClassEditIdempotencyKeySchema = z.string().regex(/^relay-class-edit:[0-9a-f-]{36}$/);
const statusChange = z.object({ displayName: z.string().min(1).max(400), leg: legNumber, teamNumber,
  before: z.enum(["OK", "OVERTIME", "MP", "UNKNOWN_CARD"]), after: z.enum(["OK", "OVERTIME", "MP", "UNKNOWN_CARD"]) }).strict();
/** Förhandsbeskedet i klartext: hur många avlästa som räknas om och vilka som byter status. */
export const relayClassEditPreviewSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, classId: uuid, readOutCount: count, recalculatedCount: count,
  changes: z.array(statusChange).max(10_000), addedLegs: z.array(legNumber).max(MAX_LEGS), removedLegs: z.array(legNumber).max(MAX_LEGS),
  requiresConfirmation: z.boolean()
}).strict();
export const relayClassEditResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, classId: uuid, request: relayClassEditRequestSchema,
  preview: relayClassEditPreviewSchema, recalculatedCount: count, snapshotVersionAfter: version, changedAt: instant
}).strict();

/** Steg 47: ändringen sparades inte. Förhandsbeskedet (bekräfta först) eller en borttagen sträcka med resultat. */
export const relayEditRefusalSchema = z.object({
  formatVersion: z.literal(1), error: z.enum(["CONFIRMATION_REQUIRED", "LEG_HAS_RESULT"]), preview: relayClassEditPreviewSchema.optional()
}).strict();

/** Steg 47: ändra lagets namn, klubb och nummer. */
export const relayTeamEditRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, teamId: uuid, number: teamNumber, name, organisationName: club
}).strict();
export const relayTeamEditIdempotencyKeySchema = z.string().regex(/^relay-team-edit:[0-9a-f-]{36}$/);
export const relayTeamEditResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, teamId: uuid, request: relayTeamEditRequestSchema,
  snapshotVersionAfter: version, changedAt: instant
}).strict();

/** Steg 47: ta bort ett lag utan resultat (DELETE) eller stryk ett lag med resultat (STRIKE). */
export const relayTeamRemovalRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, teamId: uuid, mode: z.enum(["DELETE", "STRIKE"])
}).strict();
export const relayTeamRemovalIdempotencyKeySchema = z.string().regex(/^relay-team-removal:[0-9a-f-]{36}$/);
export const relayTeamRemovalResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, teamId: uuid, request: relayTeamRemovalRequestSchema,
  outcome: z.enum(["DELETED", "STRUCK", "HAS_RESULT"]), savedAt: instant
}).strict();

/** Steg 47: hela laget ej start (sträckor utan resultat). */
export const relayTeamDidNotStartRequestSchema = z.object({ formatVersion: z.literal(1), requestId: uuid, teamId: uuid }).strict();
export const relayTeamDidNotStartIdempotencyKeySchema = z.string().regex(/^relay-team-dns:[0-9a-f-]{36}$/);
export const relayTeamDidNotStartResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, teamId: uuid,
  request: relayTeamDidNotStartRequestSchema, didNotStartCount: count, snapshotVersionAfter: version, changedAt: instant
}).strict();

/** Steg 47: byt variant på en sträcka för ett lag (lagkortet); en avläst sträcka räknas om. */
export const relayLegVariantRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, teamId: uuid, leg: legNumber, expectedEntryVersion: version,
  variantCode: courseVariantCodeSchema, confirmResultChanges: z.boolean()
}).strict();
export const relayLegVariantIdempotencyKeySchema = z.string().regex(/^relay-leg-variant:[0-9a-f-]{36}$/);
export const relayLegVariantResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, teamId: uuid, leg: legNumber,
  request: relayLegVariantRequestSchema, preview: relayClassEditPreviewSchema, recalculatedCount: count, snapshotVersionAfter: version,
  changedAt: instant
}).strict();

export type RelayLegSetting = z.infer<typeof relayLegSettingSchema>;
export type RelayClassCreateRequest = z.infer<typeof relayClassCreateRequestSchema>;
export type RelayClassCreateResponse = z.infer<typeof relayClassCreateResponseSchema>;
export type RelayRunner = z.infer<typeof relayRunnerSchema>;
export type RelayTeamCreateRequest = z.infer<typeof relayTeamCreateRequestSchema>;
export type RelayTeamCreateResponse = z.infer<typeof relayTeamCreateResponseSchema>;
export type RelayLegRunnerRequest = z.infer<typeof relayLegRunnerRequestSchema>;
export type RelayLegRunnerResponse = z.infer<typeof relayLegRunnerResponseSchema>;
export type RelayStartTimesRequest = z.infer<typeof relayStartTimesRequestSchema>;
export type RelayStartTimesResponse = z.infer<typeof relayStartTimesResponseSchema>;
export type RelayOverview = z.infer<typeof relayOverviewSchema>;
export type PublicRelayResults = z.infer<typeof publicRelayResultsSchema>;
export type RelayReadout = z.infer<typeof relayReadoutSchema>;
export type RelayClassEditRequest = z.infer<typeof relayClassEditRequestSchema>;
export type RelayClassEditPreview = z.infer<typeof relayClassEditPreviewSchema>;
export type RelayClassEditResponse = z.infer<typeof relayClassEditResponseSchema>;
export type RelayTeamEditRequest = z.infer<typeof relayTeamEditRequestSchema>;
export type RelayTeamEditResponse = z.infer<typeof relayTeamEditResponseSchema>;
export type RelayTeamRemovalRequest = z.infer<typeof relayTeamRemovalRequestSchema>;
export type RelayTeamRemovalResponse = z.infer<typeof relayTeamRemovalResponseSchema>;
export type RelayTeamDidNotStartRequest = z.infer<typeof relayTeamDidNotStartRequestSchema>;
export type RelayTeamDidNotStartResponse = z.infer<typeof relayTeamDidNotStartResponseSchema>;
export type RelayLegVariantRequest = z.infer<typeof relayLegVariantRequestSchema>;
export type RelayLegVariantResponse = z.infer<typeof relayLegVariantResponseSchema>;
export type RelayEditRefusal = z.infer<typeof relayEditRefusalSchema>;
