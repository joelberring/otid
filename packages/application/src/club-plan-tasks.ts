import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { clubPlanTaskCreateSchema, clubPlanTaskDoneSchema, type ClubPlanPerson, type MyPlanTasksResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { clubMembership, clubRoleAtLeast, requireClubRole, type ClubFailure, type ClubProof, type ClubTransaction as Transaction } from "./club-access";
import { confirmedMembersOf } from "./club-affiliations";
import { consumeInvitationMailAllowance } from "./invitation-links";
import { defaultRaceOrganiser } from "./race-club-archive";
import { insertEventWithRace } from "./organizer-events";
import { fillPlannedGroupRace } from "./training-group-sessions";
import { activeEventAdministrationGrant } from "./race-session";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";
import { authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead } from "./user-account";
import { swedishToday } from "@o-tid/domain";

/**
 * ADR-0221 beslut 2–4: uppgifterna i terminsplaneringen, "Mina uppgifter" och "Skapa träningen". Den som har en uppgift
 * får läsrätt i banläggningen (`course_setting_grant` med `COMMENT`) när träningen finns. Raden som planen gav har
 * uppgiftens id som `request_id`, så att den kan tas bort med uppgiften utan att röra en behörighet som någon gav för hand.
 */
const sessions = schema.clubPlanSessions;
const tasks = schema.clubPlanTasks;
const grants = schema.courseSettingGrants;
type Session = typeof sessions.$inferSelect;

/** Mejlet till den som får en uppgift med e-postadress (skickas efter att uppgiften har sparats). */
export interface PlanTaskMail {
  readonly to: string; readonly inviterName: string; readonly clubName: string; readonly taskTitle: string;
  readonly sessionTitle: string; readonly sessionDate: string; readonly startTime: string | null; readonly place: string;
}
export type PlanTaskMailer = (mail: PlanTaskMail) => Promise<void>;

/** Klubbens bekräftade medlemmar: raderna i klubben (med rollen) och de bekräftade tillhörigheterna (ADR-0209). */
export async function planPeople(tx: Transaction, clubId: string): Promise<ClubPlanPerson[]> {
  const rows = await tx.select({ accountId: schema.clubMembers.accountId, role: schema.clubMembers.role, name: schema.userAccounts.displayName })
    .from(schema.clubMembers).innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.clubMembers.accountId))
    .where(and(eq(schema.clubMembers.clubId, clubId), sql`${schema.userAccounts.blockedAt} is null`));
  const people = new Map<string, ClubPlanPerson>(rows.map(row => [row.accountId, { accountId: row.accountId, name: row.name,
    leader: clubRoleAtLeast(row.role, "LEADER") }]));
  for (const row of await confirmedMembersOf(tx, [clubId])) {
    if (!people.has(row.accountId)) people.set(row.accountId, { accountId: row.accountId, name: row.displayName, leader: false });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

/** "Mina uppgifter" visar också de senaste två veckorna, så att man hinner bocka av. */
const RECENT_DAYS = 14;

/** Läsrätt i banläggningen för kontot på träningen, om det inte redan har en behörighet där. */
async function grantCourseRead(tx: DbExecutor, input: { raceId: string; accountId: string; taskId: string; actorId: string; now: Date }) {
  const [race] = await tx.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, input.raceId));
  if (!race) return;
  if (await activeEventAdministrationGrant(tx, { accountId: input.accountId, eventId: race.eventId, roles: ["OWNER", "ADMIN"] }, "none")) return;
  await tx.insert(grants).values({ id: randomUUID(), raceId: input.raceId, accountId: input.accountId, level: "COMMENT", grantedAt: input.now,
    grantedBy: input.actorId, requestId: input.taskId }).onConflictDoNothing();
}

/**
 * Tar bort uppgifterna och den läsrätt de gav. Har personen en annan uppgift kvar på samma träning flyttas raden dit.
 * Används också när en hel rad tas bort ur planen.
 */
