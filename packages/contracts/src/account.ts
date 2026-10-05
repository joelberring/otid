import { z } from "zod";

/**
 * Konton (ADR-0172 beslut 1): kontot identifieras med e-postadressen. Adressen jämförs utan hänsyn till
 * versaler och sparas normaliserad (NFC, utan omgivande blanksteg, gemener).
 */
const EMAIL_PATTERN = /^[^\s@]{1,64}@(?:[^\s@.]+\.)+[^\s@.]+$/u;
export const ACCOUNT_EMAIL_MAX_LENGTH = 254;
export const ACCOUNT_PASSWORD_MIN_LENGTH = 8;

/** Normaliserad adress, eller `undefined` om det inte är en e-postadress. */
export function normalizeAccountEmail(value: string): string | undefined {
  const normalized = value.normalize("NFC").trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > ACCOUNT_EMAIL_MAX_LENGTH) return undefined;
  return EMAIL_PATTERN.test(normalized) ? normalized : undefined;
}

export const accountEmailSchema = z.string().max(320).transform((value, context) => {
  const normalized = normalizeAccountEmail(value);
  if (!normalized) {
    context.addIssue({ code: "custom", message: "Ogiltig e-postadress" });
    return z.NEVER;
  }
  return normalized;
});

/** En redan normaliserad adress i svar från servern. */
export const storedAccountEmailSchema = z.string().refine((value) => normalizeAccountEmail(value) === value);

const canonicalUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const instant = z.iso.datetime({ offset: true });
const displayName = z.string().trim().min(1).max(120);
const newPassword = z.string().min(ACCOUNT_PASSWORD_MIN_LENGTH).max(1024);

export const accountErrorCodeSchema = z.enum([
  "INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED",
  "ACCOUNT_BLOCKED", "MAIL_DISABLED", "CONFIRMATION_MISMATCH", "INTERNAL_ERROR"
]);
export const accountErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: accountErrorCodeSchema
}).strict();

/** Glömt lösenord: om e-post är inställd på servern, och vem man annars kontaktar. */
export const passwordResetAvailabilitySchema = z.object({
  formatVersion: z.literal(1),
  emailEnabled: z.boolean(),
  contactEmail: z.string().max(ACCOUNT_EMAIL_MAX_LENGTH).nullable()
}).strict();

export const passwordResetRequestSchema = z.object({
  formatVersion: z.literal(1),
  email: accountEmailSchema
}).strict();

/** Samma svar oavsett om adressen har ett konto. */
export const passwordResetRequestResponseSchema = z.object({
  formatVersion: z.literal(1),
  status: z.literal("accepted")
}).strict();

export const passwordResetTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const passwordResetCompleteRequestSchema = z.object({
  formatVersion: z.literal(1),
  token: passwordResetTokenSchema,
  password: newPassword
}).strict();

export const passwordResetCompleteResponseSchema = z.object({
  formatVersion: z.literal(1),
  status: z.literal("reset")
}).strict();

/** Mitt konto. `ownedEvents` är de tävlingar som tas bort tillsammans med kontot. */
export const accountProfileSchema = z.object({
  formatVersion: z.literal(1),
  accountId: uuid,
  email: storedAccountEmailSchema,
  displayName,
  superadmin: z.boolean(),
  createdAt: instant,
  ownedEvents: z.array(z.object({
    eventId: uuid,
    eventName: z.string().trim().min(1).max(160),
    startsOn: z.iso.date()
  }).strict()).max(10_000)
}).strict();

export const accountDisplayNameChangeSchema = z.object({
  formatVersion: z.literal(1),
  displayName
}).strict();

export const accountPasswordChangeSchema = z.object({
  formatVersion: z.literal(1),
  currentPassword: z.string().min(1).max(1024),
  newPassword
}).strict();

export const accountDeleteRequestSchema = z.object({
  formatVersion: z.literal(1),
  password: z.string().min(1).max(1024)
}).strict();

/** Ägaren tar bort sin tävling genom att skriva tävlingens namn. */
export const eventDeleteRequestSchema = z.object({
  formatVersion: z.literal(1),
  confirmation: z.string().max(200)
}).strict();

export const deletedResponseSchema = z.object({
  formatVersion: z.literal(1),
  status: z.literal("deleted")
}).strict();

export type AccountErrorCode = z.infer<typeof accountErrorCodeSchema>;
export type PasswordResetAvailability = z.infer<typeof passwordResetAvailabilitySchema>;
export type AccountProfile = z.infer<typeof accountProfileSchema>;
