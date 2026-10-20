import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  raceCorrectionCommitRequestSchema, raceCorrectionCommitResponseSchema, raceCorrectionListResponseSchema,
  raceCorrectionPreviewRequestSchema, raceCorrectionPreviewResponseSchema,
  type RaceCorrectionAction, type RaceCorrectionCommitResponse, type RaceCorrectionListResponse, type RaceCorrectionPreviewResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { assessReadOutEntries, recalculateAssessedEntries, summarizeAssessment } from "./result-reassessment";
import { bumpReadoutPackageVersion, loadRaceSnapshot } from "./snapshot";
import { canonicalHash } from "./serialization";

/**
 * Rättningar för hela tävlingen (PLAN.md steg 31): tidsjustering för en station, kontroll ur funktion och att ta bort dem,
 * samt att flytta en klass starttider (ångra = flytta tillbaka). Varje åtgärd
 * görs i en transaktion som också räknar om alla avlästa löpare i tävlingen med samma omprövning som banändringar
 * (`result-reassessment.ts`): en löpare med manuellt rättad tid räknas inte om, och beskedet säger hur många.
 * "Visa vad som händer" kör exakt samma åtgärd och rullar tillbaka; sparandet kräver att beskedet är oförändrat.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Failure = { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" };
type Summary = RaceCorrectionPreviewResponse["summary"];

class PreviewRollback extends Error {
  constructor(readonly outcome: Applied | Failure) { super("Förhandsvisningen rullas tillbaka"); }
}

interface Applied {
  readonly status: "applied";
  readonly summary: Summary;
  readonly previewHash: string;
  readonly recalculated: readonly { entryId: string; resultRevisionId: string; revision: number }[];
  readonly entity: { type: string; id: string };
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown>;
}

const AUDIT_ACTION = "RACE_CORRECTION_APPLIED_BY_ADMIN";

/** Genomför ändringen i databasen. Ger det som revisionen ska bära i auditposten, eller ett fel. */
type StartTimes = NonNullable<Summary["startTimes"]>;