export async function removePlanTasks(tx: Transaction, session: Session, taskIds: readonly string[]): Promise<void> {
  if (taskIds.length === 0) return;
  if (session.raceId) {
    const leaving = await tx.select({ id: tasks.id, accountId: tasks.assigneeAccountId }).from(tasks).where(inArray(tasks.id, [...taskIds]));
    for (const task of leaving) {
      if (!task.accountId) continue;
      const [other] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.sessionId, session.id),
        eq(tasks.assigneeAccountId, task.accountId), sql`${tasks.id} not in (${sql.join(taskIds.map(id => sql`${id}::uuid`), sql`, `)})`)).limit(1);
      const mine = and(eq(grants.raceId, session.raceId), eq(grants.accountId, task.accountId), eq(grants.requestId, task.id));
      if (other) await tx.update(grants).set({ requestId: other.id }).where(mine);
      else await tx.delete(grants).where(mine);
    }
  }
  await tx.delete(tasks).where(inArray(tasks.id, [...taskIds]));
}

async function leaderSession(tx: Transaction, input: ClubProof & { clubId: string; sessionId: string }, now: Date) {
  const access = await requireClubRole(tx, input, "LEADER", now, true);
  if (access.status !== "ok") return access;
  if (!UUID_PATTERN.test(input.sessionId)) return { status: "not-found" } as const;
  const [session] = await tx.select().from(sessions).where(and(eq(sessions.id, input.sessionId), eq(sessions.clubId, access.clubId))).for("update");
  return session ? { status: "ok", access, session } as const : { status: "not-found" } as const;
}

export async function createPlanTask(db: Database, input: ClubProof & { clubId: string; sessionId: string; request: unknown }, now = new Date(),
  mailer?: PlanTaskMailer): Promise<ClubFailure | { status: "ok"; taskId: string; mailed: boolean }> {
  const parsed = clubPlanTaskCreateSchema.safeParse(input.request);
  const result = await db.transaction(async tx => {
    const found = await leaderSession(tx, input, now);
    if (found.status !== "ok") return found;
    const { access, session } = found;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { requestId, title, assignee } = parsed.data;
    const [prior] = await tx.select({ id: tasks.id, sessionId: tasks.sessionId }).from(tasks).where(eq(tasks.requestId, requestId));
    if (prior) return prior.sessionId === session.id ? { status: "ok", taskId: prior.id, mail: undefined } as const : { status: "conflict" } as const;
    if (assignee.kind === "MEMBER" && !(await planPeople(tx, access.clubId)).some(person => person.accountId === assignee.accountId)) {
      return { status: "invalid-request" } as const;
    }
    const id = randomUUID();
    // Adressen är redan normaliserad som kontots (NFC, gemener; `accountEmailSchema`).
    const email = assignee.kind === "EMAIL" ? assignee.email : null;
    const accountId = assignee.kind === "MEMBER" ? assignee.accountId : null;
    await tx.insert(tasks).values({ id, sessionId: session.id, title, assigneeAccountId: accountId, assigneeEmail: email, createdAt: now,
      createdBy: access.accountId, requestId });
    if (accountId && session.raceId) await grantCourseRead(tx, { raceId: session.raceId, accountId, taskId: id, actorId: access.accountId, now });
    if (!email || !mailer) return { status: "ok", taskId: id, mail: undefined } as const;
    // A1: samma spärr som inbjudningarna. Över gränsen sparas uppgiften men inget mejl skickas.
    if (!await consumeInvitationMailAllowance(tx, { issuedBy: access.accountId, email, now })) return { status: "ok", taskId: id, mail: undefined } as const;
    const [facts] = await tx.select({ inviterName: schema.userAccounts.displayName, clubName: schema.clubs.name }).from(schema.userAccounts)
      .innerJoin(schema.clubs, eq(schema.clubs.id, access.clubId)).where(eq(schema.userAccounts.id, access.accountId));
    const mail: PlanTaskMail = { to: email, inviterName: facts?.inviterName ?? "", clubName: facts?.clubName ?? "", taskTitle: title,
      sessionTitle: session.title, sessionDate: session.sessionDate, startTime: session.startTime, place: session.place };
    return { status: "ok", taskId: id, mail } as const;
  });
  if (result.status !== "ok") return result;
  let mailed = false;
  if (result.mail && mailer) {
    // Mejlet är en avisering: uppgiften gäller ändå när personen loggar in med adressen. Felet loggas av mejlaren.
    try { await mailer(result.mail); mailed = true; } catch { mailed = false; }
  }
  return { status: "ok", taskId: result.taskId, mailed };
}

