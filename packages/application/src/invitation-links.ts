import { randomBytes, randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";
import { INVITATION_LINK_LIFETIME_DAYS, type InvitationKind, type InvitationLinkView, type InvitationMailOutcome,
  type InvitationRole } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { raceTitle } from "@o-tid/domain";
import { accountRequestAllowanceExhausted, consumeAccountRequestAllowance, throttleHmac, type AccountThrottleScope } from "./account-throttle";
import { sha256Hex } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0206: länkar till sparade inbjudningar (klubb, tävling, träningsgrupp). Nyckeln är 32 slumpade byte (base64url) och bara
 * dess sha256 sparas. Länken gäller 14 dagar, tills den ersätts ("Skicka igen") eller inbjudan tas bort. Länken ger ingenting
 * själv: inbjudan blir som förut en behörighet när ett konto med exakt adressen och bekräftad e-post loggar in (ADR-0188
 * beslut 6). Länksidan svarar likadant oavsett om adressen har ett konto.
 *
 * Spärrar mot att O-Tid används för att skicka skräppost: mejl per avsändare och per mottagare (timme och dygn), och "Skicka
 * igen" tidigast tio minuter efter förra mejlet till samma inbjudan. Mejlen räknas i `account_request_throttle` (nyckeln som
 * HMAC), som står kvar när tävlingen, klubben, gruppen eller kontot tas bort (städrundan 2026-11-07; förut räknades raderna i
 * `invitation_link`, som försvinner med inbjudan). Kopierade länkar och "Skicka igen" räknas fortfarande i `invitation_link`.
 */
export const INVITATION_LINK_LIFETIME_MS = INVITATION_LINK_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
export const INVITATION_MAILS_PER_INVITER = { hour: 100, day: 300 } as const;
export const INVITATION_MAILS_PER_RECIPIENT = { hour: 3, day: 10 } as const;
export const INVITATION_RESEND_INTERVAL_MS = 10 * 60 * 1000;
export const INVITATION_LINKS_PER_INVITER_HOUR = 100;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface InvitationRef { kind: InvitationKind; invitationId: string }

export type InvitationTarget =
  | { kind: "CLUB"; clubId: string; name: string }
  | { kind: "RACE"; raceId: string; name: string; raceDate: string }
  | { kind: "GROUP"; groupId: string; name: string };

/** Det mejlet behöver: mottagaren, länkens nyckel, vem som bjuder in, till vad och som vad. Inget annat om någon. */
export interface InvitationMail {
  to: string; token: string; expiresAt: Date; inviterName: string; target: InvitationTarget; role: InvitationRole;
}
/** Skickar mejlet (webben: SMTP). Kastar om det inte gick. */
export type InvitationMailer = (mail: InvitationMail) => Promise<void>;

interface LoadedInvitation { ref: InvitationRef; email: string; role: InvitationRole; acceptedAt: Date | null; revokedAt: Date | null;
  target: InvitationTarget }

const linkColumn = (kind: InvitationKind) => kind === "CLUB" ? schema.invitationLinks.clubInvitationId
  : kind === "RACE" ? schema.invitationLinks.raceInvitationId : schema.invitationLinks.groupInvitationId;

