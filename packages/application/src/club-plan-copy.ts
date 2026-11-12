import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  clubPlanFromArchiveSchema, clubPlanPeopleCopySchema, clubTermCopySchema, orderedLevels, orderedMoments
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { inTerm, isoWeekday } from "@o-tid/domain";
import { requireClubRole, type ClubFailure, type ClubProof, type ClubTransaction as Transaction } from "./club-access";
import { archivePeople, clubLeaders, copiedPeople, insertCopiedTasks, sessionPeople } from "./club-plan-people";
import { MAX_TERM_SESSIONS } from "./club-planning";
import { grantCourseRead } from "./club-plan-tasks";
import { activeEventAdministrationGrant } from "./race-session";
import { UUID_PATTERN } from "./serialization";

/**
 * Ägaren 2026-11-12 (ADR-0221 tillägg 2026-11-12): att kopiera träningar i terminsplanen – Hämta ur arkivet (en arkivträning
 * blir en planerad träning), arkivträningens personer till en planerad träning (Använd igen → Till terminsplanen) och Kopiera
 * upplägg från termin. Ledare, administratörer och ägare i klubbytan (som resten av planen). Personerna enligt personregeln i
 * `club-plan-people`; inga mejl. Ingen träning skapas här: banorna och kartan läggs på med Använd igen eller Skapa träningen.
 */
const sessions = schema.clubPlanSessions;
const terms = schema.clubTerms;
const tasks = schema.clubPlanTasks;
const DAY_MS = 86_400_000;
type Input = ClubProof & { clubId: string };

/** Arkivets egna märken (lyftet sätter dem) följer inte med som egna ord. */
const AUTOMATIC_TAGS = new Set(["träning", "tävling"]);
const planTags = (values: readonly string[]) => [...new Set(values.map(value => value.trim()).filter(value => value && value.length <= 40
  && !AUTOMATIC_TAGS.has(value.toLocaleLowerCase("sv-SE"))))].slice(0, 30);

/** Arkivträningens karta: kartan i träningens mapp, annars kartan som en banfil pekar på. */
async function entryMap(tx: Transaction, entryId: string): Promise<string | null> {
  const [folder] = await tx.select({ mapId: schema.clubMapVersions.mapId }).from(schema.clubArchiveEntryMaps)
    .innerJoin(schema.clubMapVersions, eq(schema.clubMapVersions.id, schema.clubArchiveEntryMaps.versionId))
    .where(eq(schema.clubArchiveEntryMaps.entryId, entryId)).orderBy(asc(schema.clubMapVersions.uploadedAt)).limit(1);
  if (folder) return folder.mapId;
  const [file] = await tx.select({ mapId: schema.clubMapVersions.mapId }).from(schema.clubArchiveCourseFiles)
    .innerJoin(schema.clubMapVersions, eq(schema.clubMapVersions.id, schema.clubArchiveCourseFiles.mapVersionId))
    .where(and(eq(schema.clubArchiveCourseFiles.entryId, entryId), isNotNull(schema.clubArchiveCourseFiles.mapVersionId))).limit(1);
  return file?.mapId ?? null;
}

const sessionCount = async (tx: Transaction, termId: string) =>
  (await tx.select({ n: sql<number>`count(*)::int` }).from(sessions).where(eq(sessions.termId, termId)))[0]?.n ?? 0;