export async function removePlanTask(db: Database, input: ClubProof & { clubId: string; sessionId: string; taskId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  return db.transaction(async tx => {
    const found = await leaderSession(tx, input, now);
    if (found.status !== "ok") return found;
    if (!UUID_PATTERN.test(input.taskId)) return { status: "not-found" } as const;
    const [task] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.sessionId, found.session.id)));
    if (!task) return { status: "not-found" } as const;
    await removePlanTasks(tx, found.session, [task.id]);
    return { status: "ok" } as const;
  });
}

/** Klar eller inte: den som har uppgiften, eller en ledare i klubben. */
export async function setPlanTaskDone(db: Database, input: ClubProof & { taskId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = clubPlanTaskDoneSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    if (!UUID_PATTERN.test(input.taskId)) return { status: "not-found" } as const;
    const [row] = await tx.select({ task: tasks, clubId: sessions.clubId }).from(tasks).innerJoin(sessions, eq(sessions.id, tasks.sessionId))
      .where(eq(tasks.id, input.taskId)).for("update", { of: tasks });
    if (!row) return { status: "not-found" } as const;
    const mine = row.task.assigneeAccountId === auth.principal.accountId;
    if (!mine) {
      const member = await clubMembership(tx, { accountId: auth.principal.accountId, clubId: row.clubId }, "share");
      if (!member) return { status: "not-found" } as const;
      if (!clubRoleAtLeast(member.role, "LEADER")) return { status: "forbidden" } as const;
    }
    if (!parsed.success) return { status: "invalid-request" } as const;
    await tx.update(tasks).set({ doneAt: parsed.data.done ? row.task.doneAt ?? now : null }).where(eq(tasks.id, row.task.id));
    return { status: "ok" } as const;
  });
}

/**
 * Uppgifterna som skrevs till kontots bekräftade adress blir kontots (som inbjudningarna, ADR-0206), med läsrätten på de
 * träningar som redan finns. Översynen B9: tas vid ankomsten (`acceptAllInvitations`), inte först i Mina uppgifter, så att
 * läsrätten i banläggningen finns direkt.
 */
export async function claimPlanTasks(tx: DbExecutor, accountId: string, now: Date): Promise<void> {
  const [account] = await tx.select({ email: schema.userAccounts.email, verifiedAt: schema.userAccounts.emailVerifiedAt })
    .from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
  if (!account?.verifiedAt) return;
  const claimed = await tx.update(tasks).set({ assigneeAccountId: accountId })
    .where(and(eq(tasks.assigneeEmail, account.email), isNull(tasks.assigneeAccountId))).returning({ id: tasks.id, sessionId: tasks.sessionId, createdBy: tasks.createdBy });
  for (const task of claimed) {
    const [session] = await tx.select({ raceId: sessions.raceId }).from(sessions).where(eq(sessions.id, task.sessionId));
    if (session?.raceId) await grantCourseRead(tx, { raceId: session.raceId, accountId, taskId: task.id, actorId: task.createdBy, now });
  }
}

