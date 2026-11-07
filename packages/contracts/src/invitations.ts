import { z } from "zod";
import { accountEmailSchema, passwordResetTokenSchema } from "./account";
import { clubRoleSchema } from "./club-archive";
import { mapProjectRoleSchema } from "./map-project";
import { groupMemberRoleSchema } from "./training-group";

/**
 * ADR-0206: inbjudningar med e-post. En sparad inbjudan (klubb, tävling eller träningsgrupp, ADR-0188 beslut 6) får en länk
 * med en slumpad nyckel som mejlas eller kopieras av administratören. Länken visar vad inbjudan gäller; den ger ingenting
 * själv. Behörigheten kommer som förut när ett konto med adressen och bekräftad e-post loggar in.
 */
export const INVITATION_LINK_LIFETIME_DAYS = 14;
/** Så många adresser går att klistra in på en gång. */
export const INVITATION_BULK_MAX = 100;

/** ADR-0219: också kartprojekt (`MAP_PROJECT`). */
export const invitationKindSchema = z.enum(["CLUB", "RACE", "GROUP", "MAP_PROJECT"]);
/** Tävlingens roller som går att bjuda in till (administratör, funktionär, banläggning, kartritare). */
export const raceInvitationRoleSchema = z.enum(["ADMIN", "FUNCTIONARY", "COURSE_EDIT", "COURSE_SUGGEST", "COURSE_COMMENT", "COURSE_MAP"]);
/** Rollerna per slag av inbjudan: klubbens (lagrat READER heter Medlem i UI), tävlingens, träningsgruppens och kartprojektets. */
const invitationRoleSchemas = { CLUB: clubRoleSchema, RACE: raceInvitationRoleSchema, GROUP: groupMemberRoleSchema,
  MAP_PROJECT: mapProjectRoleSchema } as const;
/** Någon av rollerna, oavsett slag (trådformatet är ett `role`-fält); `invitationRoleFits` säger om den hör till slaget. */
export const invitationRoleSchema = z.union([clubRoleSchema, raceInvitationRoleSchema, groupMemberRoleSchema, mapProjectRoleSchema]);
export const invitationRoleFits = (kind: z.infer<typeof invitationKindSchema>, role: string): boolean =>
  invitationRoleSchemas[kind].safeParse(role).success;
/**
 * Vad som hände med mejlet när inbjudan sparades eller skickades igen: skickat, gick inte att skicka, spärrat (för många) eller
 * ingen e-post på servern.
 */
export const invitationMailOutcomeSchema = z.enum(["sent", "failed", "throttled", "off"]);

/** "Skicka igen" (MAIL, ny nyckel som ersätter de tidigare) eller "Kopiera länken" (LINK, utan e-post på servern). */
export const invitationResendRequestSchema = z.object({ formatVersion: z.literal(1), delivery: z.enum(["MAIL", "LINK"]) }).strict();

const instantSchema = z.iso.datetime({ offset: true });
export const invitationResendResponseSchema = z.discriminatedUnion("status", [
  z.object({ formatVersion: z.literal(1), status: z.literal("sent"), sentAt: instantSchema }).strict(),
  z.object({ formatVersion: z.literal(1), status: z.literal("link"), token: passwordResetTokenSchema, expiresAt: instantSchema }).strict(),
  z.object({ formatVersion: z.literal(1), status: z.enum(["throttled", "failed"]) }).strict()
]);

/** Länksidan (/inbjudan#token=…) frågar med nyckeln i kroppen, aldrig i adressen. */
export const invitationLinkRequestSchema = z.object({ formatVersion: z.literal(1), token: passwordResetTokenSchema }).strict();

export const invitationLinkViewSchema = z.discriminatedUnion("status", [
  z.object({
    formatVersion: z.literal(1), status: z.literal("valid"), kind: invitationKindSchema,
    /** Klubbens, tävlingens ("Evenemang · Lopp") eller gruppens namn. */
    targetName: z.string().min(1).max(300),
    /** Tävlingens datum (YYYY-MM-DD), annars null. */
    raceDate: z.iso.date().nullable(),
    role: invitationRoleSchema,
    /** Null när avsändarens konto har tagits bort (migration 0088). */
    inviterName: z.string().min(1).max(120).nullable(),
    email: accountEmailSchema,
    /** Sidan personen hamnar på efter inloggningen (en sökväg i O-Tid). */
    next: z.string().regex(/^\/[A-Za-z0-9/_-]{1,200}$/),
    expiresAt: instantSchema
  }).strict().refine(view => invitationRoleFits(view.kind, view.role), { path: ["role"], message: "Rollen hör inte till inbjudans slag" }),
  /** Okänd, ersatt, gammal eller återkallad länk: samma svar. */
  z.object({ formatVersion: z.literal(1), status: z.literal("invalid") }).strict()
]);

export type InvitationKind = z.infer<typeof invitationKindSchema>;
export type InvitationRole = z.infer<typeof invitationRoleSchema>;
export type RaceInvitationRole = z.infer<typeof raceInvitationRoleSchema>;
export type InvitationMailOutcome = z.infer<typeof invitationMailOutcomeSchema>;
export type InvitationResendResponse = z.infer<typeof invitationResendResponseSchema>;
export type InvitationLinkView = z.infer<typeof invitationLinkViewSchema>;
