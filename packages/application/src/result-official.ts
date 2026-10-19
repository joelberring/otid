import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  prefixedUuidPattern, raceResultFinalizationMetadataSchema, resultsOfficialRequestSchema, resultsOfficialResponseSchema,
  resultsOfficialStateSchema, type ResultFinalizationBlockerCode, type ResultsOfficialOutcome, type ResultsOfficialResponse,
  type ResultsOfficialState
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { ClassRankingError } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { buildFinalizationBasis, FinalizationTooLarge, finalizationMetadata, StoredFinalizationConflict } from "./result-finalization-basis";
import { insertResultFinalization } from "./result-finalization";
import type { DbExecutor } from "./snapshot";

/**
 * "Resultaten är klara" och "Gör resultaten preliminära igen" (PLAN.md steg 27). Ersätter tvåstegsflödet (fastställ varje
 * klass, sedan loppet) med en knapp: i en transaktion fastställs varje klass med anmälda vars senaste fastställande inte
 * längre stämmer, sedan hela loppet, och loppet pekar på det (`race.official_result_finalization_id`). Listorna är
 * officiella så länge ingen löpares senaste revision har ändrats sedan dess. Att ångra nollställer bara pekaren; de frysta
 * fastställandena och IOF-filerna står kvar.
 */
type Input = RaceSessionProof & { idempotencyKey: string | null; request: unknown };
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "too-large" };

/** Blockerare som "Resultaten är klara" själv löser (klassvisa fastställanden saknas eller är inaktuella). */
const SOLVED_HERE: ReadonlySet<ResultFinalizationBlockerCode> = new Set(["MISSING_CLASS_FINALIZATION", "CLASS_FINALIZATION_OUTDATED"]);

/** Resultatrevisionerna som den frysta loppsprojektionen bygger på (beslutets absoluta revision eller resultatet). */
function frozenRevisionIds(projection: unknown): Set<string> | undefined {
  const classes = (projection as { classes?: unknown })?.classes;
  if (!Array.isArray(classes)) return undefined;
  const ids = new Set<string>();
  for (const selected of classes as { class?: { results?: { source?: { resultRevisionId?: unknown; absoluteResultRevisionId?: unknown } }[] } }[]) {
    for (const result of selected.class?.results ?? []) {
      const id = result.source?.absoluteResultRevisionId ?? result.source?.resultRevisionId;
      if (typeof id !== "string") return undefined;
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Det officiella fastställandet och om det fortfarande gäller: varje icke struken löpares senaste resultatrevision är den
 * som fastställdes. Jämförelsen bygger på revisionerna, inte på klockslag. `undefined` när resultaten är preliminära.
 */
export async function officialResultState(tx: DbExecutor, raceId: string):
  Promise<{ finalizationId: string; finalizedAt: Date; current: boolean } | undefined> {
  const [race] = await tx.select({ id: schema.races.officialResultFinalizationId }).from(schema.races).where(eq(schema.races.id, raceId));
  if (!race?.id) return undefined;
  const [finalization] = await tx.select({ finalizedAt: schema.resultFinalizations.finalizedAt,
    projection: schema.resultFinalizations.frozenProjection }).from(schema.resultFinalizations)
    .where(and(eq(schema.resultFinalizations.id, race.id), eq(schema.resultFinalizations.raceId, raceId),
      eq(schema.resultFinalizations.scope, "RACE")));
  if (!finalization) throw new StoredFinalizationConflict("Det officiella fastställandet saknas");
  const frozen = frozenRevisionIds(finalization.projection);
  const latest = await tx.selectDistinctOn([schema.resultRevisions.entryId], { id: schema.resultRevisions.id,
    struckAt: schema.entries.struckAt })
    .from(schema.resultRevisions).innerJoin(schema.entries, eq(schema.entries.id, schema.resultRevisions.entryId))
    .where(eq(schema.resultRevisions.raceId, raceId))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision));
  const current = !!frozen && latest.every((row) => row.struckAt !== null || frozen.has(row.id));
  return { finalizationId: race.id, finalizedAt: finalization.finalizedAt, current };
}

export async function readResultsOfficialAsAdmin(db: Database, input: Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">,
  now = new Date()): Promise<Failure | { status: "ok"; response: ResultsOfficialState }> {
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const state = await officialResultState(tx, auth.principal.raceId);
    return { status: "ok", response: resultsOfficialStateSchema.parse({ formatVersion: 1, raceId: auth.principal.raceId,
      official: state ? { finalizationId: state.finalizationId, finalizedAt: state.finalizedAt.toISOString(), current: state.current } : null }) };
  }, { isolationLevel: "repeatable read" });
}