export async function listMyPlanTasks(db: Database, proof: ClubProof, now = new Date())
  : Promise<ClubFailure | { status: "ok"; response: MyPlanTasksResponse }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    const accountId = auth.principal.accountId;
    const from = new Date(Date.parse(`${swedishToday(now)}T00:00:00Z`) - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
    const rows = await tx.select({ task: tasks, session: sessions, clubName: schema.clubs.name, mapName: schema.clubMaps.name,
      responsibleName: schema.userAccounts.displayName, raceExists: schema.races.id })
      .from(tasks).innerJoin(sessions, eq(sessions.id, tasks.sessionId)).innerJoin(schema.clubs, eq(schema.clubs.id, sessions.clubId))
      .leftJoin(schema.clubMaps, eq(schema.clubMaps.id, sessions.clubMapId))
      .leftJoin(schema.userAccounts, eq(schema.userAccounts.id, sessions.responsibleAccountId))
      .leftJoin(schema.races, eq(schema.races.id, sessions.raceId))
      .where(and(eq(tasks.assigneeAccountId, accountId), gte(sessions.sessionDate, from)))
      .orderBy(asc(sessions.sessionDate), asc(sessions.startTime), asc(tasks.createdAt)).limit(200);
    const sessionIds = [...new Set(rows.map(row => row.session.id))];
    const others = sessionIds.length === 0 ? [] : await tx.select({ sessionId: tasks.sessionId, title: tasks.title, doneAt: tasks.doneAt })
      .from(tasks).where(and(inArray(tasks.sessionId, sessionIds), ne(tasks.assigneeAccountId, accountId))).orderBy(asc(tasks.createdAt));
    const unassigned = sessionIds.length === 0 ? [] : await tx.select({ sessionId: tasks.sessionId, title: tasks.title, doneAt: tasks.doneAt })
      .from(tasks).where(and(inArray(tasks.sessionId, sessionIds), isNull(tasks.assigneeAccountId))).orderBy(asc(tasks.createdAt));
    return { status: "ok", response: { formatVersion: 1, tasks: rows.map(({ task, session, clubName, mapName, responsibleName, raceExists }) => ({
      taskId: task.id, title: task.title, done: task.doneAt !== null, clubName, sessionDate: session.sessionDate, startTime: session.startTime,
      sessionTitle: session.title, place: session.place, mapName: mapName ?? null, responsibleName: responsibleName ?? null,
      otherTasks: [...others, ...unassigned].filter(other => other.sessionId === session.id).map(other => ({ title: other.title, done: other.doneAt !== null })),
      raceId: raceExists ? session.raceId : null })) } } as const;
  });
}

export type PlannedRaceResult = ClubFailure | { status: "group-leader-only" } | { status: "ok"; raceId: string; replayed: boolean };

/**
 * "Skapa träningen" (beslut 2): en träning med planens rubrik, datum och tid, i träningsgruppen om en är vald (bara gruppens
 * ledare kan det) och annars en egen tävling med den som skapar som ägare. Den ansvarige blir administratör; de som har en
 * uppgift får läsrätt i banläggningen. Arrangörsklubben är klubbens organisation i Eventor när klubbytan är kopplad.
 */
export async function createPlannedRace(db: Database, input: ClubProof & { clubId: string; sessionId: string }, now = new Date())
  : Promise<PlannedRaceResult> {
  return db.transaction(async tx => {
    const found = await leaderSession(tx, input, now);
    if (found.status !== "ok") return found;
    const { access, session } = found;
    const responsible = session.responsibleAccountId;
    if (session.raceId) {
      const [race] = await tx.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.id, session.raceId));
      if (race) return { status: "ok", raceId: race.id, replayed: true } as const;
    }
    let groupId: string | null = null;
    if (session.trainingGroupId) {
      const [leader] = await tx.select({ id: schema.trainingGroupMembers.id }).from(schema.trainingGroupMembers)
        .where(and(eq(schema.trainingGroupMembers.groupId, session.trainingGroupId), eq(schema.trainingGroupMembers.accountId, access.accountId),
          eq(schema.trainingGroupMembers.role, "LEADER")));
      // Översynen B3: ett eget besked (inte "bara ledare"), eftersom personen är ledare i klubben men inte i gruppen.
      if (!leader) return { status: "group-leader-only" } as const;
      groupId = session.trainingGroupId;
    }
    const { event, race } = await insertEventWithRace(tx, { eventName: session.title, raceName: "", raceDate: session.sessionDate,
      timeZone: "Europe/Stockholm", raceType: "TRAINING", firstStartTime: session.startTime, trainingGroupId: groupId,
      ownerAccountId: groupId ? null : access.accountId, now });
    const sourceRaceId = groupId
      ? await fillPlannedGroupRace(tx, { groupId, raceId: race.id, raceDate: session.sessionDate, accountId: access.accountId, now }) : null;
    const [setting] = await tx.select({ organisationId: schema.clubSettings.organisationId }).from(schema.clubSettings)
      .where(eq(schema.clubSettings.clubId, access.clubId));
    if (setting?.organisationId) {
      await tx.insert(schema.raceOrganisers).values({ raceId: race.id, organisationId: setting.organisationId, setBy: access.accountId, setAt: now })
        .onConflictDoNothing();
    } else await defaultRaceOrganiser(tx, { raceId: race.id, accountId: access.accountId, now });
    await attachRace(tx, { session, raceId: race.id, eventId: event.id, actorId: access.accountId, now });
    await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "race", entityId: race.id, action: "CLUB_PLAN_RACE_CREATED",
      actorKind: "USER_ACCOUNT", actorId: access.accountId, requestId: null,
      after: { clubId: access.clubId, sessionId: session.id, groupId, sourceRaceId, responsibleAccountId: responsible, raceDate: session.sessionDate }, createdAt: now });
    return { status: "ok", raceId: race.id, replayed: false } as const;
  });
}

