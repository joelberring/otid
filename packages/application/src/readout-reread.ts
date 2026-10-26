import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import {
  readoutRereadCommitRequestSchema, readoutRereadCommitResponseSchema, readoutRereadManualDecisionSchema,
  readoutRereadPreviewRequestSchema, readoutRereadPreviewResponseSchema, sportidentReadoutPayloadSchema,
  type ReadoutRereadCommitResponse, type ReadoutRereadItem, type ReadoutRereadPreviewResponse, type ReadoutRereadUnreadable,
  type SportidentReadoutPayload
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  evaluateReadoutForEntry, RESULT_ENGINE_VERSION, type EvaluationResult, type NormalizedCardReadout, type RaceSnapshot
} from "@o-tid/domain";
import { CardDecodeError, decodeRecordedFrames, framesFromHex, normalizeCard, SiTimeError, type NormalizedSiReadout } from "@o-tid/sportident";
import { latestResultReadouts, readoutClaims } from "./card-reuse";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { relayTeamOfEntry } from "./relay-model";
import { synchronizeRelayTeams } from "./relay-sync";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { appendResultRevision, normalizedReadout } from "./result-revisions";
import { canonicalHash, contentHash, evaluationHash } from "./serialization";
import { loadRaceSnapshot } from "./snapshot";

/**
 * Läs om avläsningar från rådata (PLAN.md steg 36). Varje deltagares avläsning (den som resultatet bygger på) avkodas på
 * nytt från originalets råramar med den nuvarande brickavkodningen och samma tidsreferens som vid avläsningen
 * (stationens klocka när nyttolasten säger det, annars datorns; tävlingens tidszon). Övningsstationens och simulatorns
 * avläsningar läses inte om. Bara de som får andra stämplingar eller tider listas, och de vars ramar inte går att avkoda.
 *
 * Lagring: originalets råmeddelande och avläsning ändras aldrig. En omläsning är ett nytt råmeddelande med transporten
 * `sportident-reread` (enheten är originalets råmeddelande, löpnumret räknas upp per omläsning, mottagningstiden är
 * originalets och nyttolasten pekar på originalet och avläsningen den ersätter) och en ny `card_readout` – så hålls
 * `card_readout.raw_message_id` unik och varje avläsning har sitt råmeddelande. Avläsningen får originalets lästid plus
 * en millisekund, så att "senaste avläsningen av brickan" blir den omlästa. Den bedöms för samma deltagare som originalet
 * (`evaluateReadoutForEntry`) och ger en revision med orsaken READOUT_REREAD; manuella beslut ligger kvar ovanpå.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Readout = typeof schema.cardReadouts.$inferSelect;
type RawMessage = typeof schema.rawDeviceMessages.$inferSelect;
type Failure = { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" };

export const READOUT_REREAD_TRANSPORT = "sportident-reread";
const AUDIT_ACTION = "READOUT_REREAD_BY_ADMIN";
const MAX_ENTRIES = 10_000;

interface Candidate {
  readonly item: ReadoutRereadItem;
  readonly readout: Readout;
  readonly source: RawMessage;
  readonly payload: SportidentReadoutPayload;
  readonly decoded: NormalizedSiReadout;
  readonly after: EvaluationResult;
}

interface Scan { readonly checkedCount: number; readonly candidates: readonly Candidate[]; readonly unreadable: readonly ReadoutRereadUnreadable[] }

/** Originalets råmeddelande-id för en omläsning (nyttolasten pekar dit). */
function rereadSourceId(raw: RawMessage): string | undefined {
  const value = (raw.rawPayload as { rereadOf?: { rawMessageId?: unknown } }).rereadOf?.rawMessageId;
  return typeof value === "string" ? value : undefined;
}

