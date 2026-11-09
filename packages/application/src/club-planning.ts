import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  clubPlanSessionCreateSchema, clubPlanSessionUpdateSchema, clubTermRequestSchema, clubTermUpdateSchema,
  type ClubPlanResponse, type ClubPlanSessionView, type ClubTermView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { inTerm, isoWeekday, MAX_TERM_DAYS, repetitionDates } from "@o-tid/domain";
import { requireClubRole, type ClubFailure, type ClubProof, type ClubTransaction as Transaction } from "./club-access";
import { planPeople, removePlanTasks } from "./club-plan-tasks";
import { UUID_PATTERN } from "./serialization";

/**
 * ADR-0221: terminsplaneringen i klubbytan. Ledare, administratörer och ägare läser och ändrar terminerna och de planerade
 * träningarna. Uppgifterna, "Mina uppgifter" och "Skapa träningen" finns i `club-plan-tasks`.
 */
const terms = schema.clubTerms;
const sessions = schema.clubPlanSessions;
const tasks = schema.clubPlanTasks;
const DAY_MS = 86_400_000;
/** Högst så här många planerade träningar i en termin (en om dagen räcker gott). */
const MAX_TERM_SESSIONS = 400;

type Input = ClubProof & { clubId: string };
const today = (now: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(now);
const termDays = (startsOn: string, endsOn: string) => (Date.parse(endsOn) - Date.parse(startsOn)) / DAY_MS;

async function termViews(tx: Transaction, clubId: string): Promise<ClubTermView[]> {
  const rows = await tx.select({ termId: terms.id, name: terms.name, startsOn: terms.startsOn, endsOn: terms.endsOn,
    sessions: sql<number>`(select count(*)::int from club_plan_session s where s.term_id = "club_term"."id")` })
    .from(terms).where(eq(terms.clubId, clubId)).orderBy(asc(terms.startsOn), asc(terms.name));
  return rows;
}

/** Terminen att visa: den valda, annars den som pågår, annars nästa, annars den senaste. */
function chosenTerm(all: readonly ClubTermView[], termId: string | null, now: Date): ClubTermView | undefined {
  if (termId) return all.find(term => term.termId === termId);
  const day = today(now);
  return all.find(term => inTerm(day, term)) ?? all.find(term => term.startsOn > day) ?? all[all.length - 1];
}

/** De planerade träningarna med kartans, gruppens och de ansvarigas namn och uppgifterna (för ledarna, med adresserna). */
async function sessionViews(tx: Transaction, termId: string): Promise<ClubPlanSessionView[]> {
  const rows = await tx.select({ session: sessions, mapName: schema.clubMaps.name, groupName: schema.trainingGroups.name,
    responsibleName: schema.userAccounts.displayName, raceExists: schema.races.id })
    .from(sessions).leftJoin(schema.clubMaps, eq(schema.clubMaps.id, sessions.clubMapId))
    .leftJoin(schema.trainingGroups, eq(schema.trainingGroups.id, sessions.trainingGroupId))
    .leftJoin(schema.userAccounts, eq(schema.userAccounts.id, sessions.responsibleAccountId))
    .leftJoin(schema.races, eq(schema.races.id, sessions.raceId))
    .where(eq(sessions.termId, termId)).orderBy(asc(sessions.sessionDate), asc(sessions.startTime), asc(sessions.createdAt)).limit(MAX_TERM_SESSIONS);
  const ids = rows.map(row => row.session.id);
  const taskRows = ids.length === 0 ? [] : await tx.select({ task: tasks, name: schema.userAccounts.displayName }).from(tasks)
    .leftJoin(schema.userAccounts, eq(schema.userAccounts.id, tasks.assigneeAccountId))
    .where(inArray(tasks.sessionId, ids)).orderBy(asc(tasks.createdAt));
  return rows.map(({ session, mapName, groupName, responsibleName, raceExists }) => ({
    sessionId: session.id, version: session.version, sessionDate: session.sessionDate, startTime: session.startTime, title: session.title,
    place: session.place, note: session.note, clubMapId: mapName ? session.clubMapId : null, mapName: mapName ?? null,
    trainingGroupId: groupName ? session.trainingGroupId : null, groupName: groupName ?? null,
    responsibleAccountId: responsibleName ? session.responsibleAccountId : null, responsibleName: responsibleName ?? null,
    raceId: raceExists ? session.raceId : null,
    tasks: taskRows.filter(row => row.task.sessionId === session.id).map(({ task, name }) => ({ taskId: task.id, title: task.title,
      assigneeName: name ?? null, assigneeEmail: name ? null : task.assigneeEmail, pending: !name && task.assigneeEmail !== null,
      done: task.doneAt !== null }))
  }));
}

export async function readClubPlan(db: Database, input: Input & { termId: string | null }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; response: ClubPlanResponse }> {
  if (input.termId !== null && !UUID_PATTERN.test(input.termId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, "LEADER", now, false);
    if (access.status !== "ok") return access;
    const all = await termViews(tx, access.clubId);
    const term = chosenTerm(all, input.termId, now);
    if (input.termId && !term) return { status: "not-found" } as const;
    const maps = await tx.select({ mapId: schema.clubMaps.id, name: schema.clubMaps.name }).from(schema.clubMaps)
      .where(eq(schema.clubMaps.clubId, access.clubId)).orderBy(asc(schema.clubMaps.name)).limit(2000);
    const groups = await tx.select({ groupId: schema.trainingGroups.id, name: schema.trainingGroups.name }).from(schema.trainingGroupMembers)
      .innerJoin(schema.trainingGroups, eq(schema.trainingGroups.id, schema.trainingGroupMembers.groupId))
      .where(and(eq(schema.trainingGroupMembers.accountId, access.accountId), eq(schema.trainingGroupMembers.role, "LEADER")))
      .orderBy(asc(schema.trainingGroups.name));
    return { status: "ok", response: { formatVersion: 1, terms: all, people: await planPeople(tx, access.clubId), maps, groups,
      term: term ? { ...term, planSessions: await sessionViews(tx, term.termId) } : null } } as const;
  });
}

