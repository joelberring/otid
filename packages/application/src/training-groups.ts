import { clubSourcedInContext } from "./club-invite";
import { randomInt, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  groupCreateRequestSchema, groupMemberAddRequestSchema, groupMemberRemoveRequestSchema, groupSettingsRequestSchema,
  raceGroupAttachRequestSchema, type GroupLeaderView, type GroupMember, type GroupSeries, type GroupSession, type GroupSummary,
  type InvitationMailOutcome
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { groupParticipantKey, seasonTable, type GroupPointsMode, type SeasonRow } from "@o-tid/domain";
import { activeEventAdministrationGrant } from "./race-session";
import { leaderMembership } from "./training-group-access";
import { acceptGroupInvitations, openGroupInvitations } from "./training-group-invitations";
import { deliverPrepared, invitationSentTimes, prepareIfMail, replayedOutcome, type InvitationMailer } from "./invitation-links";
import { listGroupLibraryMaps } from "./training-group-maps";
import { publicResults } from "./results";
import { UUID_PATTERN } from "./serialization";
import {
  authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead, type UserAccountSessionProof
} from "./user-account";

/**
 * Steg 68 (ADR-0182): träningsgruppen – skapa, ledare och medlemmar, inställningar, en tävling i gruppen och ledarnas vy.
 * Den som skapar gruppen blir ledare. Ledare lägger till och tar bort ledare och medlemmar med e-post (ett befintligt konto,
 * som andra roller); den sista ledaren kan inte tas bort. Ledarna är ADMIN på gruppens tävlingar (`training-group-access`).
 */
export type GroupTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Transaction = GroupTransaction;
export type GroupFailure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" };
type Proof = UserAccountSessionProof;

/** Inloggad ledare i gruppen, annars felet (en icke-ledare får "not-found" så att gruppens existens inte röjs). */
export async function requireGroupLeader(tx: Transaction, proof: Proof & { groupId: string }, now: Date, write: boolean)
  : Promise<GroupFailure | { status: "ok"; accountId: string; groupId: string }> {
  if (!UUID_PATTERN.test(proof.groupId)) return { status: "not-found" };
  const auth = write ? await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now)
    : await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
  if (auth.status !== "authenticated") return auth;
  const leader = await leaderMembership(tx, { accountId: auth.principal.accountId, groupId: proof.groupId }, write ? "update" : "share");
  if (!leader) return { status: "not-found" };
  return { status: "ok", accountId: auth.principal.accountId, groupId: proof.groupId };
}

async function summaries(tx: Transaction, accountId: string): Promise<GroupSummary[]> {
  const rows = await tx.select({ groupId: schema.trainingGroups.id, name: schema.trainingGroups.name, code: schema.trainingGroups.code,
    role: schema.trainingGroupMembers.role }).from(schema.trainingGroupMembers)
    .innerJoin(schema.trainingGroups, eq(schema.trainingGroups.id, schema.trainingGroupMembers.groupId))
    .where(eq(schema.trainingGroupMembers.accountId, accountId)).orderBy(asc(schema.trainingGroups.name)).limit(500);
  if (rows.length === 0) return [];
  const counts = new Map((await tx.select({ groupId: schema.events.trainingGroupId, value: count() }).from(schema.events)
    .where(inArray(schema.events.trainingGroupId, rows.map(row => row.groupId))).groupBy(schema.events.trainingGroupId))
    .map(row => [row.groupId, row.value]));
  return rows.map(row => ({ ...row, sessions: counts.get(row.groupId) ?? 0 }));
}

const SUFFIX_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
/** Åtta tecken ur 32 (inga lätt förväxlade): 40 bitar. */
export function randomGroupCodeSuffix(): string {
  return Array.from({ length: 8 }, () => SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)]).join("");
}
/** Kortnamnet utan bindestreck på slutet, högst 31 tecken (koden blir högst 40 med den slumpade delen). */
export function groupCodeSlug(code: string): string {
  return code.slice(0, 31).replace(/-+$/, "");
}