/**
 * En träning knuten till planens rad: den ansvarige blir administratör, uppgifternas personer får läsrätt i banläggningen
 * och raden pekar på träningen. Delas av Skapa träningen och Koppla en träning.
 */
async function attachRace(tx: Transaction, input: { session: Session; raceId: string; eventId: string; actorId: string; now: Date }) {
  const { session, raceId, eventId, actorId, now } = input;
  const responsible = session.responsibleAccountId;
  if (responsible && responsible !== actorId
    && !await activeEventAdministrationGrant(tx, { accountId: responsible, eventId, roles: ["OWNER", "ADMIN"] }, "none")) {
    await tx.insert(schema.eventAdministrationGrants).values({ eventId, accountId: responsible, role: "ADMIN", grantedAt: now });
  }
  for (const task of await tx.select({ id: tasks.id, accountId: tasks.assigneeAccountId }).from(tasks).where(eq(tasks.sessionId, session.id))) {
    if (task.accountId) await grantCourseRead(tx, { raceId, accountId: task.accountId, taskId: task.id, actorId, now });
  }
  await tx.update(sessions).set({ raceId, version: session.version + 1, updatedAt: now }).where(eq(sessions.id, session.id));
}

export type LinkPlannedRaceResult = ClubFailure | { status: "race-forbidden" } | { status: "ok"; raceId: string | null };

/**
 * Ägaren 2026-11-10: "Koppla en träning" – en banläggning som redan finns (egen, kopierad ur arkivet med Använd igen eller
 * gjord i en grupp) knyts till planens rad. Bara den som är ägare eller administratör för träningen får koppla den; null
 * tar bort kopplingen (träningen ändras inte). En rad som redan har en träning byter till den nya.
 */
export async function linkPlannedRace(db: Database, input: ClubProof & { clubId: string; sessionId: string; request: unknown }, now = new Date())
  : Promise<LinkPlannedRaceResult> {
  const raw = input.request as { formatVersion?: unknown; raceId?: unknown } | null;
  const raceId = raw?.raceId === null ? null : typeof raw?.raceId === "string" && UUID_PATTERN.test(raw.raceId) ? raw.raceId : undefined;
  return db.transaction(async tx => {
    // Behörigheten först: den som inte får ändra planen får 403, inte 400, oavsett vad som skickades.
    const found = await leaderSession(tx, input, now);
    if (found.status !== "ok") return found;
    if (raw?.formatVersion !== 1 || raceId === undefined) return { status: "invalid-request" } as const;
    const { access, session } = found;
    if (raceId === null) {
      await tx.update(sessions).set({ raceId: null, version: session.version + 1, updatedAt: now }).where(eq(sessions.id, session.id));
      return { status: "ok", raceId: null } as const;
    }
    const [race] = await tx.select({ id: schema.races.id, eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, raceId));
    if (!race || !await activeEventAdministrationGrant(tx, { accountId: access.accountId, eventId: race.eventId, roles: ["OWNER", "ADMIN"] }, "none")) {
      return { status: "race-forbidden" } as const;
    }
    await attachRace(tx, { session, raceId: race.id, eventId: race.eventId, actorId: access.accountId, now });
    await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "race", entityId: race.id, action: "CLUB_PLAN_RACE_LINKED",
      actorKind: "USER_ACCOUNT", actorId: access.accountId, requestId: null,
      after: { clubId: access.clubId, sessionId: session.id, previousRaceId: session.raceId }, createdAt: now });
    return { status: "ok", raceId: race.id } as const;
  });
}