/** Tidsreferensen som avläsningssidan använde (`readout/app.tsx`): stationens klocka om den användes, annars datorns. */
function referenceOf(source: RawMessage, payload: SportidentReadoutPayload): Date {
  const received = source.stationReceivedAt.getTime();
  return new Date(payload.clockSource === "station" && payload.clockOffsetMs !== undefined ? received + payload.clockOffsetMs : received);
}

type Decoded = { ok: true; decoded: NormalizedSiReadout } | { ok: false; reason: ReadoutRereadUnreadable["reason"]; detail: string };

function decodeSource(source: RawMessage, payload: SportidentReadoutPayload, timeZone: string): Decoded {
  try {
    const card = decodeRecordedFrames(framesFromHex(payload.frames));
    if (String(card.cardNumber) !== payload.cardNumber) {
      return { ok: false, reason: "FRAMES", detail: "Bricknumret i råramarna stämmer inte med avläsningen" };
    }
    return { ok: true, decoded: normalizeCard(card, { reference: referenceOf(source, payload), timeZone }) };
  } catch (error) {
    if (error instanceof CardDecodeError) return { ok: false, reason: "FRAMES", detail: error.message.slice(0, 200) };
    if (error instanceof SiTimeError) return { ok: false, reason: "TIME", detail: error.message.slice(0, 200) };
    throw error;
  }
}

const instant = (value: Date | string | null | undefined) => value === null || value === undefined ? null : new Date(value).getTime();

/** Samma start, mål, check, clear och stämplingar som den sparade avläsningen? */
function sameAsStored(readout: Readout, decoded: NormalizedSiReadout): boolean {
  return instant(readout.startPunchedAt) === instant(decoded.startPunchedAt) &&
    instant(readout.finishPunchedAt) === instant(decoded.finishPunchedAt) &&
    instant(readout.checkPunchedAt) === instant(decoded.checkPunchedAt) &&
    instant(readout.clearPunchedAt) === instant(decoded.clearPunchedAt) &&
    readout.punches.length === decoded.punches.length &&
    readout.punches.every((punch, index) => punch.code === decoded.punches[index]!.code &&
      instant(punch.punchedAt) === instant(decoded.punches[index]!.punchedAt));
}

/** Den nya avläsningen så som den sparas: originalets lästid plus en millisekund (se ovan). */
function rereadReadout(readout: Readout, decoded: NormalizedSiReadout): NormalizedCardReadout {
  return { id: readout.id, raceId: readout.raceId, cardNumber: decoded.cardNumber, rawMessageId: readout.rawMessageId,
    readAt: new Date(readout.readAt.getTime() + 1).toISOString(),
    ...(decoded.startPunchedAt ? { startPunchedAt: decoded.startPunchedAt } : {}),
    ...(decoded.finishPunchedAt ? { finishPunchedAt: decoded.finishPunchedAt } : {}),
    ...(decoded.checkPunchedAt ? { checkPunchedAt: decoded.checkPunchedAt } : {}),
    ...(decoded.clearPunchedAt ? { clearPunchedAt: decoded.clearPunchedAt } : {}),
    punches: decoded.punches.map((punch) => ({ code: punch.code, punchedAt: punch.punchedAt })) };
}

function side(punchCount: number, evaluation: EvaluationResult): ReadoutRereadItem["before"] {
  return { punchCount, status: evaluation.status, elapsedMs: evaluation.elapsedMs ?? null };
}