/** Inbjudan med det den gäller, eller undefined. */
export async function loadInvitation(tx: DbExecutor, ref: InvitationRef): Promise<LoadedInvitation | undefined> {
  if (ref.kind === "CLUB") {
    const table = schema.clubInvitations;
    const [row] = await tx.select({ email: table.email, role: table.role, acceptedAt: table.acceptedAt, revokedAt: table.revokedAt,
      clubId: schema.clubs.id, name: schema.clubs.name }).from(table).innerJoin(schema.clubs, eq(schema.clubs.id, table.clubId))
      .where(eq(table.id, ref.invitationId));
    return row && { ref, email: row.email, role: row.role, acceptedAt: row.acceptedAt, revokedAt: row.revokedAt,
      target: { kind: "CLUB", clubId: row.clubId, name: row.name } };
  }
  if (ref.kind === "RACE") {
    const table = schema.racePersonInvitations;
    const [row] = await tx.select({ email: table.email, role: table.role, acceptedAt: table.acceptedAt, revokedAt: table.revokedAt,
      raceId: schema.races.id, raceName: schema.races.name, raceDate: schema.races.raceDate, eventName: schema.events.name })
      .from(table).innerJoin(schema.races, eq(schema.races.id, table.raceId)).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(table.id, ref.invitationId));
    return row && { ref, email: row.email, role: row.role, acceptedAt: row.acceptedAt, revokedAt: row.revokedAt,
      target: { kind: "RACE", raceId: row.raceId, name: raceTitle(row.eventName, row.raceName), raceDate: row.raceDate } };
  }
  const table = schema.trainingGroupInvitations;
  const [row] = await tx.select({ email: table.email, role: table.role, acceptedAt: table.acceptedAt, revokedAt: table.revokedAt,
    groupId: schema.trainingGroups.id, name: schema.trainingGroups.name }).from(table)
    .innerJoin(schema.trainingGroups, eq(schema.trainingGroups.id, table.groupId)).where(eq(table.id, ref.invitationId));
  return row && { ref, email: row.email, role: row.role, acceptedAt: row.acceptedAt, revokedAt: row.revokedAt,
    target: { kind: "GROUP", groupId: row.groupId, name: row.name } };
}

/** Sidan personen hamnar på efter inloggningen: klubben, gruppen, tävlingen (banläggningen för banläggare och kartritare). */
export function invitationNext(target: InvitationTarget, role: InvitationRole): string {
  if (target.kind === "CLUB") return `/organizer/clubs/${target.clubId}`;
  if (target.kind === "GROUP") return role === "LEADER" ? `/organizer/groups/${target.groupId}` : "/organizer";
  if (role === "COURSE_MAP") return `/admin/${target.raceId}/course-setting/map-errors`;
  if (role.startsWith("COURSE_")) return `/admin/${target.raceId}/course-setting`;
  return `/admin/${target.raceId}/manage`;
}

/** Mottagaren i spärren: HMAC av adressen (som kontospärrarna), så att adressen inte står en gång till i databasen. */
export const invitationRecipientKey = (email: string) => throttleHmac(`INVITATION_RECIPIENT\u0000${email}`);

/** Ny nyckel: 32 slumpade byte som base64url (43 tecken), och hashen som sparas. */
export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

async function issued(tx: DbExecutor, where: ReturnType<typeof and>, since: Date): Promise<number> {
  const [row] = await tx.select({ value: count() }).from(schema.invitationLinks).where(and(where, gt(schema.invitationLinks.createdAt, since)));
  return Number(row?.value ?? 0);
}

/**
 * Ryms ett till mejl (MAIL) eller en kopierad länk (LINK)? Låser avsändaren och mottagaren i transaktionen så att två samtidiga
 * anrop räknas efter varandra.
 */
async function allowed(tx: DbExecutor, input: { ref: InvitationRef; issuedBy: string; email: string; recipientKey: string;
  delivery: "MAIL" | "LINK"; now: Date }): Promise<boolean> {
  const links = schema.invitationLinks;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`invitation-issuer:${input.issuedBy}`}, 0))`);
  if (input.delivery === "LINK") {
    const byIssuer = and(eq(links.issuedBy, input.issuedBy), eq(links.delivery, "LINK"));
    return await issued(tx, byIssuer, new Date(input.now.getTime() - HOUR)) < INVITATION_LINKS_PER_INVITER_HOUR;
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`invitation-recipient:${input.recipientKey}`}, 0))`);
  const recipient = input.email.trim().toLowerCase();
  const limits: { scope: AccountThrottleScope; key: string; limit: number; windowMs: number }[] = [
    { scope: "INVITATION_ISSUER_HOUR", key: input.issuedBy, limit: INVITATION_MAILS_PER_INVITER.hour, windowMs: HOUR },
    { scope: "INVITATION_ISSUER_DAY", key: input.issuedBy, limit: INVITATION_MAILS_PER_INVITER.day, windowMs: DAY },
    { scope: "INVITATION_RECIPIENT_HOUR", key: recipient, limit: INVITATION_MAILS_PER_RECIPIENT.hour, windowMs: HOUR },
    { scope: "INVITATION_RECIPIENT_DAY", key: recipient, limit: INVITATION_MAILS_PER_RECIPIENT.day, windowMs: DAY }];
  for (const limit of limits) if (await accountRequestAllowanceExhausted(tx, limit, input.now)) return false;
  // Ett mejl som inte gick iväg hindrar inte ett nytt försök direkt.
  const sameInvitation = and(eq(linkColumn(input.ref.kind), input.ref.invitationId), eq(links.delivery, "MAIL"), isNotNull(links.sentAt));
  if (await issued(tx, sameInvitation, new Date(input.now.getTime() - INVITATION_RESEND_INTERVAL_MS)) > 0) return false;
  // Avsändaren och mottagaren är låsta, så alla fyra ryms (prövat ovan); räknas först nu, när mejlet blir av.
  for (const limit of limits) if (!await consumeAccountRequestAllowance(tx, limit, input.now)) return false;
  return true;
}

