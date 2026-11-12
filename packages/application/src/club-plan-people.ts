import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/**
 * Ägaren 2026-11-12 (G (ii), ADR-0221 tillägg 2026-11-12): personerna när en träning kopieras – ur klubbarkivet (Hämta ur
 * arkivet, Använd igen → Till terminsplanen) eller ur en annan termin (Kopiera upplägg från termin).
 *
 * Personregeln: den som **när kopian görs** är ledare, administratör eller ägare i klubbytan (samma villkor som för att kunna
 * vara ansvarig i planen) följer med som ansvarig och på sina uppgifter. Övriga uppgifter (en medlem utan ledarroll, en adress)
 * kopieras med rubriken men utan person. Inga mejl skickas när något kopieras.
 */
export interface PlanPerson { readonly kind: "RESPONSIBLE" | "TASK"; readonly title: string | null; readonly accountId: string | null }
export interface CopiedPeople { readonly responsibleAccountId: string | null; readonly tasks: readonly { title: string; accountId: string | null }[] }

const MAX_TASKS = 50;

/** Kontona som är ledare eller mer i klubbytan (och inte spärrade). */
export async function clubLeaders(tx: DbExecutor, clubId: string): Promise<ReadonlySet<string>> {
  const rows = await tx.select({ accountId: schema.clubMembers.accountId }).from(schema.clubMembers)
    .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.clubMembers.accountId))
    .where(and(eq(schema.clubMembers.clubId, clubId), inArray(schema.clubMembers.role, ["OWNER", "ADMIN", "LEADER"]),
      sql`${schema.userAccounts.blockedAt} is null`));
  return new Set(rows.map(row => row.accountId));
}

/** Personregeln ovan. */
export function copiedPeople(people: readonly PlanPerson[], leaders: ReadonlySet<string>): CopiedPeople {
  const keep = (accountId: string | null) => accountId && leaders.has(accountId) ? accountId : null;
  const responsible = people.find(person => person.kind === "RESPONSIBLE");
  return {
    responsibleAccountId: keep(responsible?.accountId ?? null),
    tasks: people.filter(person => person.kind === "TASK" && person.title?.trim())
      .map(person => ({ title: person.title!.trim().slice(0, 120), accountId: keep(person.accountId) })).slice(0, MAX_TASKS)
  };
}

/** Planradens ansvarige och uppgifter (adresserna utelämnas: en uppgift på en adress blir en uppgift utan konto). */
export async function sessionPeople(tx: DbExecutor, sessionIds: readonly string[]): Promise<Map<string, PlanPerson[]>> {
  const result = new Map<string, PlanPerson[]>(sessionIds.map(id => [id, []]));
  if (sessionIds.length === 0) return result;
  const sessions = await tx.select({ id: schema.clubPlanSessions.id, responsible: schema.clubPlanSessions.responsibleAccountId })
    .from(schema.clubPlanSessions).where(inArray(schema.clubPlanSessions.id, [...sessionIds]));
  for (const session of sessions) {
    if (session.responsible) result.get(session.id)!.push({ kind: "RESPONSIBLE", title: null, accountId: session.responsible });
  }
  const tasks = await tx.select({ sessionId: schema.clubPlanTasks.sessionId, title: schema.clubPlanTasks.title,
    accountId: schema.clubPlanTasks.assigneeAccountId }).from(schema.clubPlanTasks)
    .where(inArray(schema.clubPlanTasks.sessionId, [...sessionIds])).orderBy(asc(schema.clubPlanTasks.createdAt), asc(schema.clubPlanTasks.id));
  for (const task of tasks) result.get(task.sessionId)?.push({ kind: "TASK", title: task.title, accountId: task.accountId });
  return result;
}

/** Arkivpostens sparade personer i ordning. */
export async function archivePeople(tx: DbExecutor, entryId: string): Promise<PlanPerson[]> {
  return tx.select({ kind: schema.clubArchiveEntryPersons.kind, title: schema.clubArchiveEntryPersons.title,
    accountId: schema.clubArchiveEntryPersons.accountId }).from(schema.clubArchiveEntryPersons)
    .where(eq(schema.clubArchiveEntryPersons.entryId, entryId)).orderBy(asc(schema.clubArchiveEntryPersons.position));
}

/**
 * När en tävling läggs i klubbarkivet: personerna på planens rad för tävlingen (samma rad som ger moment och nivåer). Alla
 * sparas med sitt konto; regeln om ledare gäller när de kopieras.
 */
export async function snapshotPlanPeople(tx: DbExecutor, input: { raceId: string; clubId: string; entryId: string }): Promise<number> {
  const [session] = await tx.select({ id: schema.clubPlanSessions.id }).from(schema.clubPlanSessions)
    .where(and(eq(schema.clubPlanSessions.raceId, input.raceId), eq(schema.clubPlanSessions.clubId, input.clubId)))
    .orderBy(asc(schema.clubPlanSessions.createdAt)).limit(1);
  if (!session) return 0;
  const people = (await sessionPeople(tx, [session.id])).get(session.id) ?? [];
  if (people.length === 0) return 0;
  await tx.insert(schema.clubArchiveEntryPersons).values(people.slice(0, MAX_TASKS + 1).map((person, position) => ({ id: randomUUID(),
    entryId: input.entryId, kind: person.kind, title: person.title, accountId: person.accountId, position })));
  return people.length;
}

/** Arkivpostens personer tas bort med posten. */
export async function forgetArchivePeople(tx: DbExecutor, entryId: string): Promise<void> {
  await tx.delete(schema.clubArchiveEntryPersons).where(eq(schema.clubArchiveEntryPersons.entryId, entryId));
}

/** Nya uppgifter på en planerad träning (utan mejl; läsrätten i banläggningen ges när träningen finns). */
export async function insertCopiedTasks(tx: DbExecutor, input: { sessionId: string; tasks: CopiedPeople["tasks"]; actorId: string; now: Date })
  : Promise<{ id: string; accountId: string | null }[]> {
  if (input.tasks.length === 0) return [];
  const rows = input.tasks.map((task, index) => ({ id: randomUUID(), sessionId: input.sessionId, title: task.title,
    assigneeAccountId: task.accountId, assigneeEmail: null, createdAt: new Date(input.now.getTime() + index), createdBy: input.actorId,
    requestId: randomUUID() }));
  await tx.insert(schema.clubPlanTasks).values(rows);
  return rows.map(row => ({ id: row.id, accountId: row.assigneeAccountId }));
}
