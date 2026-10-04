import { z } from "zod";
import { courseVariantCodeSchema } from "./course-edit";
import { newEntryCardNumberSchema } from "./entry-card-admin";

/**
 * Stafett (ADR-0169 beslut 3): stafettklass med sträckor, lag med sträcklöpare,
 * byte av sträcklöpare, start- och omstartstider, lagvy och publika lagresultat.
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const count = z.number().int().nonnegative().max(10_000);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const milliseconds = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const name = z.string().trim().min(1).max(160);
const person = z.string().trim().min(1).max(160);
const club = z.string().trim().min(1).max(200).nullable();
const card = newEntryCardNumberSchema.nullable();
const legNumber = z.number().int().min(1).max(20);
const teamNumber = z.number().int().min(1).max(99_999);
const resultStatus = z.enum(["OK", "MP", "DSQ", "DNF", "OOC", "NT", "DNS"]);

export const relayStartMethodSchema = z.enum(["MASS_START", "CHANGEOVER", "RESTART"]);
export const relayTeamStatusSchema = z.enum(["OK", "MP", "DSQ", "DNF", "OOC", "NT", "DNS", "RUNNING"]);

export const relayLegSettingSchema = z.object({
  leg: legNumber, startMethod: relayStartMethodSchema, startTime: instant.nullable(), variantCode: courseVariantCodeSchema.nullable()
}).strict().refine(value => (value.startMethod === "CHANGEOVER") === (value.startTime === null), "Masstart och omstart kräver en tid");

const legs = z.array(relayLegSettingSchema).min(2).max(20).refine(value => value.every((leg, index) => leg.leg === index + 1) &&
  value[0]?.startMethod === "MASS_START", "Sträckorna numreras 1..n och sträcka 1 är masstart");

export const relayClassCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version, name, courseId: uuid, legs
}).strict();
export const relayClassCreateIdempotencyKeySchema = z.string().regex(/^relay-class:[0-9a-f-]{36}$/);
export const relayClassCreateResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, classId: uuid,
  request: relayClassCreateRequestSchema, snapshotVersionAfter: version, createdAt: instant
}).strict();

export const relayRunnerSchema = z.object({ givenName: person, familyName: person, organisationName: club, cardNumber: card }).strict();

export const relayTeamCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version, classId: uuid,
  /** null = nästa lediga lagnummer. */
  number: teamNumber.nullable(), name, organisationName: club, runners: z.array(relayRunnerSchema).min(2).max(20)
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
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version, teamId: uuid, leg: legNumber,
  expectedEntryVersion: version, runner: relayRunnerSchema
}).strict();
export const relayLegRunnerIdempotencyKeySchema = z.string().regex(/^relay-leg-runner:[0-9a-f-]{36}$/);
export const relayLegRunnerResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, teamId: uuid, leg: legNumber, entryId: uuid,
  request: relayLegRunnerRequestSchema, recalculatedCount: count, snapshotVersionAfter: version, changedAt: instant
}).strict();

export const relayStartTimesRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version, classId: uuid,
  legs: z.array(z.object({ leg: legNumber, startTime: instant }).strict()).min(1).max(20)
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
  elapsedMs: milliseconds.nullable(), restarted: z.boolean()
}).strict();

/** Lagvyn i arbetsytan: stafettklasser med sträckor och lag med sträcklöpare, bricka och status. */
export const relayOverviewSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version, timeZone: z.string().min(1).max(100),
  classes: z.array(z.object({
    id: uuid, name, courseId: uuid, courseName: name, courseVariants: z.array(courseVariantCodeSchema).max(100),
    legs: z.array(relayLegSettingSchema).min(2).max(20), teamCount: count
  }).strict()).max(1000),
  teams: z.array(z.object({
    id: uuid, classId: uuid, number: teamNumber, name, organisationName: z.string().max(200).nullable(),
    status: relayTeamStatusSchema, elapsedMs: milliseconds.nullable(), position: z.number().int().positive().nullable(),
    currentLeg: legNumber.nullable(), legs: z.array(overviewLeg).max(20)
  }).strict()).max(10_000)
}).strict();

const publicLeg = z.object({
  leg: legNumber, givenName: z.string().max(160), familyName: z.string().max(160), organisationName: z.string().max(240).nullable(),
  publicResultId: uuid, status: resultStatus.nullable(), elapsedMs: milliseconds.nullable(),
  legPosition: z.number().int().positive().nullable(), restarted: z.boolean(), variantCode: courseVariantCodeSchema.nullable()
}).strict();

/** Publika stafettresultat: lagresultat per klass med sträckorna och sträckresultat per sträcka. */
export const publicRelayResultsSchema = z.object({
  formatVersion: z.literal(1),
  classes: z.array(z.object({
    name, legCount: legNumber,
    teams: z.array(z.object({
      number: teamNumber, name, organisationName: z.string().max(200).nullable(), status: relayTeamStatusSchema,
      elapsedMs: milliseconds.nullable(), position: z.number().int().positive().nullable(), timeBehindMs: milliseconds.nullable(),
      currentLeg: legNumber.nullable(), legs: z.array(publicLeg).max(20)
    }).strict()).max(10_000),
    legs: z.array(z.object({
      leg: legNumber,
      results: z.array(z.object({
        position: z.number().int().positive().nullable(), timeBehindMs: milliseconds.nullable(), givenName: z.string().max(160),
        familyName: z.string().max(160), teamNumber, teamName: name, status: resultStatus, elapsedMs: milliseconds.nullable()
      }).strict()).max(10_000)
    }).strict()).max(20)
  }).strict()).max(1000)
}).strict();

/**
 * Stafettdelen i avläsningspaketet: sträckornas startsätt, lagen och sträckresultaten som
 * servern kände till när paketet hämtades. Avläsningsvyn räknar sträckans start och lagets
 * tid lokalt, även utan nät.
 */
export const relayReadoutSchema = z.object({
  classes: z.array(z.object({ classId: uuid, legs: z.array(z.object({
    leg: legNumber, startMethod: relayStartMethodSchema, startTime: z.iso.datetime({ offset: true }).nullable() }).strict()).min(2).max(20)
  }).strict()).max(1000),
  teams: z.array(z.object({ id: uuid, classId: uuid, number: teamNumber, name,
    legs: z.array(z.object({ leg: legNumber, entryId: uuid }).strict()).max(20) }).strict()).max(10_000),
  legResults: z.array(z.object({ entryId: uuid, status: resultStatus, finishTime: z.iso.datetime({ offset: true }).nullable(),
    elapsedMs: milliseconds.nullable() }).strict()).max(10_000)
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
