import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { classResultRecalculationCandidateResponseSchema, classResultRecalculationIdempotencyKeySchema, classResultRecalculationRequestSchema, classResultRecalculationResponseSchema, type ClassResultRecalculationCandidateResponse, type ClassResultRecalculationResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { evaluateReadoutForEntry, RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { latestResultReadouts, readoutClaims, recalculationReadout } from "./card-reuse";
import { appendResultRevision, normalizedReadout } from "./result-revisions";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForSnapshot } from "./concurrency";
import { loadRaceSnapshot, type DbExecutor } from "./snapshot";
import { isResultCurrent, loadResultBasisHashes } from "./result-basis";
import { canonicalHash as hash } from "./serialization";

type Authentication = RaceSessionProof;
type Candidate = { id: string; entryVersion: number; displayName: string; readiness: "READY" | "CURRENT" | "NO_ACTIVE_ASSIGNMENT" | "MULTIPLE_ACTIVE_ASSIGNMENTS" | "NO_READOUT" | "NO_RESULT"; cardAssignmentId: string | null; readoutId: string | null; latestResultRevision: { id: string; revision: number; snapshotVersion: number } | null };

async function basis(tx: DbExecutor, raceId: string, classId: string) {
  const race = await lockRaceForSnapshot(tx, raceId);
  const [raceClass] = await tx.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes).where(and(eq(schema.classes.id, classId), eq(schema.classes.raceId, raceId)));
  if (!raceClass) return null;
  const entries = await tx.select({ id: schema.entries.id, version: schema.entries.version, givenName: schema.entries.givenName, familyName: schema.entries.familyName }).from(schema.entries).where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, classId))).orderBy(asc(schema.entries.id));
  const ids = entries.map((x) => x.id);
  const assignments = ids.length ? await tx.select({ id: schema.cardAssignments.id, entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber }).from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true), inArray(schema.cardAssignments.entryId, ids))).orderBy(asc(schema.cardAssignments.entryId), asc(schema.cardAssignments.id)) : [];
  const cards = assignments.map((x) => x.cardNumber);
  const readouts = cards.length ? await tx.selectDistinctOn([schema.cardReadouts.cardNumber], { id: schema.cardReadouts.id, cardNumber: schema.cardReadouts.cardNumber }).from(schema.cardReadouts).where(and(eq(schema.cardReadouts.raceId, raceId), inArray(schema.cardReadouts.cardNumber, cards))).orderBy(asc(schema.cardReadouts.cardNumber), desc(schema.cardReadouts.readAt), desc(schema.cardReadouts.id)) : [];
  const revisions = ids.length ? await tx.selectDistinctOn([schema.resultRevisions.entryId], { id: schema.resultRevisions.id, entryId: schema.resultRevisions.entryId, revision: schema.resultRevisions.revision, snapshotVersion: schema.resultRevisions.snapshotVersion, basisHash: schema.resultRevisions.basisHash }).from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, ids))).orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision)) : [];
  // ADR-0169: ett resultat behöver räknas om bara när löparens eget underlag har ändrats.
  const basisHashes = ids.length ? await loadResultBasisHashes(tx, raceId) : new Map<string, string>();
  const grouped = new Map<string, typeof assignments>(); for (const row of assignments) { const old = grouped.get(row.entryId) ?? []; old.push(row); grouped.set(row.entryId, old); }
  const byCard = new Map(readouts.map((x) => [x.cardNumber, x])); const claims = await readoutClaims(tx, raceId, readouts.map((x) => x.id)); const byEntry = new Map(revisions.map((x) => [x.entryId, x]));
  // Steg 31 (B4), steg 45: egen avläsning, annars brickans senaste som ingen annans resultat bygger på.
  const own = await latestResultReadouts(tx, raceId, ids);
  const rows: Candidate[] = entries.map((entry) => { const active = grouped.get(entry.id) ?? [], assignment = active.length === 1 ? active[0] : undefined, readout = assignment ? recalculationReadout(entry.id, own.get(entry.id), assignment.cardNumber, byCard.get(assignment.cardNumber), claims) : undefined, revision = byEntry.get(entry.id); const readiness = active.length === 0 ? "NO_ACTIVE_ASSIGNMENT" : active.length > 1 ? "MULTIPLE_ACTIVE_ASSIGNMENTS" : !readout ? "NO_READOUT" : !revision ? "NO_RESULT" : isResultCurrent(revision, basisHashes.get(entry.id), race.snapshotVersion) ? "CURRENT" : "READY"; return { id: entry.id, entryVersion: entry.version, displayName: `${entry.givenName} ${entry.familyName}`, readiness, cardAssignmentId: assignment?.id ?? null, readoutId: readout?.id ?? null, latestResultRevision: revision ? { id: revision.id, revision: revision.revision, snapshotVersion: revision.snapshotVersion } : null }; });
  return { race, className: raceClass.name, rows, manifestHash: hash({ raceId, classId, snapshotVersion: race.snapshotVersion, engineVersion: RESULT_ENGINE_VERSION, entries: rows }) };
}

