import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * PLAN.md steg 41: självregistrering på tävlingsdagen. Utan inloggning skriver löparen eller gästen in sitt bricknummer och
 * sitt namn på den publika sidan. Bara när admin slagit på "Tillåt självregistrering på tävlingsdagen", tävlingen är
 * publicerad och det är tävlingsdagen i tävlingens tidszon; servern kontrollerar samma sak.
 */

/** Bricknummer: bara siffror, inom SPORTidents nummerserier (1–9 999 999). */
export const SELF_REGISTRATION_CARD_MAX = 9_999_999;
export const selfRegistrationCardSchema = z.string().trim().regex(/^[1-9][0-9]{0,6}$/)
  .refine(value => Number(value) <= SELF_REGISTRATION_CARD_MAX);

export const SELF_REGISTRATION_NAME_MAX = 60;
export const SELF_REGISTRATION_CLUB_MAX = 80;
const name = z.string().max(200);

export const selfRegistrationRequestSchema = z.object({
  formatVersion: z.literal(1),
  cardNumber: selfRegistrationCardSchema,
  givenName: name,
  familyName: name,
  club: z.string().max(200).nullable(),
  /** Fest: visningsnamn (smeknamn) som visas publikt; tomt = förnamn + efternamnets första bokstav. */
  displayName: z.string().max(200).nullable().optional(),
  /** Klassen (inte för en fest). */
  classId: uuid.optional(),
  /** Fälla mot robotar: ett dolt fält som en människa lämnar tomt. */
  website: z.string().max(200).optional()
}).strict();

export const selfRegistrationInfoResponseSchema = z.object({
  formatVersion: z.literal(1),
  open: z.boolean(),
  kind: z.enum(["PARTY", "RACE"]),
  /** Klasserna att välja bland (tom för en fest och när formuläret är stängt). */
  classes: z.array(z.object({ id: uuid, name: z.string().min(1).max(160) }).strict()).max(1000),
  /** Klubbar att föreslå (ur löpardatabasen), högst 2000. */
  clubs: z.array(z.string().min(1).max(200)).max(2000)
}).strict();

export const selfRegistrationErrorCodes = ["INVALID_REQUEST", "NOT_FOUND", "CLOSED", "CARD_TAKEN", "CLASS_FULL", "RATE_LIMITED",
  "FORBIDDEN", "INTERNAL_ERROR"] as const;

export const selfRegistrationResponseSchema = z.object({
  formatVersion: z.literal(1),
  cardNumber: selfRegistrationCardSchema,
  name: z.string().min(1).max(200),
  /** Fest: namnet som visas på fest-sidan och i baren. */
  displayName: z.string().min(1).max(40).optional(),
  className: z.string().min(1).max(160).optional()
}).strict();

export const selfRegistrationErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: z.enum(selfRegistrationErrorCodes),
  /** Vilka fält som är fel (INVALID_REQUEST). */
  fields: z.array(z.enum(["cardNumber", "givenName", "familyName", "club", "classId", "displayName"])).max(6).optional()
}).strict();

export type SelfRegistrationRequest = z.infer<typeof selfRegistrationRequestSchema>;
export type SelfRegistrationInfoResponse = z.infer<typeof selfRegistrationInfoResponseSchema>;
export type SelfRegistrationResponse = z.infer<typeof selfRegistrationResponseSchema>;
export type SelfRegistrationErrorCode = (typeof selfRegistrationErrorCodes)[number];
export type SelfRegistrationErrorResponse = z.infer<typeof selfRegistrationErrorResponseSchema>;
