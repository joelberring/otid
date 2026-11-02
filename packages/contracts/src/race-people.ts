import { z } from "zod";
import { accountEmailSchema, storedAccountEmailSchema } from "./account";
import { UUID_SOURCE as canonicalUuidPattern } from "./ids";

/**
 * Personer med behörighet på tävlingen (ADR-0172 beslut 3): ägaren, administratörer och funktionärer.
 * ADR-0188 beslut 6: administratören lägger till en e-postadress; behörigheten gäller när personen loggar in med den.
 */
const canonicalUuidSchema = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const instantSchema = z.iso.datetime({ offset: true });

/**
 * Steg 66 (ADR-0181 beslut 5): banläggningens behörighet på just den här tävlingen – ändra (COURSE_EDIT), föreslå
 * (COURSE_SUGGEST) eller läsa och kommentera (COURSE_COMMENT). Den ger bara banläggningen, inte resten av tävlingen.
 * ADR-0181 beslut 8: kartritaren (COURSE_MAP) ser bara kartan och kartfelen, svarar och markerar dem klara.
 */
export const racePersonRoleSchema = z.enum(["OWNER", "ADMIN", "FUNCTIONARY", "COURSE_EDIT", "COURSE_SUGGEST", "COURSE_COMMENT", "COURSE_MAP"]);
/** Roller som kan läggas till. Ägaren finns från början och kan inte läggas till eller tas bort här. */
export const racePersonGrantableRoleSchema = z.enum(["ADMIN", "FUNCTIONARY", "COURSE_EDIT", "COURSE_SUGGEST", "COURSE_COMMENT", "COURSE_MAP"]);

export const racePersonSchema = z.object({
  grantId: canonicalUuidSchema,
  accountId: canonicalUuidSchema,
  email: storedAccountEmailSchema,
  displayName: z.string().trim().min(1).max(120),
  role: racePersonRoleSchema,
  grantedAt: instantSchema,
  /** ADR-0186: kontots e-postadress är inte bekräftad; behörigheten gäller först när den är det (ägaren alltid). */
  pendingVerification: z.boolean().optional()
}).strict();

/**
 * ADR-0188 beslut 6: en behörighet sparad för en e-postadress. Den gäller när personen loggar in med adressen (och har
 * bekräftat den); svaret är detsamma oavsett om adressen har ett konto.
 */
export const racePersonInvitationSchema = z.object({
  invitationId: canonicalUuidSchema,
  email: storedAccountEmailSchema,
  role: racePersonGrantableRoleSchema,
  invitedAt: instantSchema
}).strict();

export const racePeopleResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  /** Den inloggade: bara ägaren får lägga till och ta bort administratörer. */
  viewer: z.object({ accountId: canonicalUuidSchema, role: z.enum(["OWNER", "ADMIN"]) }).strict(),
  people: z.array(racePersonSchema).max(10_000),
  /** ADR-0188 beslut 6: sparade behörigheter som väntar på att personen loggar in med adressen. */
  invitations: z.array(racePersonInvitationSchema).max(1_000)
}).strict();

export const racePersonGrantIdempotencyKeySchema = z.string().regex(
  new RegExp(`^race-person-grant:${canonicalUuidPattern}$`),
  "Idempotency-Key måste vara race-person-grant:<kanoniskt request-uuid>"
);
export const racePersonRevokeIdempotencyKeySchema = z.string().regex(
  new RegExp(`^race-person-revoke:${canonicalUuidPattern}$`),
  "Idempotency-Key måste vara race-person-revoke:<kanoniskt request-uuid>"
);

export const racePersonGrantRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  email: accountEmailSchema,
  role: racePersonGrantableRoleSchema
}).strict();

export const racePersonGrantResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  /** ADR-0188 beslut 6: alltid en sparad behörighet för adressen, aldrig kontots namn. */
  invitation: racePersonInvitationSchema
}).strict();

export const racePersonRevokeRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  grantId: canonicalUuidSchema
}).strict();

export const racePersonRevokeResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  grantId: canonicalUuidSchema,
  revokedAt: instantSchema
}).strict();

export type RacePersonRole = z.infer<typeof racePersonRoleSchema>;
export type RacePerson = z.infer<typeof racePersonSchema>;
export type RacePeopleResponse = z.infer<typeof racePeopleResponseSchema>;
export type RacePersonGrantRequest = z.infer<typeof racePersonGrantRequestSchema>;
export type RacePersonGrantResponse = z.infer<typeof racePersonGrantResponseSchema>;
export type RacePersonRevokeRequest = z.infer<typeof racePersonRevokeRequestSchema>;
export type RacePersonRevokeResponse = z.infer<typeof racePersonRevokeResponseSchema>;
export type RacePersonInvitation = z.infer<typeof racePersonInvitationSchema>;