async function mutate(tx: Transaction, raceId: string, accountId: string, correctionId: string, correction: RaceCorrectionAction,
  now: Date): Promise<Failure | { entity: { type: string; id: string }; before: Record<string, unknown> | null; after: Record<string, unknown>;
    bump: boolean; startTimes?: StartTimes }> {
  switch (correction.action) {
    case "ADD_TIME_ADJUSTMENT": {
      const station = correction.station, controlCode = correction.controlCode ?? null;
      const [existing] = await tx.select({ id: schema.raceStationCorrections.id }).from(schema.raceStationCorrections)
        .where(and(eq(schema.raceStationCorrections.raceId, raceId), eq(schema.raceStationCorrections.kind, "TIME_ADJUSTMENT"),
          eq(schema.raceStationCorrections.station, station), isNull(schema.raceStationCorrections.removedAt),
          controlCode === null ? isNull(schema.raceStationCorrections.controlCode) : eq(schema.raceStationCorrections.controlCode, controlCode)));
      // En station har högst en justering; ta bort den gamla först.
      if (existing) return { status: "conflict" };
      const offsetMs = correction.offsetSeconds * 1000;
      await tx.insert(schema.raceStationCorrections).values({ id: correctionId, raceId, kind: "TIME_ADJUSTMENT", station, controlCode,
        offsetMs, reason: correction.reason, actorAccountId: accountId, createdAt: now });
      return { entity: { type: "race_station_correction", id: correctionId }, before: null, bump: true,
        after: { kind: "TIME_ADJUSTMENT", station, controlCode, offsetMs, reason: correction.reason } };
    }
    case "ADD_CONTROL_OUT_OF_ORDER": {
      const controlCode = correction.controlCode;
      const [existing] = await tx.select({ id: schema.raceStationCorrections.id }).from(schema.raceStationCorrections)
        .where(and(eq(schema.raceStationCorrections.raceId, raceId), eq(schema.raceStationCorrections.kind, "CONTROL_OUT_OF_ORDER"),
          eq(schema.raceStationCorrections.controlCode, controlCode), isNull(schema.raceStationCorrections.removedAt)));
      if (existing) return { status: "conflict" };
      // Bara en kod som finns i tävlingen: en felskriven kod ska inte se ut att ha gjort något.
      const [control] = await tx.select({ id: schema.controls.id }).from(schema.controls)
        .where(and(eq(schema.controls.raceId, raceId), eq(schema.controls.code, controlCode))).limit(1);
      if (!control) return { status: "not-found" };
      await tx.insert(schema.raceStationCorrections).values({ id: correctionId, raceId, kind: "CONTROL_OUT_OF_ORDER", station: "CONTROL",
        controlCode, reason: correction.reason, actorAccountId: accountId, createdAt: now });
      return { entity: { type: "race_station_correction", id: correctionId }, before: null, bump: true,
        after: { kind: "CONTROL_OUT_OF_ORDER", controlCode, reason: correction.reason } };
    }
    case "REMOVE": {
      const [row] = await tx.select().from(schema.raceStationCorrections).where(and(
        eq(schema.raceStationCorrections.id, correction.correctionId), eq(schema.raceStationCorrections.raceId, raceId))).for("update");
      if (!row) return { status: "not-found" };
      if (row.removedAt !== null) return { status: "conflict" };
      await tx.update(schema.raceStationCorrections).set({ removedAt: now, removedByAccountId: accountId })
        .where(eq(schema.raceStationCorrections.id, row.id));
      return { entity: { type: "race_station_correction", id: row.id }, bump: true,
        before: { kind: row.kind, station: row.station, controlCode: row.controlCode, offsetMs: row.offsetMs, reason: row.reason },
        after: { removed: true } };
    }
    case "SHIFT_START_TIMES": {
      // Lottade eller tilldelade starttider i klassen, även gemensam start (alla har samma tid). Strukna flyttas inte.
      const [raceClass] = await tx.select({ id: schema.classes.id, startRule: schema.classes.startRule }).from(schema.classes)
        .where(and(eq(schema.classes.id, correction.classId), eq(schema.classes.raceId, raceId)));
      if (!raceClass) return { status: "not-found" };
      // Stafettens starttider har ett eget flöde (masstart och omstart per sträcka).
      const [relay] = await tx.select({ leg: schema.relayLegs.leg }).from(schema.relayLegs)
        .where(and(eq(schema.relayLegs.classId, raceClass.id), eq(schema.relayLegs.raceId, raceId))).limit(1);
      if (raceClass.startRule !== "FIXED" || relay) return { status: "conflict" };
      const entries = await tx.select({ id: schema.entries.id, version: schema.entries.version, fixedStartTime: schema.entries.fixedStartTime })
        .from(schema.entries).where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, raceClass.id),
          isNull(schema.entries.struckAt), isNotNull(schema.entries.fixedStartTime)))
        .orderBy(asc(schema.entries.fixedStartTime), asc(schema.entries.id)).for("update");
      if (entries.length === 0 || entries.some(entry => entry.version >= 2_147_483_647)) return { status: "conflict" };
      const offsetMs = correction.offsetSeconds * 1000;
      for (const entry of entries) {
        await tx.update(schema.entries).set({ fixedStartTime: new Date(entry.fixedStartTime!.getTime() + offsetMs), version: entry.version + 1 })
          .where(and(eq(schema.entries.id, entry.id), eq(schema.entries.version, entry.version)));
      }
      const first = entries[0]!.fixedStartTime!, last = entries[entries.length - 1]!.fixedStartTime!;
      const shift = (date: Date) => new Date(date.getTime() + offsetMs).toISOString();
      const startTimes: StartTimes = { count: entries.length, firstBefore: first.toISOString(), firstAfter: shift(first),
        lastBefore: last.toISOString(), lastAfter: shift(last) };
      return { entity: { type: "class", id: raceClass.id }, bump: true, startTimes,
        before: { firstStartTime: startTimes.firstBefore, lastStartTime: startTimes.lastBefore, entryIds: entries.map(entry => entry.id) },
        after: { offsetMs, reason: correction.reason, firstStartTime: startTimes.firstAfter, lastStartTime: startTimes.lastAfter } };
    }
    default:
      return { status: "invalid-request" };
  }
}

