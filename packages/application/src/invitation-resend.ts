import { invitationResendRequestSchema, type InvitationResendResponse } from "@o-tid/contracts";
import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { requireClubRole, type ClubProof } from "./club-access";
import {
  issueInvitationLink, loadInvitation, prepareInvitationMail, sendPreparedInvitation, type InvitationMailer, type InvitationRef,
  type PreparedInvitationMail
} from "./invitation-links";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { requireGroupLeader } from "./training-groups";

/**
 * ADR-0206: "Skicka igen" (ny nyckel som ersätter de tidigare, spärrad) och "Kopiera länken" (utan e-post på servern) i listorna
 * över öppna inbjudningar: klubbens medlemmar, tävlingens personer med behörighet och träningsgruppens ledare och medlemmar.
 * Samma regler som för att ta bort inbjudan: en ägarinbjudan i klubben och en administratörsinbjudan på tävlingen bara av ägaren.
 * En inbjudan "Från klubben" (ADR-0209) kan bara mejlas: länksidan visar adressen, och den ska den som bjöd in aldrig se.
 */
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "mail-off" };
export type InvitationResendResult = Failure | { status: "ok"; response: InvitationResendResponse };
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Klubbens och gruppens fel; "conflict" och "name-taken" hör inte till en läsning av behörigheten. */
const failure = (status: string): Failure => ({ status: status === "unauthorized" || status === "forbidden" || status === "not-found"
  ? status : "invalid-request" });
type Invitation = NonNullable<Awaited<ReturnType<typeof loadInvitation>>>;
/** Behörigheten på klubben, tävlingen eller gruppen först; sedan om just den här inbjudan hör dit och får skickas av kontot. */
type Authorize = (tx: Transaction) => Promise<Failure | { status: "ok"; accountId: string; permits: (invitation: Invitation) => Failure | undefined }>;

const SOURCE_KIND = { CLUB: "CLUB", RACE: "RACE_PERSON", GROUP: "TRAINING_GROUP" } as const;

async function fromClub(tx: Transaction, ref: InvitationRef): Promise<boolean> {
  const sources = schema.invitationClubSources;
  const [row] = await tx.select({ id: sources.id }).from(sources)
    .where(and(eq(sources.kind, SOURCE_KIND[ref.kind]), eq(sources.invitationId, ref.invitationId))).limit(1);
  return row !== undefined;
}

async function resend(db: Database, ref: InvitationRef, request: unknown, authorize: Authorize, mailer: InvitationMailer | undefined, now: Date)
  : Promise<InvitationResendResult> {
  const parsed = invitationResendRequestSchema.safeParse(request);
  const result = await db.transaction(async (tx): Promise<InvitationResendResult | { status: "prepared"; prepared: PreparedInvitationMail }> => {
    // Behörigheten först: den som inte får skicka får samma svar oavsett vad begäran innehåller.
    const actor = await authorize(tx);
    if (actor.status !== "ok") return actor;
    if (!parsed.success) return { status: "invalid-request" };
    const delivery = parsed.data.delivery;
    if (delivery === "MAIL" && !mailer) return { status: "mail-off" };
    const invitation = await loadInvitation(tx, ref);
    if (!invitation || invitation.acceptedAt || invitation.revokedAt) return { status: "not-found" };
    const refused = actor.permits(invitation);
    if (refused) return refused;
    if (delivery === "LINK") {
      if (await fromClub(tx, ref)) return { status: "forbidden" };
      const link = await issueInvitationLink(tx, { ref, email: invitation.email, issuedBy: actor.accountId, delivery: "LINK", now });
      return { status: "ok", response: link ? { formatVersion: 1, status: "link", token: link.token, expiresAt: link.expiresAt.toISOString() }
        : { formatVersion: 1, status: "throttled" } };
    }
    return { status: "prepared", prepared: await prepareInvitationMail(tx, { ref, actorAccountId: actor.accountId, now }) };
  });
  if (result.status !== "prepared") return result;
  const sent = await sendPreparedInvitation(db, result.prepared, mailer!, now);
  return { status: "ok", response: sent.sentAt ? { formatVersion: 1, status: "sent", sentAt: sent.sentAt.toISOString() }
    : { formatVersion: 1, status: sent.outcome === "throttled" ? "throttled" : "failed" } };
}

/** Klubbens inbjudan (Medlemmar). */
export async function resendClubInvitation(db: Database, input: ClubProof & { clubId: string; invitationId: string; request: unknown },
  mailer?: InvitationMailer, now = new Date()): Promise<InvitationResendResult> {
  return resend(db, { kind: "CLUB", invitationId: input.invitationId }, input.request, async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return failure(actor.status);
    return { status: "ok", accountId: actor.accountId, permits: invitation =>
      invitation.target.kind !== "CLUB" || invitation.target.clubId !== input.clubId ? { status: "not-found" }
        : invitation.role === "OWNER" && actor.role !== "OWNER" ? { status: "forbidden" } : undefined };
  }, mailer, now);
}

/** Tävlingens inbjudan (Personer med behörighet, också banläggningens roller). */
export async function resendRacePersonInvitation(db: Database, input: RaceSessionProof & { invitationId: string; request: unknown },
  mailer?: InvitationMailer, now = new Date()): Promise<InvitationResendResult> {
  return resend(db, { kind: "RACE", invitationId: input.invitationId }, input.request, async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const principal = auth.principal;
    if (principal.role !== "ADMIN") return { status: "forbidden" };
    return { status: "ok", accountId: principal.accountId, permits: invitation =>
      invitation.target.kind !== "RACE" || invitation.target.raceId !== principal.raceId ? { status: "not-found" }
        : invitation.role === "ADMIN" && principal.grantRole !== "OWNER" ? { status: "forbidden" } : undefined };
  }, mailer, now);
}

/** Träningsgruppens inbjudan (Ledare och medlemmar). */
export async function resendGroupInvitation(db: Database, input: ClubProof & { groupId: string; invitationId: string; request: unknown },
  mailer?: InvitationMailer, now = new Date()): Promise<InvitationResendResult> {
  return resend(db, { kind: "GROUP", invitationId: input.invitationId }, input.request, async tx => {
    const leader = await requireGroupLeader(tx, input, now, true);
    if (leader.status !== "ok") return failure(leader.status);
    return { status: "ok", accountId: leader.accountId, permits: invitation =>
      invitation.target.kind !== "GROUP" || invitation.target.groupId !== input.groupId ? { status: "not-found" } : undefined };
  }, mailer, now);
}
