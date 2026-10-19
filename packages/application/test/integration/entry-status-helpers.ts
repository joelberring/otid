import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { EntryStatusDecision } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { finalizeResultsAsAdmin, listResultFinalizationCandidatesAsAdmin } from "../../src";
import { getEntryStatusAsAdmin, setEntryStatus } from "../../src/entry-status";

/** Hjälp för testerna av statusflödet (ADR-0173 beslut 1). */
export type Auth = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

export function personResultBody(xml: string, givenName: string): string {
  const match = xml.match(new RegExp(
    `<PersonResult>[\\s\\S]*?<Given>${givenName}</Given>[\\s\\S]*?<Result>([\\s\\S]*?)</Result>[\\s\\S]*?</PersonResult>`));
  if (!match?.[1]) throw new Error(`${givenName} saknas i IOF-exporten`);
  return match[1];
}

/** Hjälpfunktionerna mot en given databas. */
export function statusFlow(db: Database) {
  async function entryStatus(auth: Auth, entryId: string, now?: Date) {
    const result = await getEntryStatusAsAdmin(db, { ...auth, entryId }, now);
    if (result.status !== "ok") throw new Error(`Läget kunde inte läsas: ${result.status}`);
    return result.response;
  }

  /** Ett beslut mot löparens senaste revision (eller den angivna). */
  async function decide(auth: Auth, entryId: string, decision: EntryStatusDecision,
    options: { now?: Date; requestId?: string; expectedRevision?: number } = {}) {
    const expectedRevision = options.expectedRevision ?? (await entryStatus(auth, entryId, options.now)).headRevision;
    const requestId = options.requestId ?? randomUUID();
    return setEntryStatus(db, { ...auth, entryId, idempotencyKey: `entry-status:${requestId}`,
      request: { formatVersion: 1, requestId, expectedRevision, decision } }, options.now);
  }

  async function revisions(entryId: string) {
    return db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, entryId))
      .orderBy(asc(schema.resultRevisions.revision));
  }

  async function entryId(raceId: string, givenName: string): Promise<string> {
    const [row] = await db.select({ id: schema.entries.id }).from(schema.entries)
      .where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.givenName, givenName)));
    if (!row) throw new Error(`${givenName} saknas`);
    return row.id;
  }


  /** Fastställer varje klass och sedan loppet; ger loppsfastställandets id. */
  async function finalizeAll(auth: Auth, now?: Date): Promise<string> {
    const classes = await listResultFinalizationCandidatesAsAdmin(db, auth, now);
    if (classes.status !== "ok") throw new Error("Finaliseringskandidater saknas");
    for (const candidate of classes.response.classes.filter((item) => item.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      const finalized = await finalizeResultsAsAdmin(db, { ...auth, idempotencyKey: `result-finalization:${randomUUID()}`,
        request: { formatVersion: 1, scope: "CLASS", classId: candidate.classId, expectedBasisHash: candidate.basisHash, expectedLatestScopeRevision: candidate.latestFinalization?.scopeRevision ?? null } },
      now ? { now } : {});
      expect(finalized.status).toBe("finalized");
    }
    const race = await listResultFinalizationCandidatesAsAdmin(db, auth, now);
    if (race.status !== "ok") throw new Error("Loppsfinaliseringskandidat saknas");
    expect(race.response.race.blockerCodes).toEqual([]);
    const finalized = await finalizeResultsAsAdmin(db, { ...auth, idempotencyKey: `result-finalization:${randomUUID()}`,
      request: { formatVersion: 1, scope: "RACE", classId: null, expectedBasisHash: race.response.race.basisHash, expectedLatestScopeRevision: race.response.race.latestFinalization?.scopeRevision ?? null } },
    now ? { now } : {});
    if (finalized.status !== "finalized") throw new Error("Loppet fastställdes inte");
    return finalized.response.finalization.id;
  }

  /** Klassens blockerare i fastställandet. */
  async function classBlockers(auth: Auth, now?: Date) {
    const classes = await listResultFinalizationCandidatesAsAdmin(db, auth, now);
    if (classes.status !== "ok") throw new Error("Finaliseringskandidater saknas");
    return classes.response.classes.filter((item) => item.entryCount > 0).flatMap((item) => item.blockerCodes);
  }
  return { entryStatus, decide, revisions, entryId, finalizeAll, classBlockers };
}