/** Åtgärden, omprövningen av alla avlästa och (vid sparande) omräkningen, i den anropande transaktionen. */
async function apply(tx: Transaction, raceId: string, accountId: string, correctionId: string, correction: RaceCorrectionAction,
  now: Date, recalculate: boolean): Promise<Applied | Failure> {
  const race = await lockRaceForMutation(tx, raceId);
  if (race.snapshotVersion >= 2_147_483_647) return { status: "conflict" };
  const classes = await tx.select({ id: schema.classes.id, name: schema.classes.name, courseVersionId: schema.classes.courseVersionId })
    .from(schema.classes).where(eq(schema.classes.raceId, raceId)).orderBy(asc(schema.classes.id));
  const before = await loadRaceSnapshot(tx, raceId);
  const changed = await mutate(tx, raceId, accountId, correctionId, correction, now);
  if ("status" in changed) return changed;
  if (changed.bump) await bumpReadoutPackageVersion(tx, raceId);
  const after = await loadRaceSnapshot(tx, raceId);
  const assessed = await assessReadOutEntries(tx, raceId, classes, before, after);
  if (assessed === "too-large") return { status: "conflict" };
  const totals = summarizeAssessment(assessed);
  const summary: Summary = { readOutCount: totals.readOutCount, notRecalculatedCount: totals.notRecalculatedCount,
    affectedCount: assessed.filter(row => row.changed).length, changes: totals.changes,
    ...(changed.startTimes ? { startTimes: changed.startTimes } : {}) };
  const previewHash = canonicalHash({ raceId, snapshotVersion: race.snapshotVersion, correction, summary,
    entries: assessed.map(row => [row.entryId, row.latest?.id ?? null, row.readout.id, row.recalculate, row.changed]) });
  const courseVersions = new Map(classes.flatMap(row => row.courseVersionId ? [[row.id, row.courseVersionId] as const] : []));
  const recalculated = recalculate ? await recalculateAssessedEntries(tx, { raceId, assessed, snapshot: after,
    snapshotVersion: after.race.snapshotVersion, courseVersionId: courseVersions }) : [];
  return { status: "applied", summary, previewHash, recalculated, entity: changed.entity, before: changed.before, after: changed.after };
}

export type RaceCorrectionPreviewResult = Failure | { status: "ok"; response: RaceCorrectionPreviewResponse };

