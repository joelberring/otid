import { z } from "zod";
import {
  eventCreationRequestSchema,
  eventCreationResponseSchema,
  type EventCreationResponse
} from "./event-creation";
import { raceTypeSchema } from "./race-settings";
import { accountEmailSchema, ACCOUNT_PASSWORD_MIN_LENGTH, storedAccountEmailSchema } from "./account";
import { UUID_SOURCE as canonicalUuidPattern } from "./ids";
import { raceNameSchema } from "./race-name";

const uuid = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const instant = z.iso.datetime({ offset: true });

/**
 * ADR-0205 tillägg: utan "Kom ihåg mig" gäller inloggningen tolv timmar (en tävlingsdag) och kakan är en sessionskaka som
 * webbläsaren glömmer när den stängs, för klubbens och tävlingens lånade datorer.
 */
export const SHORT_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** Inloggning med e-post och lösenord (ADR-0172 beslut 1). */
export const organizerAccountLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  email: accountEmailSchema,
  password: z.string().min(1).max(1024),
  /** ADR-0205 tillägg: "Kom ihåg mig på den här datorn" (lång session). Utan den en kort session och en sessionskaka. */
  remember: z.boolean().optional()
}).strict();

/** Öppen registrering (ADR-0172 beslut 1): e-post, namn och lösenord. */
export const organizerAccountRegistrationRequestSchema = z.object({
  formatVersion: z.literal(1),
  email: accountEmailSchema,
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(ACCOUNT_PASSWORD_MIN_LENGTH).max(1024)
}).strict();

export const organizerAccountLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  accountId: uuid,
  email: storedAccountEmailSchema,
  displayName: z.string().trim().min(1).max(120),
  superadmin: z.boolean(),
  expiresAt: instant,
  /** ADR-0186: om e-postadressen är bekräftad. Behörigheter som andra ger kontot gäller först då. Saknas i äldre svar. */
  emailVerified: z.boolean().optional()
}).strict();

/**
 * ADR-0186: registrering med e-post inställd. Samma svar oavsett om adressen redan har ett konto; länken kommer med e-post.
 * Utan e-post loggar registreringen in direkt (`organizerAccountLoginResponseSchema`, 201).
 */
export const organizerAccountRegistrationPendingSchema = z.object({
  formatVersion: z.literal(1),
  status: z.literal("check-email")
}).strict();

const verificationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * ADR-0186, ändrat av ADR-0205: länken i bekräftelsemejlet och lösenordet som personen väljer på sidan (samma som vid
 * registreringen eller ett nytt).
 */
export const emailVerificationRequestSchema = z.object({
  formatVersion: z.literal(1),
  token: verificationToken,
  password: z.string().min(ACCOUNT_PASSWORD_MIN_LENGTH).max(1024)
}).strict();

/** ADR-0205: vad länken leder till innan personen skriver något. */
export const emailVerificationCheckRequestSchema = z.object({ formatVersion: z.literal(1), token: verificationToken }).strict();
export const emailVerificationCheckResponseSchema = z.object({
  formatVersion: z.literal(1),
  state: z.enum(["valid", "already-verified", "invalid"])
}).strict();
export type EmailVerificationCheckResponse = z.infer<typeof emailVerificationCheckResponseSchema>;

/** GET /api/organizer/session utan inloggning: 200 med `authenticated: false` i stället för 401 (PLAN.md steg 22). */
export const organizerAccountSessionAbsentSchema = z.object({ formatVersion: z.literal(1), authenticated: z.literal(false) }).strict();
export const organizerAccountSessionStatusSchema = z.union([organizerAccountLoginResponseSchema, organizerAccountSessionAbsentSchema]);

export const organizerEventCreateIdempotencyKeySchema = z.string().regex(
  new RegExp(`^organizer-event-create:${canonicalUuidPattern}$`),
  "Idempotency-Key måste vara organizer-event-create:<kanoniskt request-uuid>"
);

// Keep the account-bound endpoint's intent and replay response identical to the
// established event-creation contract; authorization and idempotency scope differ.
// ADR-0170: arrangören väljer tävlingstyp när tävlingen skapas. Saknas typen blir det Tävling.
export const organizerEventCreateRequestSchema = eventCreationRequestSchema.extend({
  raceType: raceTypeSchema.default("STANDARD")
});
export const organizerEventCreateResponseSchema = eventCreationResponseSchema;

const organizerEventRaceSchema = z.object({
  raceId: uuid,
  raceName: raceNameSchema,
  raceDate: z.iso.date(),
  raceType: raceTypeSchema,
  /** Steg 66: behörighet för banläggningen på loppet (utan roll på eventet når kontot bara den). */
  courseSetting: z.enum(["EDIT", "SUGGEST", "COMMENT", "MAP"]).optional()
}).strict();

const organizerEventSchema = z.object({
  eventId: uuid,
  eventName: z.string().trim().min(1).max(160),
  /** FUNCTIONARY (ADR-0172 beslut 3): når bara avläsning, kvar i skogen, start och speaker. */
  role: z.enum(["OWNER", "ADMIN", "FUNCTIONARY", "COURSE_SETTER"]),
  startsOn: z.iso.date(),
  timeZone: z.string().trim().min(1).max(100),
  races: z.array(organizerEventRaceSchema).max(10_000)
}).strict();

export const organizerMyEventsResponseSchema = z.object({
  formatVersion: z.literal(1),
  events: z.array(organizerEventSchema).max(10_000)
}).strict();

export type OrganizerAccountLoginRequest = z.input<typeof organizerAccountLoginRequestSchema>;
export type OrganizerAccountLoginResponse = z.infer<typeof organizerAccountLoginResponseSchema>;
export type OrganizerEventCreateRequest = z.input<typeof organizerEventCreateRequestSchema>;
export type OrganizerEventCreateResponse = EventCreationResponse;
export type OrganizerMyEventsResponse = z.infer<typeof organizerMyEventsResponseSchema>;