export async function createTrainingGroup(db: Database, input: Proof & { request: unknown }, now = new Date())
  : Promise<GroupFailure | { status: "created"; replayed: boolean; group: GroupSummary }> {
  const parsed = groupCreateRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const intent = parsed.data;
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const accountId = auth.principal.accountId;
    // ADR-0189 beslut 8: arrangörens kortnamn och en slumpad del (40 bitar), så att länken (/g/<kod>) inte går att gissa.
    const slug = groupCodeSlug(intent.code);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"training-group:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.trainingGroups).where(eq(schema.trainingGroups.requestId, intent.requestId));
    if (prior) {
      if (prior.createdBy !== accountId || !prior.code.startsWith(`${slug}-`)) return { status: "conflict" } as const;
      const group = (await summaries(tx, accountId)).find(row => row.groupId === prior.id);
      return group ? { status: "created", replayed: true, group } as const : { status: "conflict" } as const;
    }
    let code = `${slug}-${randomGroupCodeSuffix()}`;
    while ((await tx.select({ id: schema.trainingGroups.id }).from(schema.trainingGroups).where(eq(schema.trainingGroups.code, code))).length > 0) {
      code = `${slug}-${randomGroupCodeSuffix()}`;
    }
    const [group] = await tx.insert(schema.trainingGroups).values({ name: intent.name, code, createdAt: now, createdBy: accountId,
      requestId: intent.requestId }).returning({ id: schema.trainingGroups.id });
    if (!group) throw new Error("Gruppen kunde inte skapas");
    await tx.insert(schema.trainingGroupMembers).values({ id: randomUUID(), groupId: group.id, accountId, role: "LEADER", addedAt: now,
      addedBy: accountId, requestId: randomUUID() });
    return { status: "created", replayed: false, group: { groupId: group.id, name: intent.name, code, role: "LEADER", sessions: 0 } } as const;
  });
}

/** Mina tävlingar → Mina grupper: grupperna där kontot är ledare eller medlem. */
export async function listMyGroups(db: Database, proof: Proof, now = new Date()): Promise<GroupFailure | { status: "ok"; groups: GroupSummary[] }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    // ADR-0189 beslut 9: grupper som väntade på att kontot loggade in.
    await acceptGroupInvitations(tx, auth.principal.accountId, now);
    return { status: "ok", groups: await summaries(tx, auth.principal.accountId) } as const;
  });
}

async function members(tx: Transaction, groupId: string): Promise<GroupMember[]> {
  const rows = await tx.select({ memberId: schema.trainingGroupMembers.id, accountId: schema.trainingGroupMembers.accountId,
    email: schema.userAccounts.email, displayName: schema.userAccounts.displayName, role: schema.trainingGroupMembers.role,
    addedAt: schema.trainingGroupMembers.addedAt }).from(schema.trainingGroupMembers)
    .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.trainingGroupMembers.accountId))
    .where(eq(schema.trainingGroupMembers.groupId, groupId))
    .orderBy(asc(schema.trainingGroupMembers.role), asc(schema.trainingGroupMembers.addedAt)).limit(2000);
  // ADR-0189 beslut 9: adresser som väntar på inloggning, sist.
  const pending = await openGroupInvitations(tx, groupId);
  const sent = await invitationSentTimes(tx, "GROUP", pending.map(row => row.id));
  return [...rows.map(row => ({ ...row, addedAt: row.addedAt.toISOString(), pending: false })),
    ...pending.map(row => ({ memberId: row.id, accountId: null, email: row.email, displayName: null, role: row.role,
      addedAt: row.createdAt.toISOString(), pending: true, sentAt: sent.get(row.id)?.toISOString() ?? null }))];
}

/** ADR-0209: den som kom "Från klubben" visas med namnet, aldrig adressen. */
async function shownMembers(tx: Transaction, groupId: string): Promise<GroupMember[]> {
  const fromClub = await clubSourcedInContext(tx, "TRAINING_GROUP", groupId);
  return (await members(tx, groupId)).map(member => member.accountId && fromClub.accounts.has(member.accountId) ? { ...member, email: "" }
    : !member.accountId && fromClub.invitations.has(member.memberId) ? { ...member, email: "", displayName: fromClub.invitations.get(member.memberId)! }
      : member);
}