/** "Visa vad som händer": åtgärden körs och rullas tillbaka. */
export async function previewRaceCorrectionAsAdmin(db: Database, input: RaceSessionProof & { request: unknown },
  now = new Date()): Promise<RaceCorrectionPreviewResult> {
  const parsed = raceCorrectionPreviewRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const initial = await requireRaceRole(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  let outcome: Applied | Failure;
  try {
    await db.transaction(async (tx) => {
      const auth = await requireRaceRole(tx, authentication, now, "update");
      if (auth.status !== "authenticated") throw new PreviewRollback(auth);
      throw new PreviewRollback(await apply(tx, auth.principal.raceId, auth.principal.accountId, randomUUID(), parsed.data.correction,
        now, false));
    });
    throw new Error("Förhandsvisningen rullades inte tillbaka");
  } catch (error) {
    if (!(error instanceof PreviewRollback)) throw error;
    outcome = error.outcome;
  }
  if (outcome.status !== "applied") return outcome;
  return { status: "ok", response: raceCorrectionPreviewResponseSchema.parse({ formatVersion: 1, raceId: input.raceId,
    previewHash: outcome.previewHash, correction: parsed.data.correction, summary: outcome.summary }) };
}

export type RaceCorrectionCommitResult = Failure | { status: "applied"; response: RaceCorrectionCommitResponse };

/** Sparar åtgärden och räknar om, bara om beskedet är detsamma som förhandsvisningen. Samma begäran igen ändrar inget. */
export async function applyRaceCorrectionAsAdmin(db: Database, input: RaceSessionProof & { request: unknown },
  now = new Date()): Promise<RaceCorrectionCommitResult> {
  const parsed = raceCorrectionCommitRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const request = parsed.data;
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const initial = await requireRaceRole(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  try {
    return await db.transaction(async (tx) => {
      const auth = await requireRaceRole(tx, authentication, now, "update");
      if (auth.status !== "authenticated") return auth;
      const raceId = auth.principal.raceId;
      await lockRaceForMutation(tx, raceId);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"race-correction:" + request.requestId}, 0))`);
      const [prior] = await tx.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, raceId),
        eq(schema.auditEvents.requestId, request.requestId), eq(schema.auditEvents.action, AUDIT_ACTION))).limit(1);
      if (prior) {
        const stored = raceCorrectionCommitResponseSchema.safeParse((prior.after as { response?: unknown } | null)?.response);
        if (!stored.success || prior.actorId !== auth.principal.accountId || canonicalHash(stored.data.correction) !== canonicalHash(request.correction)) {
          return { status: "conflict" as const };
        }
        return { status: "applied" as const, response: { ...stored.data, replayed: true } };
      }
      const outcome = await apply(tx, raceId, auth.principal.accountId, request.requestId, request.correction, now, true);
      if (outcome.status !== "applied") throw new PreviewRollback(outcome);
      if (outcome.previewHash !== request.expectedPreviewHash) throw new PreviewRollback({ status: "conflict" });
      const response = raceCorrectionCommitResponseSchema.parse({ formatVersion: 1, raceId, requestId: request.requestId, replayed: false,
        correction: request.correction, summary: outcome.summary, recalculatedCount: outcome.recalculated.length,
        appliedAt: now.toISOString() });
      await tx.insert(schema.auditEvents).values({ raceId, entityType: outcome.entity.type, entityId: outcome.entity.id,
        action: AUDIT_ACTION, actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, requestId: request.requestId,
        before: outcome.before, after: { ...outcome.after, response }, createdAt: now });
      if (outcome.recalculated.length > 0) {
        await tx.insert(schema.auditEvents).values(outcome.recalculated.map(item => ({ raceId, entityType: "result_revision",
          entityId: item.resultRevisionId, action: "RESULT_RECALCULATED_AFTER_RACE_CORRECTION", actorKind: "USER_ACCOUNT" as const,
          actorId: auth.principal.accountId, requestId: request.requestId,
          after: { entryId: item.entryId, revision: item.revision, cause: "EXPLICIT_RECALCULATION", correction: request.correction.action },
          createdAt: now })));
      }
      return { status: "applied" as const, response };
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return error.outcome as Failure;
    throw error;
  }
}

export type RaceCorrectionListResult = Failure | { status: "ok"; response: RaceCorrectionListResponse };

/** Tävlingens rättningar, nyaste först, även borttagna (historik). */
export async function listRaceCorrectionsAsAdmin(db: Database, input: RaceSessionProof, now = new Date()): Promise<RaceCorrectionListResult> {
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    await lockRaceForSnapshot(tx, auth.principal.raceId);
    const rows = await tx.select().from(schema.raceStationCorrections)
      .where(eq(schema.raceStationCorrections.raceId, auth.principal.raceId))
      .orderBy(desc(schema.raceStationCorrections.createdAt), desc(schema.raceStationCorrections.id)).limit(1_000);
    return { status: "ok" as const, response: raceCorrectionListResponseSchema.parse({ formatVersion: 1, raceId: auth.principal.raceId,
      corrections: rows.map(row => ({ id: row.id, kind: row.kind, station: row.station, controlCode: row.controlCode,
        offsetMs: row.offsetMs, reason: row.reason, createdAt: row.createdAt.toISOString(),
        removedAt: row.removedAt?.toISOString() ?? null })) }) };
  });
}
