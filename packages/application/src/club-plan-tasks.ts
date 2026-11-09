import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { clubPlanTaskCreateSchema, clubPlanTaskDoneSchema, type ClubPlanPerson, type MyPlanTasksResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { clubMembership, clubRoleAtLeast, requireClubRole, type ClubFailure, type ClubProof, type ClubTransaction as Transaction } from "./club-access";
import { confirmedMembersOf } from "./club-affiliations";
import { defaultRaceOrganiser } from "./race-club-archive";
import { activeEventAdministrationGrant } from "./race-session";
import { UUID_PATTERN } from "./serialization";
import { authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead } from "./user-account";

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

const today = (now: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(now);
/** "Mina uppgifter" visar också de senaste två veckorna, så att man hinner bocka av. */
const RECENT_DAYS = 14;

/** Läsrätt i banläggningen för kontot på träningen, om det inte redan har en behörighet där. */
async function grantCourseRead(tx: Transaction, input: { raceId: string; accountId: string; taskId: string; actorId: string; now: Date }) {
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
    const email = assignee.kind === "EMAIL" ? assignee.email.trim().toLowerCase() : null;
    const accountId = assignee.kind === "MEMBER" ? assignee.accountId : null;
    await tx.insert(tasks).values({ id, sessionId: session.id, title, assigneeAccountId: accountId, assigneeEmail: email, createdAt: now,
      createdBy: access.accountId, requestId });
    if (accountId && session.raceId) await grantCourseRead(tx, { raceId: session.raceId, accountId, taskId: id, actorId: access.accountId, now });
    if (!email || !mailer) return { status: "ok", taskId: id, mail: undefined } as const;
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
 * träningar som redan finns.
 */
async function claimTasks(tx: Transaction, accountId: string, now: Date): Promise<void> {
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
    await claimTasks(tx, accountId, now);
    const from = new Date(Date.parse(`${today(now)}T00:00:00Z`) - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
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

export type PlannedRaceResult = ClubFailure | { status: "ok"; raceId: string; replayed: boolean };

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
    if (session.raceId) {
      const [race] = await tx.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.id, session.raceId));
      if (race) return { status: "ok", raceId: race.id, replayed: true } as const;
    }
    let groupId: string | null = null;
    if (session.trainingGroupId) {
      const [leader] = await tx.select({ id: schema.trainingGroupMembers.id }).from(schema.trainingGroupMembers)
        .where(and(eq(schema.trainingGroupMembers.groupId, session.trainingGroupId), eq(schema.trainingGroupMembers.accountId, access.accountId),
          eq(schema.trainingGroupMembers.role, "LEADER")));
      if (!leader) return { status: "forbidden" } as const;
      groupId = session.trainingGroupId;
    }
    const [event] = await tx.insert(schema.events).values({ name: session.title, startsOn: session.sessionDate, timeZone: "Europe/Stockholm",
      trainingGroupId: groupId, createdAt: now }).returning({ id: schema.events.id });
    if (!event) throw new Error("Evenemanget kunde inte skapas");
    const [race] = await tx.insert(schema.races).values({ eventId: event.id, name: "", raceDate: session.sessionDate, raceType: "TRAINING",
      firstStartTime: session.startTime, snapshotVersion: 1, createdAt: now }).returning({ id: schema.races.id });
    if (!race) throw new Error("Träningen kunde inte skapas");
    if (!groupId) await tx.insert(schema.eventAdministrationGrants).values({ eventId: event.id, accountId: access.accountId, role: "OWNER", grantedAt: now });
    const responsible = session.responsibleAccountId;
    if (responsible && responsible !== access.accountId
      && !await activeEventAdministrationGrant(tx, { accountId: responsible, eventId: event.id, roles: ["OWNER", "ADMIN"] }, "none")) {
      await tx.insert(schema.eventAdministrationGrants).values({ eventId: event.id, accountId: responsible, role: "ADMIN", grantedAt: now });
    }
    const [setting] = await tx.select({ organisationId: schema.clubSettings.organisationId }).from(schema.clubSettings)
      .where(eq(schema.clubSettings.clubId, access.clubId));
    if (setting?.organisationId) {
      await tx.insert(schema.raceOrganisers).values({ raceId: race.id, organisationId: setting.organisationId, setBy: access.accountId, setAt: now })
        .onConflictDoNothing();
    } else await defaultRaceOrganiser(tx, { raceId: race.id, accountId: access.accountId, now });
    for (const task of await tx.select({ id: tasks.id, accountId: tasks.assigneeAccountId }).from(tasks).where(eq(tasks.sessionId, session.id))) {
      if (task.accountId) await grantCourseRead(tx, { raceId: race.id, accountId: task.accountId, taskId: task.id, actorId: access.accountId, now });
    }
    await tx.update(sessions).set({ raceId: race.id, version: session.version + 1, updatedAt: now }).where(eq(sessions.id, session.id));
    await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "race", entityId: race.id, action: "CLUB_PLAN_RACE_CREATED",
      actorKind: "USER_ACCOUNT", actorId: access.accountId, requestId: null,
      after: { clubId: access.clubId, sessionId: session.id, groupId, responsibleAccountId: responsible, raceDate: session.sessionDate }, createdAt: now });
    return { status: "ok", raceId: race.id, replayed: false } as const;
  });
}