export async function createClubTerm(db: Database, input: Input & { request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; termId: string }> {
  const parsed = clubTermRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, "LEADER", now, true);
    if (access.status !== "ok") return access;
    if (!parsed.success || termDays(parsed.data.startsOn, parsed.data.endsOn) < 0
      || termDays(parsed.data.startsOn, parsed.data.endsOn) > MAX_TERM_DAYS) return { status: "invalid-request" } as const;
    const [prior] = await tx.select({ id: terms.id, clubId: terms.clubId }).from(terms).where(eq(terms.requestId, parsed.data.requestId));
    if (prior) return prior.clubId === access.clubId ? { status: "ok", termId: prior.id } as const : { status: "conflict" } as const;
    const id = randomUUID();
    await tx.insert(terms).values({ id, clubId: access.clubId, name: parsed.data.name, startsOn: parsed.data.startsOn, endsOn: parsed.data.endsOn,
      createdAt: now, createdBy: access.accountId, requestId: parsed.data.requestId });
    return { status: "ok", termId: id } as const;
  });
}

/** Namn och datum; de planerade träningarna måste rymmas i de nya datumen. Tas bort bara när den är tom. */
export async function changeClubTerm(db: Database, input: Input & { termId: string; request: unknown; remove: boolean }, now = new Date())
  : Promise<ClubFailure | { status: "ok" } | { status: "outside" | "not-empty" }> {
  const parsed = input.remove ? undefined : clubTermUpdateSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, "LEADER", now, true);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.termId)) return { status: "not-found" } as const;
    const [term] = await tx.select().from(terms).where(and(eq(terms.id, input.termId), eq(terms.clubId, access.clubId))).for("update");
    if (!term) return { status: "not-found" } as const;
    const planned = await tx.select({ date: sessions.sessionDate }).from(sessions).where(eq(sessions.termId, term.id));
    if (input.remove) {
      if (planned.length > 0) return { status: "not-empty" } as const;
      await tx.delete(terms).where(eq(terms.id, term.id));
      return { status: "ok" } as const;
    }
    if (!parsed?.success || termDays(parsed.data.startsOn, parsed.data.endsOn) < 0
      || termDays(parsed.data.startsOn, parsed.data.endsOn) > MAX_TERM_DAYS) return { status: "invalid-request" } as const;
    if (planned.some(row => !inTerm(row.date, parsed.data))) return { status: "outside" } as const;
    await tx.update(terms).set({ name: parsed.data.name, startsOn: parsed.data.startsOn, endsOn: parsed.data.endsOn }).where(eq(terms.id, term.id));
    return { status: "ok" } as const;
  });
}

/** Kartan ur klubbens kartbank, en grupp där den inloggade är ledare och en ansvarig som är ledare i klubben (eller inget). */
async function validReferences(tx: Transaction, clubId: string, accountId: string,
  fields: { clubMapId: string | null; trainingGroupId: string | null; responsibleAccountId: string | null }, keep?: typeof sessions.$inferSelect) {
  if (fields.clubMapId && fields.clubMapId !== keep?.clubMapId) {
    const [map] = await tx.select({ id: schema.clubMaps.id }).from(schema.clubMaps)
      .where(and(eq(schema.clubMaps.id, fields.clubMapId), eq(schema.clubMaps.clubId, clubId)));
    if (!map) return false;
  }
  if (fields.trainingGroupId && fields.trainingGroupId !== keep?.trainingGroupId) {
    const [leader] = await tx.select({ id: schema.trainingGroupMembers.id }).from(schema.trainingGroupMembers)
      .where(and(eq(schema.trainingGroupMembers.groupId, fields.trainingGroupId), eq(schema.trainingGroupMembers.accountId, accountId),
        eq(schema.trainingGroupMembers.role, "LEADER")));
    if (!leader) return false;
  }
  if (fields.responsibleAccountId && fields.responsibleAccountId !== keep?.responsibleAccountId) {
    const person = (await planPeople(tx, clubId)).find(row => row.accountId === fields.responsibleAccountId);
    if (!person?.leader) return false;
  }
  return true;
}