/** Prövar deltagarnas avläsningar (eller en deltagares) mot en omläsning från råramarna. Ändrar inget. */
async function scan(tx: Transaction, raceId: string, snapshot: RaceSnapshot, onlyEntryId?: string): Promise<Scan | "too-large" | "not-found"> {
  const [event] = await tx.select({ timeZone: schema.events.timeZone }).from(schema.events)
    .innerJoin(schema.races, eq(schema.races.eventId, schema.events.id)).where(eq(schema.races.id, raceId));
  if (!event) throw new Error("Evenemanget saknas");
  const entries = await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
    className: schema.classes.name }).from(schema.entries).innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
    .where(and(eq(schema.entries.raceId, raceId), onlyEntryId ? eq(schema.entries.id, onlyEntryId) : undefined))
    .orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id)).limit(MAX_ENTRIES + 1);
  if (entries.length > MAX_ENTRIES) return "too-large";
  if (onlyEntryId && entries.length === 0) return "not-found";
  const readouts = await latestResultReadouts(tx, raceId, entries.map((entry) => entry.id));
  const raws = readouts.size === 0 ? [] : await tx.select().from(schema.rawDeviceMessages).where(and(
    eq(schema.rawDeviceMessages.raceId, raceId), inArray(schema.rawDeviceMessages.id, [...readouts.values()].map((row) => row.rawMessageId))));
  const rawById = new Map(raws.map((row) => [row.id, row]));
  const sourceIds = raws.filter((row) => row.transport === READOUT_REREAD_TRANSPORT).flatMap((row) => rereadSourceId(row) ?? []);
  for (const row of sourceIds.length === 0 ? [] : await tx.select().from(schema.rawDeviceMessages).where(and(
    eq(schema.rawDeviceMessages.raceId, raceId), inArray(schema.rawDeviceMessages.id, sourceIds)))) rawById.set(row.id, row);
  const readOut = entries.filter((entry) => readouts.has(entry.id)).map((entry) => entry.id);
  const heads = readOut.length === 0 ? [] : await tx.selectDistinctOn([schema.resultRevisions.entryId]).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, readOut)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id));
  const states = new Map((await resolveStoredResultHeadStates(tx, raceId, heads)).map((state) => [state.selectedHead.entryId, state]));
  const candidates: Candidate[] = [];
  const unreadable: ReadoutRereadUnreadable[] = [];
  let checkedCount = 0;
  for (const entry of entries) {
    const readout = readouts.get(entry.id);
    const raw = readout ? rawById.get(readout.rawMessageId) : undefined;
    if (!readout || !raw) continue;
    const source = raw.transport === "sportident" ? raw : raw.transport === READOUT_REREAD_TRANSPORT ? rawById.get(rereadSourceId(raw) ?? "") : undefined;
    // Simulatorn har inga råramar.
    if (!source || source.transport !== "sportident") continue;
    const state = states.get(entry.id);
    // Ej start gäller oavsett avläsningen; en ny teknisk revision skulle ersätta det.
    if (!state || state.state === "NO_ACTIVE_RESULT" || state.governing === "DNS" || state.governing === "CHECKIN_DNS") continue;
    const base = { readoutId: readout.id, entryId: entry.id, displayName: `${entry.givenName} ${entry.familyName}`,
      className: entry.className, cardNumber: readout.cardNumber };
    const parsed = sportidentReadoutPayloadSchema.safeParse(source.rawPayload);
    if (!parsed.success) {
      checkedCount += 1;
      unreadable.push({ ...base, reason: "PAYLOAD", detail: "Det sparade råmeddelandet har inte avläsningens form" });
      continue;
    }
    // Övningsstationen: inte en riktig avläsning.
    if (parsed.data.simulated) continue;
    checkedCount += 1;
    const result = decodeSource(source, parsed.data, event.timeZone);
    if (!result.ok) { unreadable.push({ ...base, reason: result.reason, detail: result.detail }); continue; }
    if (sameAsStored(readout, result.decoded)) continue;
    const before = evaluateReadoutForEntry(normalizedReadout(readout), snapshot, entry.id);
    const after = evaluateReadoutForEntry(rereadReadout(readout, result.decoded), snapshot, entry.id);
    if (after.entryId !== entry.id || !after.courseVersionId) continue;
    const manual = readoutRereadManualDecisionSchema.safeParse(state.governing);
    const item: Omit<ReadoutRereadItem, "itemHash"> = { ...base, before: side(readout.punches.length, before),
      after: side(result.decoded.punches.length, after), manualDecision: manual.success ? manual.data : null };
    const itemHash = canonicalHash({ raceId, item, headRevisionId: state.selectedHead.id, sourceRawMessageId: source.id,
      decoded: result.decoded, after: evaluationHash(after) });
    candidates.push({ item: { ...item, itemHash }, readout, source, payload: parsed.data, decoded: result.decoded, after });
  }
  return { checkedCount, candidates, unreadable };
}

