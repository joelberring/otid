import { z } from "zod";
import { uuidSchema } from "./ids";
import { invitationRoleFits, invitationRoleSchema } from "./invitations";

/**
 * ADR-0209: klubbtillhörighet. Klubblistan (Eventors organisationer), Mina klubbar på kontot, klubbarkivets koppling och
 * bekräftelser, "Från klubben" och tävlingen i klubbarkivet. Inga svar innehåller någon annans e-postadress.
 */
export const ORGANISATION_SEARCH_MAX = 20;
export const CLUB_FREE_TEXT_MAX = 120;
/** Högst så många personer i en inbjudan "Från klubben". */
export const CLUB_INVITE_MAX = 50;

export const organisationTypeSchema = z.enum(["FEDERATION", "DISTRICT", "CLUB", "OTHER"]);
export const affiliationStatusSchema = z.enum(["PENDING", "CONFIRMED", "DECLINED"]);

export interface OrganisationSummary { organisationId: string; name: string; shortName: string | null; type: z.infer<typeof organisationTypeSchema> }
export interface OrganisationSearchResponse { formatVersion: 1; organisations: OrganisationSummary[]; directoryEmpty: boolean }

// --- Mina klubbar -------------------------------------------------------------------------------------------------------------

export interface AccountClubMembershipView {
  membershipId: string;
  organisation: OrganisationSummary | null;
  freeText: string | null;
  status: z.infer<typeof affiliationStatusSchema>;
  /** Klubbarkivets namn när tillhörigheten är bekräftad (och kontot läser arkivet). */
  clubName: string | null;
  clubId: string | null;
  /** Hur tillhörigheten bekräftades. */
  via: "MANUAL" | "EVENTOR" | null;
  /** För en klubb ur listan: om klubben har ett klubbarkiv kopplat till Eventor (annars "Starta klubbytan"). */
  spaceExists: boolean;
  createdAt: string;
}
export interface AccountClubsResponse { formatVersion: 1; memberships: AccountClubMembershipView[]; promptAnswered: boolean }

const freeTextSchema = z.string().trim().min(1).max(CLUB_FREE_TEXT_MAX).refine(value => !/\p{Cc}/u.test(value));

export const accountClubAddRequestSchema = z.object({
  formatVersion: z.literal(1),
  organisationId: uuidSchema.nullable(),
  freeText: freeTextSchema.nullable()
}).strict().refine(value => (value.organisationId === null) !== (value.freeText === null));

export const accountClubRemoveRequestSchema = z.object({ formatVersion: z.literal(1), membershipId: uuidSchema }).strict();

/** Steget efter registreringen: flera klubbar på en gång, eller inga (Hoppa över). */
export const accountClubStepRequestSchema = z.object({
  formatVersion: z.literal(1),
  organisationIds: z.array(uuidSchema).max(10),
  freeText: freeTextSchema.nullable()
}).strict();

// --- Klubbarkivet: Klubben i Eventor och bekräftelser -------------------------------------------------------------------------

export interface ClubAffiliationPerson { membershipId: string; displayName: string; freeText: string | null; since: string;
  via: "MANUAL" | "EVENTOR" | null }
export type ClubAreaAccess = "MEMBERS" | "LEADERS";
export interface ClubEventorStatus {
  linked: boolean;
  /** De sista fyra tecknen i nyckeln; nyckeln själv skickas aldrig. */
  keyHint: string | null;
  linkedAt: string | null;
  members: number;
  confirmedViaEventor: number;
  syncedAt: string | null;
  problem: string | null;
}
export interface ClubAffiliationView {
  formatVersion: 1;
  clubId: string;
  /** Klubben i Eventor (bevisad med klubbens nyckel), eller null = "Inte kopplad till Eventor". */
  organisation: OrganisationSummary | null;
  eventor: ClubEventorStatus;
  /** "Vem ser vad". */
  access: { archive: ClubAreaAccess; mapBank: ClubAreaAccess };
  /** Väntar på bekräftelse: anmälda till den kopplade klubben (adressen fanns inte i Eventor) och fritexter som liknar namnet. */
  pending: ClubAffiliationPerson[];
  confirmed: ClubAffiliationPerson[];
}