/** Gruppens tillfällen (tävlingarna i gruppens evenemang), äldst först. */
export async function groupSessions(tx: Transaction, groupId: string): Promise<GroupSession[]> {
  const rows = await tx.select({ raceId: schema.races.id, eventId: schema.events.id, eventName: schema.events.name, raceName: schema.races.name,
    raceDate: schema.races.raceDate, raceType: schema.races.raceType, firstStartTime: schema.races.firstStartTime,
    shortCode: schema.races.shortCode, publishedAt: schema.races.publishedAt, hidden: schema.races.hiddenBySuperadmin,
    seriesId: schema.events.trainingGroupSeriesId,
    entries: sql<number>`(select count(*)::int from ${schema.entries} where ${schema.entries.raceId} = ${schema.races.id})`,
    hasResults: sql<boolean>`exists (select 1 from ${schema.resultRevisions} where ${schema.resultRevisions.raceId} = ${schema.races.id}
      and ${schema.resultRevisions.published})` })
    .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(eq(schema.events.trainingGroupId, groupId)).orderBy(asc(schema.races.raceDate), asc(schema.races.firstStartTime), asc(schema.races.id))
    .limit(2000);
  return rows.map(({ publishedAt, hidden, ...row }) => ({ ...row, published: publishedAt !== null && !hidden, entries: Number(row.entries) }));
}

/** Dagens datum i gruppens tidszon (den senaste tävlingens, annars Stockholm). */
export async function groupToday(tx: Transaction, groupId: string, now: Date): Promise<{ today: string; timeZone: string }> {
  const [latest] = await tx.select({ timeZone: schema.events.timeZone }).from(schema.events).where(eq(schema.events.trainingGroupId, groupId))
    .orderBy(desc(schema.events.startsOn)).limit(1);
  const timeZone = latest?.timeZone ?? "Europe/Stockholm";
  const result = await tx.execute<{ today: string }>(sql`select to_char((${now.toISOString()}::timestamptz at time zone ${timeZone})::date,
    'YYYY-MM-DD') as today`);
  return { today: result.rows[0]!.today, timeZone };
}

/**
 * Säsongen (beslut 6): närvaro och poäng ur de publicerade resultaten för gruppens tidigare tillfällen (högst de 60 senaste).
 * Deltagarna känns igen på namnet (beslut 5, `groupParticipantKey`). Namnen är fullständiga; den publika sidan visar dem
 * enligt gruppens inställning.
 */
export async function groupSeason(db: Database, sessions: readonly GroupSession[], today: string, mode: GroupPointsMode)
  : Promise<{ sessions: number; rows: SeasonRow[] }> {
  const past = sessions.filter(row => row.raceDate <= today && row.hasResults).slice(-60);
  const lists = [];
  for (const session of past) {
    const list = await publicResults(db, session.raceId);
    lists.push({ raceId: session.raceId, raceDate: session.raceDate, results: list.results.flatMap(row => "givenName" in row ? [{
      key: groupParticipantKey(row), givenName: row.givenName, familyName: row.familyName, className: row.className, status: row.status,
      position: "position" in row ? row.position : undefined }] : []) });
  }
  return { sessions: past.length, rows: seasonTable(lists, mode) };
}

export async function readGroupAsLeader(db: Database, input: Proof & { groupId: string }, now = new Date())
  : Promise<GroupFailure | { status: "ok"; view: GroupLeaderView }> {
  const read = await db.transaction(async tx => {
    const leader = await requireGroupLeader(tx, input, now, false);
    if (leader.status !== "ok") return leader;
    const [group] = await tx.select().from(schema.trainingGroups).where(eq(schema.trainingGroups.id, input.groupId));
    if (!group) return { status: "not-found" } as const;
    const sessions = await groupSessions(tx, group.id);
    const series = await tx.select().from(schema.trainingGroupSeries).where(eq(schema.trainingGroupSeries.groupId, group.id))
      .orderBy(desc(schema.trainingGroupSeries.createdAt)).limit(200);
    const { today, timeZone } = await groupToday(tx, group.id, now);
    return { status: "ok" as const, accountId: leader.accountId, group, sessions, today, timeZone, members: await shownMembers(tx, group.id),
      maps: await listGroupLibraryMaps(tx, group.id),
      series: series.map((row): GroupSeries => ({ seriesId: row.id, weekday: row.weekday, startTime: row.startTime, firstDate: row.firstDate,
        lastDate: row.lastDate, undoneAt: row.undoneAt?.toISOString() ?? null, sessions: sessions.filter(session => session.seriesId === row.id).length })) };
  }, { isolationLevel: "repeatable read" });
  if (read.status !== "ok") return read;
  const { group } = read;
  const season = await groupSeason(db, read.sessions, read.today, group.pointsMode);
  return { status: "ok", view: { formatVersion: 1, groupId: group.id, viewer: { accountId: read.accountId, role: "LEADER" },
    settings: { name: group.name, code: group.code, pageVisibility: group.pageVisibility, nameDisplay: group.nameDisplay,
      statsVisibility: group.statsVisibility, pointsMode: group.pointsMode, templateRaceId: group.templateRaceId },
    members: read.members, sessions: read.sessions, series: read.series, maps: read.maps, today: read.today, timeZone: read.timeZone,
    season: { sessions: season.sessions, rows: season.rows.map(row => ({ key: row.key, givenName: row.givenName,
      familyName: row.familyName, attended: row.attended, points: row.points })) } } };
}