export type ReadoutRereadPreviewResult = Failure | { status: "ok"; response: ReadoutRereadPreviewResponse };

/** "Visa vad som händer": vilka avläsningar som blir andra vid omläsning, och vilka som inte går att läsa om. */
export async function previewReadoutRereadAsAdmin(db: Database, input: RaceSessionProof & { request: unknown },
  now = new Date()): Promise<ReadoutRereadPreviewResult> {
  const parsed = readoutRereadPreviewRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await lockRaceForSnapshot(tx, raceId);
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const result = await scan(tx, raceId, snapshot, parsed.data.entryId);
    if (result === "not-found") return { status: "not-found" as const };
    if (result === "too-large") return { status: "conflict" as const };
    return { status: "ok" as const, response: readoutRereadPreviewResponseSchema.parse({ formatVersion: 1, raceId,
      ...(parsed.data.entryId ? { entryId: parsed.data.entryId } : {}), checkedCount: result.checkedCount,
      items: result.candidates.map((candidate) => candidate.item), unreadable: result.unreadable }) };
  });
}

/** Sparar en omläsning: nytt råmeddelande, ny avläsning, ny revision för samma deltagare och en auditpost. */
type Moved = Map<string, { entryId: string; replacedReadoutId: string; readoutId: string; resultRevisionId: string; revision: number }>;