export async function setResultsOfficialAsAdmin(db: Database, input: Input, now = new Date()):
  Promise<Failure | { status: "saved"; response: ResultsOfficialResponse }> {
  const parsed = resultsOfficialRequestSchema.safeParse(input.request);
  if (!parsed.success || typeof input.idempotencyKey !== "string" || !prefixedUuidPattern("results-official").test(input.idempotencyKey) ||
    input.idempotencyKey !== `results-official:${parsed.data.requestId}`) return { status: "invalid-request" };
  const request = parsed.data;
  const reply = (raceId: string, result: ResultsOfficialOutcome, replayed: boolean) => ({ status: "saved" as const,
    response: resultsOfficialResponseSchema.parse({ formatVersion: 1, replayed, requestId: request.requestId, raceId,
      savedAt: now.toISOString(), request, result }) });
  try {
    return await db.transaction(async (tx) => {
      const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
      if (auth.status !== "authenticated") return auth;
      const { raceId, accountId } = auth.principal;
      const [race] = await tx.select({ id: schema.races.id, eventId: schema.races.eventId, snapshotVersion: schema.races.snapshotVersion })
        .from(schema.races).where(eq(schema.races.id, raceId)).for("update");
      if (!race) return { status: "not-found" } as const;
      const [earlier] = await tx.select({ action: schema.auditEvents.action, after: schema.auditEvents.after }).from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.raceId, raceId), eq(schema.auditEvents.requestId, request.requestId),
          eq(schema.auditEvents.entityType, "race_results"))).limit(1);
      if (earlier) {
        if (earlier.action !== (request.action === "OFFICIAL" ? "RESULTS_MARKED_OFFICIAL" : "RESULTS_MARKED_PRELIMINARY")) {
          return { status: "conflict" } as const;
        }
        if (request.action === "PRELIMINARY") return reply(raceId, { outcome: "PRELIMINARY" }, true);
        const id = (earlier.after as { finalizationId?: unknown } | null)?.finalizationId;
        const [row] = typeof id === "string" ? await tx.select().from(schema.resultFinalizations)
          .where(eq(schema.resultFinalizations.id, id)) : [];
        if (!row) throw new StoredFinalizationConflict("Det sparade fastställandet saknas");
        return reply(raceId, { outcome: "OFFICIAL", finalization: raceResultFinalizationMetadataSchema.parse(finalizationMetadata(row)) }, true);
      }
      if (request.action === "PRELIMINARY") {
        await tx.update(schema.races).set({ officialResultFinalizationId: null }).where(eq(schema.races.id, raceId));
        await tx.insert(schema.auditEvents).values({ raceId, entityType: "race_results", entityId: raceId, action: "RESULTS_MARKED_PRELIMINARY",
          actorKind: "USER_ACCOUNT", actorId: accountId, requestId: request.requestId, after: { outcome: "PRELIMINARY" }, createdAt: now });
        return reply(raceId, { outcome: "PRELIMINARY" }, false);
      }

      const basis = await buildFinalizationBasis(tx, race);
      const classes = basis.response.classes.filter((row) => row.entryCount > 0);
      const blockedClasses = classes.filter((row) => row.blockerCodes.length > 0)
        .map((row) => ({ classId: row.classId, className: row.className, blockerCodes: row.blockerCodes }));
      const raceBlockers = basis.response.race.blockerCodes.filter((code) => !SOLVED_HERE.has(code));
      if (blockedClasses.length > 0 || raceBlockers.length > 0) {
        return reply(raceId, { outcome: "BLOCKED", raceBlockers, classes: blockedClasses }, false);
      }
      // Varje klass vars senaste fastställande inte stämmer med underlaget fastställs först (samma frysta format som förut).
      for (const candidate of classes) {
        const latest = candidate.latestFinalization;
        if (latest && latest.basisHash === candidate.basisHash && latest.sourceSnapshotVersion === race.snapshotVersion) continue;
        const saved = await insertResultFinalization(tx, basis, { raceId, snapshotVersion: race.snapshotVersion, scope: "CLASS",
          classId: candidate.classId, scopeRevision: (latest?.scopeRevision ?? 0) + 1, sourceHash: candidate.basisHash,
          requestId: randomUUID(), finalizationId: randomUUID(), actorAccountId: accountId, finalizedAt: now });
        if (!saved) throw new StoredFinalizationConflict("Klassens underlag saknas");
      }
      const raceBasis = await buildFinalizationBasis(tx, race);
      if (raceBasis.response.race.blockerCodes.length > 0) {
        return reply(raceId, { outcome: "BLOCKED", raceBlockers: raceBasis.response.race.blockerCodes, classes: [] }, false);
      }
      const finalizationId = randomUUID();
      const metadata = await insertResultFinalization(tx, raceBasis, { raceId, snapshotVersion: race.snapshotVersion, scope: "RACE",
        classId: null, scopeRevision: (raceBasis.response.race.latestFinalization?.scopeRevision ?? 0) + 1,
        sourceHash: raceBasis.response.race.basisHash, requestId: request.requestId, finalizationId, actorAccountId: accountId,
        finalizedAt: now });
      if (!metadata) throw new StoredFinalizationConflict("Loppets underlag saknas");
      await tx.update(schema.races).set({ officialResultFinalizationId: finalizationId }).where(eq(schema.races.id, raceId));
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "race_results", entityId: raceId, action: "RESULTS_MARKED_OFFICIAL",
        actorKind: "USER_ACCOUNT", actorId: accountId, requestId: request.requestId, after: { outcome: "OFFICIAL", finalizationId }, createdAt: now });
      return reply(raceId, { outcome: "OFFICIAL", finalization: raceResultFinalizationMetadataSchema.parse(metadata) }, false);
    });
  } catch (error) {
    if (error instanceof FinalizationTooLarge) return { status: "too-large" };
    if (error instanceof StoredFinalizationConflict || error instanceof ClassRankingError) return { status: "conflict" };
    throw error;
  }
}
