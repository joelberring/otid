import { z } from "zod";
import { newEntryCardNumberSchema } from "./entry-card-admin";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";

/**
 * PLAN.md steg 25: direktanmälan av en okänd bricka på avläsningssidan, även offline. Avläsningssidan köar begäran i
 * IndexedDB med eget begärans-id (idempotens) och skickar den före avläsningarna. Servern skapar deltagaren och
 * brickkopplingen, eller kopplar till den som redan har brickan (anmäld någon annanstans under tiden), och bedömer
 * brickans okända avläsning mot deltagaren. Funktionären får göra detta (ADR-0172 beslut 3).
 */
const name = z.string().trim().min(1).max(160);

export const readoutRegistrationRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  cardNumber: newEntryCardNumberSchema,
  classId: uuid,
  givenName: name,
  familyName: name,
  organisationName: z.string().trim().min(1).max(200).nullable()
}).strict();

export const readoutRegistrationIdempotencyKeySchema = z.string().regex(prefixedUuidPattern("readout-registration"));

const linkedResultStatus = z.enum(["OK", "OVERTIME", "MP"]);

export const readoutRegistrationResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: uuid,
  raceId: uuid,
  cardNumber: newEntryCardNumberSchema,
  /** CREATED: ny deltagare. EXISTING: brickan fanns redan anmäld; den deltagaren gäller. */
  outcome: z.enum(["CREATED", "EXISTING"]),
  entryId: uuid,
  entryName: z.string().trim().min(1).max(321),
  className: name,
  /** Brickans okända avläsning som bedömdes mot deltagaren, om servern redan hade den. */
  linkedResult: z.object({ status: linkedResultStatus, revision: z.number().int().positive() }).strict().nullable(),
  registeredAt: z.iso.datetime({ offset: true })
}).strict();

export type ReadoutRegistrationRequest = z.infer<typeof readoutRegistrationRequestSchema>;
export type ReadoutRegistrationResponse = z.infer<typeof readoutRegistrationResponseSchema>;
