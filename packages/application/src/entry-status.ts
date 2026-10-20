import { and, asc, eq, sql } from "drizzle-orm";
import {
  entryStatusIdempotencyKeySchema, entryStatusReceiptSchema, entryStatusRequestSchema, entryStatusResponseSchema,
  type EntryStatusReadiness, type EntryStatusReceipt, type EntryStatusResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  applyManualDecision, controlApprovalSource, evaluateReadoutWithTimes, latestMatchedSplitElapsedMs, manualDecisionReadiness,
  officialStartTime, resolveResultHistory, type EvaluationResult, type ManualDecision, type ManualDecisionContext,
  type RaceSnapshot, type ResultHistory
} from "@o-tid/domain";
import { loadRaceSnapshot } from "./snapshot";
import { normalizedReadout } from "./result-revisions";
import { appliedControlNeutralization } from "./class-control-neutralization";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { appendResultRevision, lockResultHead, type ResultRevisionRow } from "./result-revisions";
import { isResultCurrent, loadResultBasisHash } from "./result-basis";
import { loadStoredStartCheckinDnsStates } from "./start-checkin-dns-state";
import { parseStrictStoredResultRevision, StoredResultRevisionConflict } from "./stored-result-revision";
import { synchronizeRelayTeams } from "./relay-sync";
import { UUID_PATTERN } from "./serialization";

/**
 * Ett statusflöde (ADR-0173 beslut 1): ett beslut om en löpare lägger till en resultatrevision med orsak, aktör och
 * begärans-id. Beslutet prövas av domänens `applyManualDecision` mot löparens revisioner; `expectedRevision` är
 * löparens senaste revision när arrangören öppnade beslutet. Ett återtagande är också en ny revision.
 */
const MAX_REVISIONS = 1_000;
type Auth = RaceSessionProof;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const AUDIT_ACTION: Partial<Record<ResultRevisionRow["cause"], string>> = {
  MANUAL_DID_NOT_START: "DID_NOT_START_DECIDED", MANUAL_DID_NOT_START_WITHDRAWAL: "DID_NOT_START_WITHDRAWN",
  MANUAL_DID_NOT_FINISH: "DID_NOT_FINISH_DECIDED", MANUAL_DID_NOT_FINISH_WITHDRAWAL: "DID_NOT_FINISH_WITHDRAWN",
  MANUAL_OUT_OF_COMPETITION: "OUT_OF_COMPETITION_DECIDED", MANUAL_OUT_OF_COMPETITION_WITHDRAWAL: "OUT_OF_COMPETITION_WITHDRAWN",
  MANUAL_WITHOUT_TIMING: "WITHOUT_TIMING_DECIDED", MANUAL_WITHOUT_TIMING_WITHDRAWAL: "WITHOUT_TIMING_WITHDRAWN",
  MANUAL_RESULT_APPROVAL: "RESULT_APPROVED", MANUAL_RESULT_APPROVAL_WITHDRAWAL: "RESULT_APPROVAL_WITHDRAWN",
  MANUAL_DISQUALIFICATION: "RESULT_DISQUALIFIED", MANUAL_DISQUALIFICATION_WITHDRAWAL: "RESULT_DISQUALIFICATION_WITHDRAWN",
  MANUAL_FINISH_TIME_CORRECTION: "MANUAL_FINISH_TIME_CORRECTED",
  MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWN",
  MANUAL_PUNCH_START_TIME_CORRECTION: "MANUAL_PUNCH_START_TIME_CORRECTED",
  MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL: "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWN",
  MANUAL_TIME: "MANUAL_TIME_DECIDED", MANUAL_TIME_WITHDRAWAL: "MANUAL_TIME_WITHDRAWN",
  MANUAL_CONTROL_APPROVAL: "CONTROLS_APPROVED", MANUAL_CONTROL_APPROVAL_WITHDRAWAL: "CONTROL_APPROVAL_WITHDRAWN",
  MANUAL_RESULT_REMOVED: "MANUAL_RESULT_REMOVED"
};
/** Orsaker som ändrar löparens måltid (stafett: nästa sträckas växling). */
const FINISH_CHANGING: ReadonlySet<ResultRevisionRow["cause"]> = new Set<ResultRevisionRow["cause"]>([
  "MANUAL_FINISH_TIME_CORRECTION", "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", "MANUAL_TIME", "MANUAL_TIME_WITHDRAWAL",
  "MANUAL_RESULT_REMOVED", "MANUAL_DID_NOT_FINISH", "MANUAL_DID_NOT_FINISH_WITHDRAWAL"]);