/** En träning, eller samma träning varje vecka till terminens slut (`weekly`). */
export async function createPlanSessions(db: Database, input: Input & { request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; sessionIds: string[] } | { status: "outside" | "too-many" }> {
  const parsed = clubPlanSessionCreateSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, "LEADER", now, true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { requestId, termId, weekly, ...fields } = parsed.data;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"club-plan-session:" + requestId}, 0))`);
    const [prior] = await tx.select({ clubId: sessions.clubId, termId: sessions.termId, createdAt: sessions.createdAt, createdBy: sessions.createdBy })
      .from(sessions).where(eq(sessions.requestId, requestId));
    if (prior) {
      if (prior.clubId !== access.clubId || prior.createdBy !== access.accountId) return { status: "conflict" } as const;
      // Samma begäran igen: raderna som skapades i samma anrop (samma termin, tid och person).
      const series = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.termId, prior.termId),
        eq(sessions.createdAt, prior.createdAt), eq(sessions.createdBy, prior.createdBy))).orderBy(asc(sessions.sessionDate));
      return { status: "ok", sessionIds: series.map(row => row.id) } as const;
    }
    const [term] = await tx.select().from(terms).where(and(eq(terms.id, termId), eq(terms.clubId, access.clubId))).for("share");
    if (!term) return { status: "not-found" } as const;
    if (!inTerm(fields.sessionDate, term)) return { status: "outside" } as const;
    if (!await validReferences(tx, access.clubId, access.accountId, fields)) return { status: "invalid-request" } as const;
    const dates = weekly ? repetitionDates({ weekday: isoWeekday(fields.sessionDate), firstDate: fields.sessionDate, lastDate: term.endsOn })
      : [fields.sessionDate];
    if (!dates || dates.length === 0) return { status: "invalid-request" } as const;
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(sessions).where(eq(sessions.termId, term.id));
    if ((count?.n ?? 0) + dates.length > MAX_TERM_SESSIONS) return { status: "too-many" } as const;
    const rows = dates.map((sessionDate, index) => ({ id: randomUUID(), clubId: access.clubId, termId: term.id, ...fields, sessionDate,
      createdAt: now, createdBy: access.accountId, updatedAt: now, requestId: index === 0 ? requestId : randomUUID() }));
    await tx.insert(sessions).values(rows);
    return { status: "ok", sessionIds: rows.map(row => row.id) } as const;
  });
}

export async function updatePlanSession(db: Database, input: Input & { sessionId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; version: number } | { status: "outside" }> {
  const parsed = clubPlanSessionUpdateSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, "LEADER", now, true);
    if (access.status !== "ok") return access;
    if (!parsed.success || !UUID_PATTERN.test(input.sessionId)) return { status: "invalid-request" } as const;
    const [row] = await tx.select({ session: sessions, term: terms }).from(sessions).innerJoin(terms, eq(terms.id, sessions.termId))
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.clubId, access.clubId))).for("update", { of: sessions });
    if (!row) return { status: "not-found" } as const;
    const { version, ...fields } = parsed.data;
    if (row.session.version !== version) return { status: "conflict" } as const;
    if (!inTerm(fields.sessionDate, row.term)) return { status: "outside" } as const;
    if (!await validReferences(tx, access.clubId, access.accountId, fields, row.session)) return { status: "invalid-request" } as const;
    await tx.update(sessions).set({ ...fields, version: version + 1, updatedAt: now }).where(eq(sessions.id, row.session.id));
    return { status: "ok", version: version + 1 } as const;
  });
}

/** Tar bort raden ur planen med uppgifterna (och deras läsrätt). En träning som redan har skapats står kvar. */
export async function removePlanSession(db: Database, input: Input & { sessionId: string }, now = new Date()): Promise<ClubFailure | { status: "ok" }> {
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, "LEADER", now, true);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.sessionId)) return { status: "not-found" } as const;
    const [session] = await tx.select().from(sessions).where(and(eq(sessions.id, input.sessionId), eq(sessions.clubId, access.clubId))).for("update");
    if (!session) return { status: "not-found" } as const;
    await removePlanTasks(tx, session, (await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.sessionId, session.id))).map(row => row.id));
    await tx.delete(sessions).where(eq(sessions.id, session.id));
    return { status: "ok" } as const;
  });
}