export type ClassResultRecalculationCandidateResult = { status: "unauthorized" | "forbidden" | "not-found" } | { status: "ok"; response: ClassResultRecalculationCandidateResponse };
export async function listClassResultRecalculationCandidatesAsAdmin(db: Database, input: Authentication & { classId: string }, now = new Date()): Promise<ClassResultRecalculationCandidateResult> {
  return db.transaction(async (tx) => { const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share"); if (auth.status !== "authenticated") return auth; const current = await basis(tx, input.raceId, input.classId); if (!current) return { status: "not-found" }; return { status: "ok", response: classResultRecalculationCandidateResponseSchema.parse({ formatVersion: 1, raceId: input.raceId, classId: input.classId, className: current.className, snapshotVersion: current.race.snapshotVersion, engineVersion: RESULT_ENGINE_VERSION, manifestHash: current.manifestHash, entries: current.rows }) }; });
}

export type ClassResultRecalculationResult = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" } | { status: "recalculated"; response: ClassResultRecalculationResponse };
export async function recalculateClassResultsAsAdmin(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown }, now = new Date()): Promise<ClassResultRecalculationResult> {
  const key = classResultRecalculationIdempotencyKeySchema.safeParse(input.idempotencyKey), parsed = classResultRecalculationRequestSchema.safeParse(input.request); if (!key.success || !parsed.success) return { status: "invalid-request" }; const requestId = key.data.slice("class-result-recalculation:".length), intent = parsed.data, recalculatedAt = new Date(now);
  const preflight = await requireRaceRole(db, { ...input, role: "ADMIN", requireCsrf: true }, recalculatedAt); if (preflight.status !== "authenticated") return preflight;
  return db.transaction(async (tx) => { const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, recalculatedAt, "update"); if (auth.status !== "authenticated") return auth; const race = await lockRaceForSnapshot(tx, input.raceId); await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [old] = await tx.select().from(schema.classResultRecalculations).where(eq(schema.classResultRecalculations.requestId, requestId)); if (old) { if (old.raceId !== input.raceId || old.actorAccountId !== auth.principal.accountId || hash(old.request) !== hash(intent)) return { status: "conflict" }; return { status: "recalculated", response: classResultRecalculationResponseSchema.parse({ ...(old.response as object), replayed: true }) }; }
    if (intent.engineVersion !== RESULT_ENGINE_VERSION) return { status: "conflict" };
    for (const id of intent.entryIds) { const [entry] = await tx.select({ id: schema.entries.id }).from(schema.entries).where(and(eq(schema.entries.id, id), eq(schema.entries.raceId, input.raceId))).for("update"); if (!entry) return { status: "not-found" }; }
    const current = await basis(tx, input.raceId, intent.classId); if (!current) return { status: "not-found" }; if (current.manifestHash !== intent.manifestHash) return { status: "conflict" };
    const chosen = current.rows.filter((x) => intent.entryIds.includes(x.id)); if (chosen.length !== intent.entryIds.length || chosen.some((x) => x.readiness !== "READY" || !x.cardAssignmentId || !x.readoutId || !x.latestResultRevision)) return { status: "conflict" };
    const snapshot = await loadRaceSnapshot(tx, input.raceId); const made: Array<{ entryId: string; resultRevisionId: string; revision: number; source: Candidate }> = [];
    for (const row of chosen) { const [readout] = await tx.select().from(schema.cardReadouts).where(and(eq(schema.cardReadouts.id, row.readoutId!), eq(schema.cardReadouts.raceId, input.raceId))); if (!readout) return { status: "conflict" }; const evaluation = evaluateReadoutForEntry(normalizedReadout(readout), snapshot, row.id); if (evaluation.entryId !== row.id || !evaluation.courseVersionId) return { status: "conflict" }; const created = await appendResultRevision(tx, { raceId: input.raceId, entryId: row.id, readoutId: readout.id, cause: "EXPLICIT_RECALCULATION", outcome: evaluation, engineVersion: RESULT_ENGINE_VERSION, snapshotVersion: snapshot.race.snapshotVersion, courseVersionId: evaluation.courseVersionId }); made.push({ entryId: row.id, resultRevisionId: created.id, revision: created.revision, source: row }); }
    const response = classResultRecalculationResponseSchema.parse({ formatVersion: 1, replayed: false, requestId, raceId: input.raceId, classId: intent.classId, manifestHash: intent.manifestHash, snapshotVersion: race.snapshotVersion, engineVersion: intent.engineVersion, recalculatedAt: recalculatedAt.toISOString(), items: made.map((x) => ({ entryId: x.entryId, resultRevisionId: x.resultRevisionId, revision: x.revision })) });
    await tx.insert(schema.classResultRecalculations).values({ requestId, raceId: input.raceId, classId: intent.classId, actorAccountId: auth.principal.accountId, expectedEngineVersion: intent.engineVersion, manifestHash: intent.manifestHash, request: intent, response, recalculatedAt });
    await tx.insert(schema.classResultRecalculationItems).values(made.map((x) => ({ requestId, raceId: input.raceId, classId: intent.classId, entryId: x.entryId, expectedEntryVersion: x.source.entryVersion, expectedAssignmentId: x.source.cardAssignmentId!, expectedReadoutId: x.source.readoutId!, expectedResultRevisionId: x.source.latestResultRevision!.id, expectedResultRevision: x.source.latestResultRevision!.revision, createdResultRevisionId: x.resultRevisionId, createdResultRevision: x.revision })));
    await tx.insert(schema.auditEvents).values(made.map((x) => ({ raceId: input.raceId, entityType: "result_revision", entityId: x.resultRevisionId, action: "CLASS_RESULT_RECALCULATED_BY_ADMIN", actorKind: "USER_ACCOUNT" as const, actorId: auth.principal.accountId, requestId, after: { classId: intent.classId, groupRequestId: requestId, entryId: x.entryId, revision: x.revision, cause: "EXPLICIT_RECALCULATION" } })));
    return { status: "recalculated", response };
  });
}
