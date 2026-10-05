import { z } from "zod";
import { accountEmailSchema, storedAccountEmailSchema } from "./account";

/**
 * Personer med behörighet på tävlingen (ADR-0172 beslut 3): ägaren, administratörer och funktionärer.
 * Administratören lägger till ett befintligt konto med dess e-postadress; inga inbjudningar eller koder.
 */
const canonicalUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const canonicalUuidSchema = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const instantSchema = z.iso.datetime({ offset: true });

export const racePersonRoleSchema = z.enum(["OWNER", "ADMIN", "FUNCTIONARY"]);
/** Roller som kan läggas till. Ägaren finns från början och kan inte läggas till eller tas bort här. */
export const racePersonGrantableRoleSchema = z.enum(["ADMIN", "FUNCTIONARY"]);

export const racePersonSchema = z.object({
  grantId: canonicalUuidSchema,
  accountId: canonicalUuidSchema,
  email: storedAccountEmailSchema,
  displayName: z.string().trim().min(1).max(120),
  role: racePersonRoleSchema,
  grantedAt: instantSchema
}).strict();

export const racePeopleResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  /** Den inloggade: bara ägaren får lägga till och ta bort administratörer. */
  viewer: z.object({ accountId: canonicalUuidSchema, role: z.enum(["OWNER", "ADMIN"]) }).strict(),
  people: z.array(racePersonSchema).max(10_000)
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
  person: racePersonSchema
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