export async function updateGroupSettings(db: Database, input: Proof & { groupId: string; request: unknown }, now = new Date())
  : Promise<GroupFailure | { status: "ok"; settingsVersion: number }> {
  const parsed = groupSettingsRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const intent = parsed.data;
  return db.transaction(async tx => {
    const leader = await requireGroupLeader(tx, input, now, true);
    if (leader.status !== "ok") return leader;
    if (intent.templateRaceId) {
      const [inGroup] = await tx.select({ id: schema.races.id }).from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
        .where(and(eq(schema.races.id, intent.templateRaceId), eq(schema.events.trainingGroupId, input.groupId)));
      if (!inGroup) return { status: "invalid-request" } as const;
    }
    const [updated] = await tx.update(schema.trainingGroups).set({ name: intent.name, pageVisibility: intent.pageVisibility,
      nameDisplay: intent.nameDisplay, statsVisibility: intent.statsVisibility, pointsMode: intent.pointsMode, templateRaceId: intent.templateRaceId,
      settingsVersion: sql`${schema.trainingGroups.settingsVersion} + 1` }).where(eq(schema.trainingGroups.id, input.groupId))
      .returning({ settingsVersion: schema.trainingGroups.settingsVersion });
    if (!updated) return { status: "not-found" } as const;
    return { status: "ok", settingsVersion: updated.settingsVersion } as const;
  });
}

export async function addGroupMember(db: Database, input: Proof & { groupId: string; request: unknown }, now = new Date(),
  mailer?: InvitationMailer): Promise<GroupFailure | { status: "added"; replayed: boolean; member: GroupMember; mail: InvitationMailOutcome }> {
  const parsed = groupMemberAddRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const intent = parsed.data;
  const result = await db.transaction(async tx => {
    const leader = await requireGroupLeader(tx, input, now, true);
    if (leader.status !== "ok") return leader;
    // ADR-0189 beslut 9: sparas för adressen, samma svar med och utan konto. Personen blir medlem när den loggar in med adressen.
    const view = (row: typeof schema.trainingGroupInvitations.$inferSelect): GroupMember => ({ memberId: row.id, accountId: null, email: row.email,
      displayName: null, role: row.role, addedAt: row.createdAt.toISOString(), pending: true, sentAt: null });
    const [prior] = await tx.select().from(schema.trainingGroupInvitations).where(eq(schema.trainingGroupInvitations.requestId, intent.requestId));
    if (prior) {
      if (prior.groupId !== input.groupId || prior.email !== intent.email || prior.role !== intent.role) return { status: "conflict" } as const;
      return { status: "added", replayed: true, member: view(prior), prepared: undefined } as const;
    }
    // Redan med (adressen syns redan i listan, så svaret avslöjar inget nytt) eller redan inbjuden.
    const current = await members(tx, input.groupId);
    if (current.some(row => row.email === intent.email)) return { status: "conflict" } as const;
    const [invitation] = await tx.insert(schema.trainingGroupInvitations).values({ id: randomUUID(), requestId: intent.requestId,
      groupId: input.groupId, email: intent.email, role: intent.role, actorAccountId: leader.accountId, createdAt: now }).returning();
    if (!invitation) throw new Error("Inbjudan kunde inte sparas");
    // ADR-0206: mejlet går till adressen oavsett om den har ett konto.
    const prepared = await prepareIfMail(tx, mailer, { kind: "GROUP", invitationId: invitation.id }, leader.accountId, now);
    return { status: "added", replayed: false, member: view(invitation), prepared } as const;
  });
  if (result.status !== "added") return result;
  const { prepared, ...added } = result;
  const delivered = added.replayed ? { outcome: await replayedOutcome(db, { kind: "GROUP", invitationId: added.member.memberId }) }
    : await deliverPrepared(db, prepared, mailer, now);
  const sentAt = "sentAt" in delivered && delivered.sentAt ? delivered.sentAt.toISOString() : null;
  return { ...added, member: { ...added.member, sentAt }, mail: delivered.outcome };
}

