import { z } from "zod";
import { newEntryCardNumberSchema } from "./entry-card-admin";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";
import { eventorIdSchema } from "./runner-database";

/**
 * PLAN.md steg 25: direktanmälan av en okänd bricka på avläsningssidan, även offline. Avläsningssidan köar begäran i
 * IndexedDB med eget begärans-id (idempotens) och skickar den före avläsningarna. Servern skapar deltagaren och
 * brickkopplingen, eller kopplar till den som redan har brickan (anmäld någon annanstans under tiden), och bedömer
 * brickans okända avläsning mot deltagaren. Funktionären får göra detta (ADR-0172 beslut 3).
 *
 * PLAN.md steg 29: namn och klubb kan komma ur löpardatabasen (då med Eventors id för IOF-exporten), och brickan kan
 * kopplas till en anmäld deltagare utan bricka eller utan avläsning (`target: "EXISTING_ENTRY"`).
 */
const name = z.string().trim().min(1).max(160);

const newEntryRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  cardNumber: newEntryCardNumberSchema,
  classId: uuid,
  givenName: name,
  familyName: name,
  organisationName: z.string().trim().min(1).max(200).nullable(),
  eventorPersonId: eventorIdSchema.optional(),
  eventorOrganisationId: eventorIdSchema.optional(),
  /** Steg 31 (B4): brickan har redan lästs ut för en annan anmäld (lånad bricka); den flyttas till den nya deltagaren. */
  borrowedCard: z.literal(true).optional()
}).strict();

const existingEntryRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  cardNumber: newEntryCardNumberSchema,
  target: z.literal("EXISTING_ENTRY"),
  entryId: uuid,
  /** Klassen som deltagaren hade i paketet; har den bytts sedan dess avvisas kopplingen. */
  expectedClassId: uuid,
  /** Steg 31 (B4): lånad bricka, se ovan. Är deltagaren den som redan läst ut gäller den nya avläsningen. */
  borrowedCard: z.literal(true).optional()
}).strict();

export const readoutRegistrationRequestSchema = z.union([newEntryRequestSchema, existingEntryRequestSchema]);

export const readoutRegistrationIdempotencyKeySchema = z.string().regex(prefixedUuidPattern("readout-registration"));

const linkedResultStatus = z.enum(["OK", "OVERTIME", "MP"]);

export const readoutRegistrationResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: uuid,
  raceId: uuid,
  cardNumber: newEntryCardNumberSchema,
  /**
   * CREATED: ny deltagare. EXISTING: brickan fanns redan anmäld; den deltagaren gäller. LINKED: brickan kopplades till
   * den valda anmälda deltagaren.
   */
  outcome: z.enum(["CREATED", "EXISTING", "LINKED"]),
  entryId: uuid,
  entryName: z.string().trim().min(1).max(321),
  className: name,
  /** Brickans okända avläsning som bedömdes mot deltagaren, om servern redan hade den. */
  linkedResult: z.object({ status: linkedResultStatus, revision: z.number().int().positive() }).strict().nullable(),
  registeredAt: z.iso.datetime({ offset: true })
}).strict();

export type ReadoutRegistrationRequest = z.infer<typeof readoutRegistrationRequestSchema>;
export type ReadoutNewEntryRequest = z.infer<typeof newEntryRequestSchema>;
export type ReadoutExistingEntryRequest = z.infer<typeof existingEntryRequestSchema>;
export type ReadoutRegistrationResponse = z.infer<typeof readoutRegistrationResponseSchema>;