async function storeReread(tx: Transaction, raceId: string, snapshot: RaceSnapshot, candidate: Candidate, accountId: string,
  requestId: string, now: Date, moved: Moved = new Map()) {
  const { readout, source, payload, decoded, item } = candidate;
  // Steg 50: teamsprint – sträckan flyttades redan till den nya avläsningen tillsammans med löparens andra sträckor.
  const already = moved.get(item.entryId);
  if (already && already.replacedReadoutId === readout.id) {
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "card_readout", entityId: already.readoutId, action: AUDIT_ACTION,
      actorKind: "USER_ACCOUNT", actorId: accountId, requestId,
      before: { readoutId: readout.id, rawMessageId: readout.rawMessageId, ...item.before },
      after: { readoutId: already.readoutId, entryId: item.entryId, resultRevisionId: already.resultRevisionId, revision: already.revision,
        cause: "READOUT_REREAD", manualDecision: item.manualDecision, ...item.after },
      createdAt: now });
    return already;
  }
  const [sequence] = await tx.select({ value: max(schema.rawDeviceMessages.localSequence) }).from(schema.rawDeviceMessages)
    .where(eq(schema.rawDeviceMessages.deviceId, source.id));
  const rawPayload: Record<string, unknown> = {
    rereadOf: { rawMessageId: source.id, replacesReadoutId: readout.id },
    cardNumber: decoded.cardNumber, cardType: decoded.cardType,
    ...(decoded.startPunchedAt ? { startPunchedAt: decoded.startPunchedAt } : {}),
    ...(decoded.finishPunchedAt ? { finishPunchedAt: decoded.finishPunchedAt } : {}),
    ...(decoded.checkPunchedAt ? { checkPunchedAt: decoded.checkPunchedAt } : {}),
    ...(decoded.clearPunchedAt ? { clearPunchedAt: decoded.clearPunchedAt } : {}),
    punches: decoded.punches.map((punch) => ({ code: punch.code, punchedAt: punch.punchedAt })),
    untimedPunchCodes: [...decoded.untimedPunchCodes],
    ...(payload.stationSerial !== undefined ? { stationSerial: payload.stationSerial } : {}),
    ...(payload.clockSource !== undefined ? { clockSource: payload.clockSource } : {}),
    ...(payload.clockOffsetMs !== undefined ? { clockOffsetMs: payload.clockOffsetMs } : {}),
    simulated: false
  };
  const [raw] = await tx.insert(schema.rawDeviceMessages).values({ raceId, deviceId: source.id, sessionId: source.sessionId,
    localSequence: (sequence?.value ?? 0) + 1, packageVersion: snapshot.race.snapshotVersion, stationReceivedAt: source.stationReceivedAt,
    transport: READOUT_REREAD_TRANSPORT, rawPayload, contentHash: contentHash(rawPayload), serverReceivedAt: now }).returning();
  if (!raw) throw new Error("Omläsningens råmeddelande kunde inte sparas");
  const normalized = rereadReadout(readout, decoded);
  const [created] = await tx.insert(schema.cardReadouts).values({ raceId, rawMessageId: raw.id, cardNumber: normalized.cardNumber,
    startPunchedAt: normalized.startPunchedAt ? new Date(normalized.startPunchedAt) : null,
    finishPunchedAt: normalized.finishPunchedAt ? new Date(normalized.finishPunchedAt) : null,
    checkPunchedAt: normalized.checkPunchedAt ? new Date(normalized.checkPunchedAt) : null,
    clearPunchedAt: normalized.clearPunchedAt ? new Date(normalized.clearPunchedAt) : null,
    punches: [...normalized.punches], readAt: new Date(normalized.readAt),
    clockSource: payload.clockSource ?? null, clockOffsetMs: payload.clockOffsetMs ?? null }).returning();
  if (!created) throw new Error("Omläsningens avläsning kunde inte sparas");
  const evaluation = evaluateReadoutForEntry(normalizedReadout(created), snapshot, item.entryId);
  if (evaluationHash(evaluation) !== evaluationHash(candidate.after) || !evaluation.courseVersionId) {
    throw new Error("Omläsningen gav en annan bedömning än förhandsbeskedet");
  }
  const revision = await appendResultRevision(tx, { raceId, entryId: item.entryId, cause: "READOUT_REREAD", outcome: evaluation,
    engineVersion: RESULT_ENGINE_VERSION, snapshotVersion: snapshot.race.snapshotVersion, courseVersionId: evaluation.courseVersionId,
    readoutId: created.id, actorAccountId: accountId });
  // Steg 48/50: teamsprint – löparens andra sträckor som bygger på samma utläsning flyttas till den nya, så att delningen
  // (vilka sträckor utläsningen täcker) stämmer.
  const claimants = [...(await readoutClaims(tx, raceId, [readout.id])).get(readout.id) ?? []].filter((id) => id !== item.entryId);
  const latest = await latestResultReadouts(tx, raceId, claimants);
  for (const entryId of claimants.filter((id) => latest.get(id)?.id === readout.id)) {
    const outcome = evaluateReadoutForEntry(normalizedReadout(created), snapshot, entryId);
    if (outcome.entryId !== entryId || !outcome.courseVersionId) continue;
    const sibling = await appendResultRevision(tx, { raceId, entryId, cause: "READOUT_REREAD", outcome, engineVersion: RESULT_ENGINE_VERSION,
      snapshotVersion: snapshot.race.snapshotVersion, courseVersionId: outcome.courseVersionId, readoutId: created.id, actorAccountId: accountId });
    moved.set(entryId, { entryId, replacedReadoutId: readout.id, readoutId: created.id, resultRevisionId: sibling.id, revision: sibling.revision });
  }
  // Stafett: sträckans måltid ger nästa sträckas start (som vid avläsning).
  const teamId = await relayTeamOfEntry(tx, item.entryId);
  if (teamId) await synchronizeRelayTeams(tx, raceId, [teamId], snapshot.race.snapshotVersion);
  await tx.insert(schema.auditEvents).values({ raceId, entityType: "card_readout", entityId: created.id, action: AUDIT_ACTION,
    actorKind: "USER_ACCOUNT", actorId: accountId, requestId,
    before: { readoutId: readout.id, rawMessageId: readout.rawMessageId, ...item.before },
    after: { readoutId: created.id, rawMessageId: raw.id, sourceRawMessageId: source.id, entryId: item.entryId,
      resultRevisionId: revision.id, revision: revision.revision, cause: "READOUT_REREAD", manualDecision: item.manualDecision,
      ...item.after },
    createdAt: now });
  return { entryId: item.entryId, replacedReadoutId: readout.id, readoutId: created.id, resultRevisionId: revision.id,
    revision: revision.revision };
}