/**
 * Utfärdar en länk till inbjudan i anroparens transaktion. `MAIL` ersätter alla tidigare länkar till inbjudan (de slutar
 * gälla); `LINK` (kopierad av administratören) lämnar dem. Undefined när spärren slår till.
 */
export async function issueInvitationLink(tx: DbExecutor, input: { ref: InvitationRef; email: string; issuedBy: string;
  delivery: "MAIL" | "LINK"; now: Date }): Promise<{ linkId: string; token: string; expiresAt: Date } | undefined> {
  const recipientKey = invitationRecipientKey(input.email);
  if (!await allowed(tx, { ...input, recipientKey })) return undefined;
  const column = linkColumn(input.ref.kind);
  if (input.delivery === "MAIL") {
    await tx.update(schema.invitationLinks).set({ replacedAt: input.now })
      .where(and(eq(column, input.ref.invitationId), isNull(schema.invitationLinks.replacedAt)));
  }
  const { token, tokenHash } = newInvitationToken();
  const linkId = randomUUID();
  const expiresAt = new Date(input.now.getTime() + INVITATION_LINK_LIFETIME_MS);
  await tx.insert(schema.invitationLinks).values({ id: linkId, tokenHash, recipientKey, issuedBy: input.issuedBy, delivery: input.delivery,
    createdAt: input.now, expiresAt,
    clubInvitationId: input.ref.kind === "CLUB" ? input.ref.invitationId : null,
    raceInvitationId: input.ref.kind === "RACE" ? input.ref.invitationId : null,
    groupInvitationId: input.ref.kind === "GROUP" ? input.ref.invitationId : null });
  return { linkId, token, expiresAt };
}

export type PreparedInvitationMail = { status: "ready"; linkId: string; mail: InvitationMail } | { status: "throttled" | "closed" };

/** Mejlet till en öppen inbjudan, med en ny länk (som ersätter de tidigare). Skickas efter commit med `sendPreparedInvitation`. */
export async function prepareInvitationMail(tx: DbExecutor, input: { ref: InvitationRef; actorAccountId: string; now: Date })
  : Promise<PreparedInvitationMail> {
  const invitation = await loadInvitation(tx, input.ref);
  if (!invitation || invitation.acceptedAt || invitation.revokedAt) return { status: "closed" };
  const [actor] = await tx.select({ displayName: schema.userAccounts.displayName }).from(schema.userAccounts)
    .where(eq(schema.userAccounts.id, input.actorAccountId));
  if (!actor) return { status: "closed" };
  const link = await issueInvitationLink(tx, { ref: input.ref, email: invitation.email, issuedBy: input.actorAccountId, delivery: "MAIL",
    now: input.now });
  if (!link) return { status: "throttled" };
  return { status: "ready", linkId: link.linkId, mail: { to: invitation.email, token: link.token, expiresAt: link.expiresAt,
    inviterName: actor.displayName, target: invitation.target, role: invitation.role } };
}

/** Skickar ett förberett mejl och noterar när. Ett fel ger "failed" (inbjudan står kvar och kan skickas igen). */
export async function sendPreparedInvitation(db: Database, prepared: PreparedInvitationMail, mailer: InvitationMailer, now = new Date())
  : Promise<{ outcome: InvitationMailOutcome; sentAt?: Date }> {
  if (prepared.status !== "ready") return { outcome: prepared.status === "throttled" ? "throttled" : "failed" };
  try { await mailer(prepared.mail); }
  catch { return { outcome: "failed" }; }
  await db.update(schema.invitationLinks).set({ sentAt: now }).where(eq(schema.invitationLinks.id, prepared.linkId));
  return { outcome: "sent", sentAt: now };
}