const areaAccessSchema = z.enum(["MEMBERS", "LEADERS"]);
export const clubAccessSettingsRequestSchema = z.object({
  formatVersion: z.literal(1), archive: areaAccessSchema, mapBank: areaAccessSchema
}).strict();
/** Svaret när "Vem ser vad" sparats (PUT …/clubs/[clubId]/access). */
export interface ClubAccessSettingsResponse { formatVersion: 1; access: ClubAffiliationView["access"] }
export const clubEventorLinkRequestSchema = z.object({ formatVersion: z.literal(1), apiKey: z.string().trim().min(16).max(128),
  /** Användartestet 2026-11-12 (F): byt klubbytans namn till klubbens namn i Eventor (rutan är ikryssad som förval). */
  rename: z.boolean().optional() }).strict();

export const clubAffiliationDecisionRequestSchema = z.object({
  formatVersion: z.literal(1),
  membershipId: uuidSchema,
  decision: z.enum(["CONFIRM", "DECLINE", "REMOVE"])
}).strict();

// --- Från klubben ---------------------------------------------------------------------------------------------------------------

export const clubInviteContextSchema = z.object({ kind: z.enum(["RACE", "CLUB", "TRAINING_GROUP"]), id: uuidSchema }).strict();
export type ClubInviteContext = z.infer<typeof clubInviteContextSchema>;

/** En bekräftad medlem i väljaren: namnet och klubben, aldrig adressen. `ref` är bara giltig i väljaren. */
export interface ClubPickerMember { ref: string; displayName: string; clubName: string; already: boolean }
export interface ClubPickerResponse { formatVersion: 1; members: ClubPickerMember[]; clubs: string[] }

export const clubInviteFromClubRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuidSchema,
  context: clubInviteContextSchema,
  refs: z.array(uuidSchema).min(1).max(CLUB_INVITE_MAX),
  /** En roll som hör till sammanhanget (`invitationRoleFits`, TRAINING_GROUP = GROUP). */
  role: invitationRoleSchema
}).strict().refine(request => invitationRoleFits(request.context.kind === "TRAINING_GROUP" ? "GROUP" : request.context.kind, request.role),
  { path: ["role"], message: "Rollen hör inte till sammanhanget" });
export interface ClubInviteFromClubResponse { formatVersion: 1; invited: number; already: number; failed: number }

// --- Tävlingen och klubbarkivet ---------------------------------------------------------------------------------------------------

export interface RaceClubArchiveView {
  formatVersion: 1;
  raceId: string;
  raceDate: string;
  organiser: OrganisationSummary | null;
  /** Förslag när arrangörsklubben inte är vald: den som skapade tävlingens bekräftade klubb. */
  suggestion: OrganisationSummary | null;
  /** Klubbarkivet för arrangörsklubben: finns inte (eller syns inte), eller du är administratör där. */
  space: "NONE" | "ADMIN";
  spaceName: string | null;
  finished: boolean;
  coursesPublic: boolean;
  lifted: { clubId: string; entryId: string; liftedAt: string } | null;
  /** Vad som skulle läggas i arkivet. */
  contents: { mapFile: string | null; courseSetting: boolean; courseFile: boolean;
    /**
     * Användartestet 2026-11-12 (C): tidtagningens banor som inte finns i banläggningen (bara kontrollkoder, inga lägen på
     * kartan). De följer inte med i arkivets banfiler.
     */
    coursesWithoutMap: string[] };
}

export const raceOrganiserRequestSchema = z.object({ formatVersion: z.literal(1), organisationId: uuidSchema.nullable() }).strict();
export const raceClubArchiveLiftRequestSchema = z.object({
  formatVersion: z.literal(1),
  /** Krävs före tävlingsdagen och medan banorna är hemliga (ADR-0176). */
  confirmSecrecy: z.boolean()
}).strict();