interface EntryContext {
  readonly race: { id: string; snapshotVersion: number };
  readonly entry: { id: string; givenName: string; familyName: string; teamId: string | null; className: string;
    classId: string; courseVersionId: string; startRule: "FIXED" | "PUNCH"; maxTimeMinutes: number | null };
  readonly history: ResultHistory<ResultRevisionRow>;
  readonly context: ManualDecisionContext;
  readonly snapshot: RaceSnapshot;
  /** Den tekniska revisionens avläsning: målstämplingen och om löparen har lästs ut alls. */
  readonly readoutFinishTime: string | null;
}

/** Läser löparens revisioner och det som avgör besluten. Kastar `StoredResultRevisionConflict` vid motsägelse. */
async function loadEntryContext(tx: Transaction, raceId: string, entryId: string): Promise<EntryContext | undefined> {
  const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
    .from(schema.races).where(eq(schema.races.id, raceId));
  const [entry] = await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName,
    familyName: schema.entries.familyName, teamId: schema.entries.teamId, className: schema.classes.name,
    classId: schema.entries.classId, courseVersionId: schema.classes.courseVersionId, startRule: schema.classes.startRule,
    maxTimeMinutes: schema.classes.maxTimeMinutes, fixedStartTime: schema.entries.fixedStartTime })
    .from(schema.entries).innerJoin(schema.classes, and(eq(schema.classes.id, schema.entries.classId), eq(schema.classes.raceId, raceId)))
    .where(and(eq(schema.entries.id, entryId), eq(schema.entries.raceId, raceId)));
  if (!race || !entry) return undefined;
  const revisions = await tx.select().from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, raceId),
    eq(schema.resultRevisions.entryId, entryId))).orderBy(asc(schema.resultRevisions.revision)).limit(MAX_REVISIONS + 1);
  if (revisions.length > MAX_REVISIONS) throw new StoredResultRevisionConflict("Deltagarens resultathistorik är för stor");
  for (const revision of revisions) if (revision.startCheckinDnsDecisionId === null) parseStrictStoredResultRevision(revision);
  let history = resolveResultHistory(revisions);
  // Ej start vid startkontrollen tas bort i avprickningen, utan ny revision.
  const head = history.head;
  if (head?.startCheckinDnsDecisionId) {
    const checkin = (await loadStoredStartCheckinDnsStates(tx, raceId, [entryId])).get(head.id);
    if (checkin?.correction) history = { ...history, effective: null, governing: "NONE", noActiveResult: true, restore: null };
  }
  const basisHash = await loadResultBasisHash(tx, entryId);
  // Steg 31: besluten bygger på den tekniska bedömningen under eventuella beslut (inte bara på huvudet).
  const technicalReadoutId = history.technical?.readoutId ?? null;
  const [readout] = technicalReadoutId ? await tx.select().from(schema.cardReadouts)
    .where(eq(schema.cardReadouts.id, technicalReadoutId)) : [];
  const snapshot = await loadRaceSnapshot(tx, raceId);
  const normalized = readout ? normalizedReadout(readout) : undefined;
  const knownStartTime = officialStartTime({ startRule: entry.startRule, fixedStartTime: entry.fixedStartTime?.toISOString() ?? null,
    startPunchedAt: normalized?.startPunchedAt ?? null }) ?? null;
  return { race, entry, history, snapshot, readoutFinishTime: normalized?.finishPunchedAt ?? null,
    context: { entryId: entry.id, classId: entry.classId, courseVersionId: entry.courseVersionId,
      startRule: entry.startRule, headStartPunchedAt: readout?.startPunchedAt?.toISOString() ?? null, maxTimeMinutes: entry.maxTimeMinutes,
      knownStartTime,
      evaluateWithTimes: normalized ? (startTime, finishTime) => evaluateReadoutWithTimes(normalized, snapshot, entry.id, startTime, finishTime)
        : undefined,
      isCurrent: (revision) => isResultCurrent(revision as ResultRevisionRow, basisHash, race.snapshotVersion) } };
}

function timing(revision: ResultRevisionRow | null | undefined) {
  if (!revision) return null;
  const outcome = revision.evaluation as EvaluationResult;
  if ((outcome.status !== "OK" && outcome.status !== "MP") || !outcome.startTime || !outcome.finishTime ||
    outcome.elapsedMs === undefined || outcome.elapsedMs <= 0) return null;
  return { status: outcome.status, startTime: outcome.startTime, finishTime: outcome.finishTime, elapsedMs: outcome.elapsedMs,
    latestMatchedSplitElapsedMs: latestMatchedSplitElapsedMs(outcome), splits: outcome.splits.map((split) => ({ ...split })) };
}