/** När inbjudningarna senast mejlades (för listorna), per inbjudans id. Saknas = aldrig skickad. */
export async function invitationSentTimes(tx: DbExecutor, kind: InvitationKind, invitationIds: readonly string[]): Promise<Map<string, Date>> {
  if (invitationIds.length === 0) return new Map();
  const column = linkColumn(kind);
  const rows = await tx.select({ id: column, sentAt: max(schema.invitationLinks.sentAt) }).from(schema.invitationLinks)
    .where(inArray(column, [...invitationIds])).groupBy(column);
  return new Map(rows.filter(row => row.id && row.sentAt).map(row => [row.id!, new Date(row.sentAt!)]));
}

/**
 * Länksidan: vad inbjudan gäller, eller "invalid" för okänd, ersatt, för gammal eller återkallad länk (samma svar). Svaret
 * säger ingenting om huruvida adressen har ett konto (en tagen inbjudan visas som en öppen).
 */
export async function readInvitationLink(db: Database, token: string, now = new Date()): Promise<InvitationLinkView> {
  const invalid = { formatVersion: 1, status: "invalid" } as const;
  return db.transaction(async tx => {
    const [link] = await tx.select().from(schema.invitationLinks).where(eq(schema.invitationLinks.tokenHash, sha256Hex(token)));
    if (!link || link.replacedAt || link.expiresAt.getTime() <= now.getTime()) return invalid;
    const ref: InvitationRef = link.clubInvitationId ? { kind: "CLUB", invitationId: link.clubInvitationId }
      : link.raceInvitationId ? { kind: "RACE", invitationId: link.raceInvitationId } : { kind: "GROUP", invitationId: link.groupInvitationId! };
    const invitation = await loadInvitation(tx, ref);
    if (!invitation || invitation.revokedAt) return invalid;
    // Avsändarens konto kan ha tagits bort (ingen främmande nyckel sedan migration 0088); inbjudan gäller ändå, utan namnet.
    const [issuer] = await tx.select({ displayName: schema.userAccounts.displayName }).from(schema.userAccounts)
      .where(eq(schema.userAccounts.id, link.issuedBy));
    return { formatVersion: 1, status: "valid", kind: ref.kind, targetName: invitation.target.name,
      raceDate: invitation.target.kind === "RACE" ? invitation.target.raceDate : null, role: invitation.role,
      inviterName: issuer?.displayName ?? null,
      email: invitation.email, next: invitationNext(invitation.target, invitation.role), expiresAt: link.expiresAt.toISOString() } as const;
  });
}

/**
 * Efter att en inbjudan sparats (i samma transaktion): förbered mejlet om e-post finns. Efter commit skickas det med
 * `deliverPrepared`. Utan e-post (`mailer` saknas) blir utfallet "off".
 */
export async function prepareIfMail(tx: DbExecutor, mailer: InvitationMailer | undefined, ref: InvitationRef, actorAccountId: string, now: Date)
  : Promise<PreparedInvitationMail | undefined> {
  return mailer ? prepareInvitationMail(tx, { ref, actorAccountId, now }) : undefined;
}

export async function deliverPrepared(db: Database, prepared: PreparedInvitationMail | undefined, mailer: InvitationMailer | undefined, now: Date) {
  if (!prepared || !mailer) return { outcome: "off" as const };
  return sendPreparedInvitation(db, prepared, mailer, now);
}

/** Utfallet för en upprepad begäran (samma requestId): skickad om något mejl har gått iväg, annars som utan e-post. */
export async function replayedOutcome(db: DbExecutor, ref: InvitationRef): Promise<"sent" | "off"> {
  const rows = await db.select({ sentAt: schema.invitationLinks.sentAt }).from(schema.invitationLinks)
    .where(eq(linkColumn(ref.kind), ref.invitationId));
  return rows.some(row => row.sentAt) ? "sent" : "off";
}