export type ReadoutRereadCommitResult = Failure | { status: "applied"; response: ReadoutRereadCommitResponse };

/**
 * "Spara och räkna om" för de valda. Alla eller inga: har något ändrats sedan förhandsvisningen (annan avläsning, annat
 * resultat, redan omläst) blir det konflikt. Samma begäran igen ger samma kvitto.
 */
export async function applyReadoutRereadAsAdmin(db: Database, input: RaceSessionProof & { request: unknown },
  now = new Date()): Promise<ReadoutRereadCommitResult> {
  const parsed = readoutRereadCommitRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const request = parsed.data;
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const initial = await requireRaceRole(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await lockRaceForMutation(tx, raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"readout-reread:" + request.requestId}, 0))`);
    const prior = await tx.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.requestId, request.requestId), eq(schema.auditEvents.action, AUDIT_ACTION)))
      .orderBy(asc(schema.auditEvents.createdAt), asc(schema.auditEvents.id));
    if (prior.length > 0) {
      if (prior.some((row) => row.actorId !== auth.principal.accountId)) return { status: "conflict" as const };
      const saved = prior.map((row) => {
        const after = row.after as { readoutId: string; entryId: string; resultRevisionId: string; revision: number };
        return { entryId: after.entryId, replacedReadoutId: (row.before as { readoutId: string }).readoutId, readoutId: after.readoutId,
          resultRevisionId: after.resultRevisionId, revision: after.revision };
      });
      const replaced = new Set(saved.map((row) => `${row.replacedReadoutId}:${row.entryId}`));
      if (saved.length !== request.items.length || request.items.some((item) => !replaced.has(`${item.readoutId}:${item.entryId}`))) {
        return { status: "conflict" as const };
      }
      return { status: "applied" as const, response: readoutRereadCommitResponseSchema.parse({ formatVersion: 1, raceId,
        requestId: request.requestId, replayed: true, saved, appliedAt: prior[0]!.createdAt.toISOString() }) };
    }
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const result = await scan(tx, raceId, snapshot);
    if (result === "too-large" || result === "not-found") return { status: "conflict" as const };
    const key = (readoutId: string, entryId: string) => `${readoutId}:${entryId}`;
    const byReadout = new Map(result.candidates.map((candidate) => [key(candidate.readout.id, candidate.item.entryId), candidate]));
    const chosen = request.items.map((item) => byReadout.get(key(item.readoutId, item.entryId)));
    if (chosen.some((candidate, index) => !candidate || candidate.item.itemHash !== request.items[index]!.itemHash)) {
      return { status: "conflict" as const };
    }
    const saved = [];
    const moved: Moved = new Map();
    for (const candidate of chosen) {
      saved.push(await storeReread(tx, raceId, snapshot, candidate!, auth.principal.accountId, request.requestId, now, moved));
    }
    return { status: "applied" as const, response: readoutRereadCommitResponseSchema.parse({ formatVersion: 1, raceId,
      requestId: request.requestId, replayed: false, saved, appliedAt: now.toISOString() }) };
  });
}