function statusResponse(value: EntryContext): EntryStatusResponse {
  const { history } = value;
  const restores = history.governing === "NONE" ? null : history.restore;
  const correction = history.governing === "FINISH_TIME" || history.governing === "START_TIME" || history.governing === "MANUAL_TIME";
  const approvable = controlApprovalSource(history, value.context);
  return entryStatusResponseSchema.parse({ formatVersion: 1, raceId: value.race.id, entryId: value.entry.id,
    entryName: `${value.entry.givenName} ${value.entry.familyName}`, className: value.entry.className,
    headRevision: history.head?.revision ?? 0, governingDecision: history.governing, noActiveResult: history.noActiveResult,
    readiness: manualDecisionReadiness(history, value.context),
    withdrawRestores: restores ? { status: restores.status } : null,
    timing: history.governing === "NONE" || correction ? timing(history.effective) : null,
    withdrawTiming: correction ? timing(restores) : null,
    manualTime: { knownStartTime: value.context.knownStartTime ?? null, readoutFinishTime: value.readoutFinishTime,
      hasReadout: value.history.technical !== null },
    approvableControls: typeof approvable === "string" ? [] : [...approvable.outcome.missingControls] });
}

export type EntryStatusReadResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" }
  | { status: "ok"; response: EntryStatusResponse };