/** "Hämta ur arkivet": arkivträningen som en planerad träning på dagen i veckan. Idempotent på `requestId`. */
export async function createPlanSessionFromArchive(db: Database, input: Input & { termId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; sessionId: string } | { status: "outside" | "too-many" }> {
  const parsed = clubPlanFromArchiveSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, "LEADER", now, true);
    if (access.status !== "ok") return access;
    if (!parsed.success || !UUID_PATTERN.test(input.termId)) return { status: "invalid-request" } as const;
    const { requestId, entryId, sessionDate, startTime, withMoments, withPeople } = parsed.data;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"club-plan-session:" + requestId}, 0))`);
    const [prior] = await tx.select({ id: sessions.id, clubId: sessions.clubId, createdBy: sessions.createdBy }).from(sessions)
      .where(eq(sessions.requestId, requestId));
    if (prior) return prior.clubId === access.clubId && prior.createdBy === access.accountId ? { status: "ok", sessionId: prior.id } as const
      : { status: "conflict" } as const;
    const [term] = await tx.select().from(terms).where(and(eq(terms.id, input.termId), eq(terms.clubId, access.clubId))).for("share");
    if (!term) return { status: "not-found" } as const;
    const [entry] = await tx.select().from(schema.clubArchiveEntries)
      .where(and(eq(schema.clubArchiveEntries.id, entryId), eq(schema.clubArchiveEntries.clubId, access.clubId)));
    if (!entry) return { status: "not-found" } as const;
    if (!inTerm(sessionDate, term)) return { status: "outside" } as const;
    if (await sessionCount(tx, term.id) + 1 > MAX_TERM_SESSIONS) return { status: "too-many" } as const;
    const people = withPeople ? copiedPeople(await archivePeople(tx, entry.id), await clubLeaders(tx, access.clubId))
      : { responsibleAccountId: null, tasks: [] };
    const id = randomUUID();
    await tx.insert(sessions).values({ id, clubId: access.clubId, termId: term.id, sessionDate, startTime, title: entry.title.slice(0, 160),
      place: entry.place.slice(0, 160), note: (entry.notes ?? "").slice(0, 2000), clubMapId: await entryMap(tx, entry.id), trainingGroupId: null,
      responsibleAccountId: people.responsibleAccountId, moments: withMoments ? orderedMoments(entry.moments) : [],
      levels: withMoments ? orderedLevels(entry.levels) : [], tags: withMoments ? planTags(entry.tags) : [], createdAt: now,
      createdBy: access.accountId, updatedAt: now, requestId });
    await insertCopiedTasks(tx, { sessionId: id, tasks: people.tasks, actorId: access.accountId, now });
    return { status: "ok", sessionId: id } as const;
  });
}

/**
 * Arkivträningens personer till en planerad träning i samma klubb (Använd igen → Till terminsplanen). Den ansvarige sätts bara
 * om raden saknar en; en uppgift med samma rubrik som en som redan finns läggs inte till igen (samma anrop två gånger ändrar
 * inget). Har raden redan en träning får de nya personerna behörigheterna som när träningen kopplas.
 */
export async function copyArchivePeopleToSession(db: Database, input: Input & { sessionId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; responsible: boolean; tasks: number }> {
  const parsed = clubPlanPeopleCopySchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, "LEADER", now, true);
    if (access.status !== "ok") return access;
    if (!parsed.success || !UUID_PATTERN.test(input.sessionId)) return { status: "invalid-request" } as const;
    const [session] = await tx.select().from(sessions).where(and(eq(sessions.id, input.sessionId), eq(sessions.clubId, access.clubId))).for("update");
    const [entry] = await tx.select({ id: schema.clubArchiveEntries.id }).from(schema.clubArchiveEntries)
      .where(and(eq(schema.clubArchiveEntries.id, parsed.data.entryId), eq(schema.clubArchiveEntries.clubId, access.clubId)));
    if (!session || !entry) return { status: "not-found" } as const;
    const people = copiedPeople(await archivePeople(tx, entry.id), await clubLeaders(tx, access.clubId));
    const existing = new Set((await tx.select({ title: tasks.title }).from(tasks).where(eq(tasks.sessionId, session.id)))
      .map(row => row.title.trim().toLocaleLowerCase("sv-SE")));
    const added = people.tasks.filter(task => !existing.has(task.title.toLocaleLowerCase("sv-SE")));
    const responsible = !session.responsibleAccountId && people.responsibleAccountId ? people.responsibleAccountId : null;
    if (responsible) {
      await tx.update(sessions).set({ responsibleAccountId: responsible, version: session.version + 1, updatedAt: now }).where(eq(sessions.id, session.id));
    }
    const inserted = await insertCopiedTasks(tx, { sessionId: session.id, tasks: added, actorId: access.accountId, now });
    const [race] = session.raceId ? await tx.select({ id: schema.races.id, eventId: schema.races.eventId }).from(schema.races)
      .where(eq(schema.races.id, session.raceId)) : [];
    if (race) {
      if (responsible && !await activeEventAdministrationGrant(tx, { accountId: responsible, eventId: race.eventId, roles: ["OWNER", "ADMIN"] }, "none")) {
        await tx.insert(schema.eventAdministrationGrants).values({ eventId: race.eventId, accountId: responsible, role: "ADMIN", grantedAt: now });
      }
      for (const task of inserted) {
        if (task.accountId) await grantCourseRead(tx, { raceId: race.id, accountId: task.accountId, taskId: task.id, actorId: access.accountId, now });
      }
    }
    return { status: "ok", responsible: responsible !== null, tasks: inserted.length } as const;
  });
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const fromDayNumber = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const mondayOf = (date: string) => dayNumber(date) - (isoWeekday(date) - 1);

/**
 * "Kopiera upplägg från termin": varje planerad träning i `fromTermId` till samma veckodag i motsvarande vecka i den tomma
 * terminen (räknat från terminernas första veckor), med rubrik, tid, plats, anteckning, karta, moment, nivåer och egna ord.
 * Gruppen följer med när den som kopierar är ledare i den (som när en rad skapas). Rader som hamnar utanför terminen räknas.
 * Ingen träning skapas. Terminen måste vara tom, så en upprepad begäran gör inga dubbletter.
 */
export async function copyTermPlan(db: Database, input: Input & { termId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; copied: number; outside: number } | { status: "not-empty" | "too-many" }> {
  const parsed = clubTermCopySchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, "LEADER", now, true);
    if (access.status !== "ok") return access;
    if (!parsed.success || !UUID_PATTERN.test(input.termId) || parsed.data.fromTermId === input.termId) return { status: "invalid-request" } as const;
    const [target] = await tx.select().from(terms).where(and(eq(terms.id, input.termId), eq(terms.clubId, access.clubId))).for("update");
    const [source] = await tx.select().from(terms).where(and(eq(terms.id, parsed.data.fromTermId), eq(terms.clubId, access.clubId))).for("share");
    if (!target || !source) return { status: "not-found" } as const;
    if (await sessionCount(tx, target.id) > 0) return { status: "not-empty" } as const;
    const rows = await tx.select({ session: sessions, mapExists: schema.clubMaps.id }).from(sessions)
      .leftJoin(schema.clubMaps, and(eq(schema.clubMaps.id, sessions.clubMapId), eq(schema.clubMaps.clubId, access.clubId)))
      .where(eq(sessions.termId, source.id)).orderBy(asc(sessions.sessionDate), asc(sessions.startTime), asc(sessions.createdAt))
      .limit(MAX_TERM_SESSIONS);
    const shift = mondayOf(target.startsOn) - mondayOf(source.startsOn);
    const placed = rows.map(row => ({ ...row, date: fromDayNumber(dayNumber(row.session.sessionDate) + shift) }));
    const inside = placed.filter(row => inTerm(row.date, target));
    if (inside.length > MAX_TERM_SESSIONS) return { status: "too-many" } as const;
    const groupIds = [...new Set(inside.map(row => row.session.trainingGroupId).filter((id): id is string => !!id))];
    const ledGroups = new Set(groupIds.length === 0 ? [] : (await tx.select({ groupId: schema.trainingGroupMembers.groupId })
      .from(schema.trainingGroupMembers).where(and(inArray(schema.trainingGroupMembers.groupId, groupIds),
        eq(schema.trainingGroupMembers.accountId, access.accountId), eq(schema.trainingGroupMembers.role, "LEADER")))).map(row => row.groupId));
    const peopleOf = await sessionPeople(tx, inside.map(row => row.session.id));
    const leaders = await clubLeaders(tx, access.clubId);
    for (const [index, { session, mapExists, date }] of inside.entries()) {
      const people = copiedPeople(peopleOf.get(session.id) ?? [], leaders);
      const id = randomUUID();
      const at = new Date(now.getTime() + index);
      await tx.insert(sessions).values({ id, clubId: access.clubId, termId: target.id, sessionDate: date, startTime: session.startTime,
        title: session.title, place: session.place, note: session.note, clubMapId: mapExists ? session.clubMapId : null,
        trainingGroupId: session.trainingGroupId && ledGroups.has(session.trainingGroupId) ? session.trainingGroupId : null,
        responsibleAccountId: people.responsibleAccountId, moments: session.moments, levels: session.levels, tags: session.tags,
        createdAt: at, createdBy: access.accountId, updatedAt: at, requestId: randomUUID() });
      await insertCopiedTasks(tx, { sessionId: id, tasks: people.tasks, actorId: access.accountId, now: at });
    }
    return { status: "ok", copied: inside.length, outside: placed.length - inside.length } as const;
  });
}