export async function removeGroupMember(db: Database, input: Proof & { groupId: string; request: unknown }, now = new Date())
  : Promise<GroupFailure | { status: "removed" }> {
  const parsed = groupMemberRemoveRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const leader = await requireGroupLeader(tx, input, now, true);
    if (leader.status !== "ok") return leader;
    // Gruppens alla ledarrader låses, så att två ledare inte tar bort varandra samtidigt.
    const leaders = await tx.select({ id: schema.trainingGroupMembers.id }).from(schema.trainingGroupMembers)
      .where(and(eq(schema.trainingGroupMembers.groupId, input.groupId), eq(schema.trainingGroupMembers.role, "LEADER"))).for("update");
    let [target] = await tx.select().from(schema.trainingGroupMembers).where(and(eq(schema.trainingGroupMembers.id, parsed.data.memberId),
      eq(schema.trainingGroupMembers.groupId, input.groupId)));
    if (!target) {
      // ADR-0189 beslut 9: id:t är en inbjudan. Väntar den fortfarande tas den bort; är den tagen tas medlemmen bort.
      const [invitation] = await tx.select().from(schema.trainingGroupInvitations).where(and(
        eq(schema.trainingGroupInvitations.id, parsed.data.memberId), eq(schema.trainingGroupInvitations.groupId, input.groupId)));
      if (!invitation || invitation.revokedAt) return { status: "not-found" } as const;
      if (!invitation.acceptedAccountId) {
        await tx.update(schema.trainingGroupInvitations).set({ revokedAt: now })
          .where(and(eq(schema.trainingGroupInvitations.id, invitation.id), isNull(schema.trainingGroupInvitations.acceptedAt)));
        return { status: "removed" } as const;
      }
      [target] = await tx.select().from(schema.trainingGroupMembers).where(and(eq(schema.trainingGroupMembers.groupId, input.groupId),
        eq(schema.trainingGroupMembers.accountId, invitation.acceptedAccountId)));
      if (!target) return { status: "not-found" } as const;
    }
    if (target.role === "LEADER" && leaders.length <= 1) return { status: "conflict" } as const;
    await tx.delete(schema.trainingGroupMembers).where(eq(schema.trainingGroupMembers.id, target.id));
    return { status: "removed" } as const;
  });
}

/**
 * En befintlig tävling (hela evenemanget) läggs till i en grupp eller tas ur den. Kräver admin på tävlingen; att lägga till
 * kräver dessutom ledarskap i gruppen, och att ta ur kräver en egen roll som ägare eller administratör på evenemanget (annars
 * skulle tävlingen bli utan administratör).
 */
export async function setRaceGroup(db: Database, input: Proof & { raceId: string; request: unknown }, now = new Date())
  : Promise<GroupFailure | { status: "ok"; groupId: string | null }> {
  const parsed = raceGroupAttachRequestSchema.safeParse(input.request);
  if (!parsed.success || !UUID_PATTERN.test(input.raceId)) return { status: "invalid-request" };
  const groupId = parsed.data.groupId;
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const accountId = auth.principal.accountId;
    const [race] = await tx.select({ eventId: schema.races.eventId, groupId: schema.events.trainingGroupId }).from(schema.races)
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, input.raceId));
    if (!race) return { status: "not-found" } as const;
    const admin = await activeEventAdministrationGrant(tx, { accountId, eventId: race.eventId }, "update");
    if (!admin) return { status: "not-found" } as const;
    if (groupId === race.groupId) return { status: "ok", groupId } as const;
    if (race.groupId) {
      const explicit = await activeEventAdministrationGrant(tx, { accountId, eventId: race.eventId, explicitOnly: true }, "update");
      if (!explicit) return { status: "forbidden" } as const;
    }
    if (groupId && !await leaderMembership(tx, { accountId, groupId }, "update")) return { status: "forbidden" } as const;
    await tx.update(schema.events).set({ trainingGroupId: groupId, trainingGroupSeriesId: null }).where(eq(schema.events.id, race.eventId));
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "event", entityId: race.eventId,
      action: groupId ? "EVENT_ADDED_TO_TRAINING_GROUP" : "EVENT_REMOVED_FROM_TRAINING_GROUP", actorKind: "USER_ACCOUNT", actorId: accountId,
      before: { groupId: race.groupId }, after: { groupId }, createdAt: now });
    return { status: "ok", groupId } as const;
  });
}