/** Löparens läge för "Ändra status" och tidsrättningarna. */
export async function getEntryStatusAsAdmin(db: Database, input: Auth & { entryId: string }, now = new Date()):
  Promise<EntryStatusReadResult> {
  if (!UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) return { status: "invalid-request" };
  try {
    return await db.transaction(async (tx) => {
      const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
      if (auth.status !== "authenticated") return auth;
      const value = await loadEntryContext(tx, auth.principal.raceId, input.entryId);
      return value ? { status: "ok", response: statusResponse(value) } as const : { status: "not-found" } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict) return { status: "conflict" };
    throw error;
  }
}

export type SetEntryStatusResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" }
  | { status: "conflict"; headRevision: number; readiness: EntryStatusReadiness }
  | { status: "decided"; response: EntryStatusReceipt };

function receipt(row: ResultRevisionRow, requestId: string, replayed: boolean): EntryStatusReceipt {
  return entryStatusReceiptSchema.parse({ formatVersion: 1, replayed, requestId, raceId: row.raceId, entryId: row.entryId,
    resultRevisionId: row.id, revision: row.revision, cause: row.cause, status: row.status, reason: row.reason,
    decidedAt: row.createdAt.toISOString() });
}

/** Rätt orsak för beslutet (för att känna igen en upprepad begäran). */
function causeMatches(decision: ManualDecision, cause: ResultRevisionRow["cause"]): boolean {
  if (decision.kind === "WITHDRAW") return cause.endsWith("_WITHDRAWAL") || cause === "MANUAL_RESULT_REMOVED";
  const causes: Record<Exclude<ManualDecision["kind"], "WITHDRAW">, ResultRevisionRow["cause"]> = {
    DID_NOT_START: "MANUAL_DID_NOT_START", DID_NOT_FINISH: "MANUAL_DID_NOT_FINISH", DISQUALIFIED: "MANUAL_DISQUALIFICATION",
    OUT_OF_COMPETITION: "MANUAL_OUT_OF_COMPETITION", WITHOUT_TIMING: "MANUAL_WITHOUT_TIMING",
    APPROVE_MANUALLY: "MANUAL_RESULT_APPROVAL", FINISH_TIME: "MANUAL_FINISH_TIME_CORRECTION",
    START_TIME: "MANUAL_PUNCH_START_TIME_CORRECTION", MANUAL_TIME: "MANUAL_TIME", APPROVE_CONTROLS: "MANUAL_CONTROL_APPROVAL" };
  return causes[decision.kind] === cause;
}

/** Arrangörens text på revisionen: diskens orsak eller (steg 31) orsaken till manuell tid och godkännande. */
function decisionNote(decision: ManualDecision): string | null {
  const text = decision.kind === "DISQUALIFIED" ? decision.reason
    : decision.kind === "MANUAL_TIME" || decision.kind === "APPROVE_CONTROLS" || decision.kind === "APPROVE_MANUALLY" ||
      decision.kind === "DID_NOT_FINISH" ? decision.note : undefined;
  return text?.trim().slice(0, 500) || null;
}

/**
 * Lägger till beslutets revision i en redan öppen transaktion där löparen är låst. Används av `setEntryStatus` och
 * av uppdateringen från Eventor, där en struken anmälan blir ej start (ADR-0170 beslut 4).
 */
export async function applyEntryDecision(tx: Transaction, input: { raceId: string; entryId: string; decision: ManualDecision;
  expectedRevision: number; requestId: string; actorAccountId: string | null; decidedAt: Date; snapshotVersion?: number }):
  Promise<{ ok: true; revision: ResultRevisionRow; before: ResultRevisionRow | null } |
    { ok: false; headRevision: number; readiness: EntryStatusReadiness } | undefined> {
  await lockResultHead(tx, input.raceId, input.entryId);
  const value = await loadEntryContext(tx, input.raceId, input.entryId);
  if (!value) return undefined;
  const headRevision = value.history.head?.revision ?? 0;
  if (headRevision !== input.expectedRevision) return { ok: false, headRevision, readiness: "STALE_RESULT" };
  const outcome = applyManualDecision(value.history, input.decision, value.context);
  if (!outcome.ok) return { ok: false, headRevision, readiness: outcome.readiness };
  const courseVersionId = "courseVersionId" in outcome.outcome && outcome.outcome.courseVersionId
    ? outcome.outcome.courseVersionId : value.entry.courseVersionId;
  // Manuell tid bedöms mot nuvarande bana och dess strukna kontroll; övriga beslut ärver källans.
  const controlNeutralizationId = outcome.cause === "MANUAL_TIME"
    ? appliedControlNeutralization(value.snapshot, outcome.outcome as EvaluationResult)
    : outcome.cause === "MANUAL_RESULT_REMOVED" ? null : outcome.source?.controlNeutralizationId ?? null;
  const revision = await appendResultRevision(tx, { raceId: input.raceId, entryId: input.entryId, cause: outcome.cause,
    outcome: outcome.outcome, engineVersion: outcome.engineVersion,
    snapshotVersion: input.snapshotVersion ?? value.race.snapshotVersion, courseVersionId,
    controlNeutralizationId, requestId: input.requestId,
    actorAccountId: input.actorAccountId, expectedRevision: headRevision + 1, createdAt: input.decidedAt,
    note: decisionNote(input.decision) });
  // Stafett: en ändrad måltid är nästa sträckas växling.
  if (value.entry.teamId && FINISH_CHANGING.has(outcome.cause)) {
    await synchronizeRelayTeams(tx, input.raceId, [value.entry.teamId], value.race.snapshotVersion);
  }
  return { ok: true, revision, before: value.history.head };
}

/** Arrangörens beslut om en löpare (ADR-0173 beslut 1). */
export async function setEntryStatus(db: Database, input: Auth & { entryId: string; idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<SetEntryStatusResult> {
  const request = entryStatusRequestSchema.safeParse(input.request);
  const key = entryStatusIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!request.success || !key.success || key.data !== `entry-status:${request.data.requestId}` ||
    !UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) return { status: "invalid-request" };
  const decidedAt = new Date(now);
  if (!Number.isFinite(decidedAt.getTime())) throw new Error("Beslutstiden är ogiltig");
  const { requestId, decision, expectedRevision } = request.data;
  try {
    return await db.transaction(async (tx) => {
      const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, decidedAt, "update");
      if (auth.status !== "authenticated") return auth;
      const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
        .where(eq(schema.races.id, auth.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
      const [existing] = await tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.requestId, requestId));
      if (existing) {
        if (existing.raceId !== race.id || existing.entryId !== input.entryId || existing.revision !== expectedRevision + 1 ||
          !causeMatches(decision, existing.cause)) {
          return { status: "conflict", headRevision: existing.revision, readiness: "STALE_RESULT" } as const;
        }
        return { status: "decided", response: receipt(existing, requestId, true) } as const;
      }
      const actorAccountId = auth.principal.accountId;
      const applied = await applyEntryDecision(tx, { raceId: race.id, entryId: input.entryId, decision, expectedRevision,
        requestId, actorAccountId, decidedAt });
      if (!applied) return { status: "not-found" } as const;
      if (!applied.ok) return { status: "conflict", headRevision: applied.headRevision, readiness: applied.readiness } as const;
      const { revision, before } = applied;
      await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "result_revision", entityId: revision.id,
        action: AUDIT_ACTION[revision.cause] ?? "ENTRY_STATUS_DECIDED", actorKind: "USER_ACCOUNT",
        actorId: actorAccountId ?? auth.principal.accountId, requestId,
        before: before ? { resultRevisionId: before.id, revision: before.revision, status: before.status, reason: before.reason } : null,
        after: { entryId: revision.entryId, decision, resultRevisionId: revision.id, revision: revision.revision,
          cause: revision.cause, status: revision.status, reason: revision.reason, courseVersionId: revision.courseVersionId } });
      return { status: "decided", response: receipt(revision, requestId, false) } as const;
    });
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict) return { status: "conflict", headRevision: 0, readiness: "UNSUPPORTED_RESULT" };
    throw error;
  }
}
