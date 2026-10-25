import { and, asc, desc, eq } from "drizzle-orm";
import {
  deviceBatchAcknowledgementSchema,
  deviceBatchSchema,
  evaluationResultSchema,
  serverResultSummarySchema,
  type DeviceBatch,
  type DeviceBatchAcknowledgement,
  type DeviceEventAcknowledgement,
  type ServerResultSummary
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { RESULT_ENGINE_VERSION, type EvaluationResult } from "@o-tid/domain";
import { cardAlreadyReadOutBy } from "./card-reuse";
import { lockRaceForSnapshot } from "./concurrency";
import { contentHash, evaluationHash as hashEvaluation } from "./serialization";
import { loadRaceSnapshot, type DbExecutor } from "./snapshot";
import { evaluateAndStore, normalizedReadout } from "./result-revisions";
import { relayTeamOfEntry } from "./relay-model";
import { synchronizeRelayTeams } from "./relay-sync";

export type AckStatus = DeviceEventAcknowledgement["status"];

async function findPersistedServerResult(
  tx: DbExecutor,
  rawMessageId: string
): Promise<ServerResultSummary | undefined> {
  const [outcome] = await tx.select({
    serverResult: schema.deviceIngestOutcomes.serverResult,
    evaluationHash: schema.deviceIngestOutcomes.evaluationHash
  }).from(schema.deviceIngestOutcomes)
    .where(eq(schema.deviceIngestOutcomes.rawMessageId, rawMessageId))
    .limit(1);
  if (outcome) {
    const serverResult = serverResultSummarySchema.parse(outcome.serverResult);
    if (serverResult.evaluationHash !== outcome.evaluationHash) {
      throw new Error("Det beständiga ingestutfallet har en motsägande bedömningshash");
    }
    return serverResult;
  }

  const [result] = await tx.select({
    resultRevisionId: schema.resultRevisions.id,
    revision: schema.resultRevisions.revision,
    status: schema.resultRevisions.status,
    reason: schema.resultRevisions.reason,
    engineVersion: schema.resultRevisions.engineVersion,
    snapshotVersion: schema.resultRevisions.snapshotVersion,
    courseVersionId: schema.resultRevisions.courseVersionId,
    evaluation: schema.resultRevisions.evaluation
  }).from(schema.resultRevisions)
    .innerJoin(schema.cardReadouts, eq(schema.resultRevisions.readoutId, schema.cardReadouts.id))
    .where(eq(schema.cardReadouts.rawMessageId, rawMessageId))
    .orderBy(desc(schema.resultRevisions.revision))
    .limit(1);
  if (!result) return undefined;
  return serverResultSummarySchema.parse({
    resultRevisionId: result.resultRevisionId,
    revision: result.revision,
    status: result.status as ServerResultSummary["status"],
    reason: result.reason as ServerResultSummary["reason"],
    engineVersion: result.engineVersion,
    snapshotVersion: result.snapshotVersion,
    courseVersionId: result.courseVersionId,
    evaluationHash: hashEvaluation(evaluationResultSchema.parse(result.evaluation))
  });
}

/** Avläsningens tolkade uppgifter, så som de sparas i `card_readout`. */
export interface IngestedReadout {
  readonly cardNumber: string;
  readonly startPunchedAt?: string | undefined;
  readonly finishPunchedAt?: string | undefined;
  readonly checkPunchedAt?: string | undefined;
  readonly clearPunchedAt?: string | undefined;
  readonly punches: readonly { code: number; punchedAt: string }[];
  readonly clockSource?: "station" | "device" | undefined;
  readonly clockOffsetMs?: number | undefined;
}

/**
 * Sparar den tolkade avläsningen till ett redan sparat råmeddelande, bedömer den och sparar mottagningens utfall.
 * Delas av mottagningen och (steg 45) av en otolkad avläsning som läses om från sina råramar.
 */
type IngestTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function storeIngestedReadout(tx: IngestTransaction, raceId: string, rawMessageId: string, input: IngestedReadout,
  readAt: Date): Promise<ServerResultSummary> {
  const [readoutRow] = await tx.insert(schema.cardReadouts).values({
    raceId,
    rawMessageId,
    cardNumber: input.cardNumber,
    startPunchedAt: input.startPunchedAt ? new Date(input.startPunchedAt) : null,
    finishPunchedAt: input.finishPunchedAt ? new Date(input.finishPunchedAt) : null,
    punches: input.punches.map((punch) => ({ code: punch.code, punchedAt: punch.punchedAt })),
    readAt,
    // Check och clear (steg 31): gamla stämplingar före dem räknas inte i bedömningen.
    checkPunchedAt: input.checkPunchedAt ? new Date(input.checkPunchedAt) : null,
    clearPunchedAt: input.clearPunchedAt ? new Date(input.clearPunchedAt) : null,
    clockSource: input.clockSource ?? null,
    clockOffsetMs: input.clockOffsetMs ?? null
  }).returning();
  if (!readoutRow) throw new Error("Normaliserad avläsning kunde inte sparas");
  const snapshot = await loadRaceSnapshot(tx, raceId);
  const normalized = normalizedReadout(readoutRow);
  // Steg 31 (B4): har brickans deltagare redan ett resultat från en annan avläsning av samma bricka (lånad bricka,
  // två löpare efter varandra) skrivs det inte över. Avläsningen blir okänd tills någon väljer vem den hör till.
  const owner = snapshot.cardAssignments.find((assignment) => assignment.active && assignment.cardNumber === normalized.cardNumber);
  const alreadyReadOutBy = await cardAlreadyReadOutBy(tx, owner?.entryId, normalized);
  const unknown: EvaluationResult = { status: "UNKNOWN_CARD", reason: "UNKNOWN_CARD", missingControls: [], extraPunches: [], splits: [] };
  const stored = alreadyReadOutBy ? { stored: false as const, evaluation: unknown }
    : await evaluateAndStore(tx, snapshot, normalized, "CARD_READOUT");
  const evaluation = stored.evaluation;
  const resultEvaluationHash = hashEvaluation(evaluation);
  let serverResult: ServerResultSummary;

  if (stored.stored) {
    const revision = stored.revision.revision;
    const entryId = stored.revision.entryId;
    // Stafett: sträckans måltid ger nästa sträckas start; senare sträckor räknas om vid behov.
    const teamId = await relayTeamOfEntry(tx, entryId);
    if (teamId) await synchronizeRelayTeams(tx, raceId, [teamId], snapshot.race.snapshotVersion);
    serverResult = serverResultSummarySchema.parse({
      resultRevisionId: stored.revision.id,
      revision,
      status: evaluation.status,
      reason: evaluation.reason,
      engineVersion: RESULT_ENGINE_VERSION,
      snapshotVersion: snapshot.race.snapshotVersion,
      evaluationHash: resultEvaluationHash,
      courseVersionId: stored.revision.courseVersionId
    });
  } else {
    serverResult = serverResultSummarySchema.parse({
      status: evaluation.status,
      reason: evaluation.reason,
      engineVersion: RESULT_ENGINE_VERSION,
      snapshotVersion: snapshot.race.snapshotVersion,
      evaluationHash: resultEvaluationHash
    });
  }

  await tx.insert(schema.deviceIngestOutcomes).values({
    rawMessageId,
    serverResult,
    evaluationHash: resultEvaluationHash
  });
  return serverResult;
}

function hasSameImmutableContext(
  existing: typeof schema.rawDeviceMessages.$inferSelect,
  raceId: string,
  batch: DeviceBatch,
  event: DeviceBatch["events"][number]
) {
  return existing.raceId === raceId &&
    existing.sessionId === batch.sessionId &&
    existing.packageVersion === batch.packageVersion &&
    existing.stationReceivedAt.getTime() === new Date(event.stationReceivedAt).getTime() &&
    existing.transport === event.transport;
}

export async function ingestDeviceBatch(
  db: Database,
  raceId: string,
  input: DeviceBatch
): Promise<DeviceBatchAcknowledgement> {
  const batch = deviceBatchSchema.parse(input);
  const [raceBeforeIngest] = await db.select({ id: schema.races.id })
    .from(schema.races).where(eq(schema.races.id, raceId));
  if (!raceBeforeIngest) throw new Error("Loppet finns inte");

  const acknowledgements: DeviceEventAcknowledgement[] = [];

  for (const event of batch.events) {
    if (contentHash(event.payload) !== event.contentHash) {
      acknowledgements.push({
        localSequence: event.localSequence,
        contentHash: event.contentHash,
        status: "rejected",
        reason: "CONTENT_HASH_MISMATCH"
      });
      continue;
    }

    const acknowledgement = await db.transaction(async (tx): Promise<DeviceEventAcknowledgement> => {
      await lockRaceForSnapshot(tx, raceId);
      const [inserted] = await tx.insert(schema.rawDeviceMessages).values({
        raceId,
        deviceId: batch.deviceId,
        sessionId: batch.sessionId,
        localSequence: event.localSequence,
        packageVersion: batch.packageVersion,
        stationReceivedAt: new Date(event.stationReceivedAt),
        transport: event.transport,
        rawPayload: event.payload,
        contentHash: event.contentHash
      }).onConflictDoNothing().returning();

      if (!inserted) {
        const [existing] = await tx.select().from(schema.rawDeviceMessages).where(and(
          eq(schema.rawDeviceMessages.deviceId, batch.deviceId),
          eq(schema.rawDeviceMessages.localSequence, event.localSequence)
        ));
        if (!existing) throw new Error("Sekvenskonflikten saknar en beständig råpost");
        if (existing.contentHash !== event.contentHash) {
          return {
            localSequence: event.localSequence,
            contentHash: event.contentHash,
            status: "rejected",
            reason: "SEQUENCE_HASH_CONFLICT"
          };
        }
        if (!hasSameImmutableContext(existing, raceId, batch, event)) {
          return {
            localSequence: event.localSequence,
            contentHash: event.contentHash,
            status: "rejected",
            reason: "SEQUENCE_CONTEXT_CONFLICT"
          };
        }
        const serverResult = await findPersistedServerResult(tx, existing.id);
        return {
          localSequence: event.localSequence,
          contentHash: event.contentHash,
          status: "duplicate",
          rawMessageId: existing.id,
          ...(serverResult ? { serverResult } : {})
        };
      }

      const payload = event.payload;
      const serverResult = await storeIngestedReadout(tx, raceId, inserted.id, {
        cardNumber: payload.cardNumber, startPunchedAt: payload.startPunchedAt, finishPunchedAt: payload.finishPunchedAt,
        checkPunchedAt: "checkPunchedAt" in payload ? payload.checkPunchedAt : undefined,
        clearPunchedAt: "clearPunchedAt" in payload ? payload.clearPunchedAt : undefined, punches: payload.punches,
        // Klockan bakom tiderna (PLAN.md steg 22) finns bara i SPORTident-nyttolasten.
        clockSource: event.transport === "sportident" ? event.payload.clockSource : undefined,
        clockOffsetMs: event.transport === "sportident" ? event.payload.clockOffsetMs : undefined
      }, new Date(event.stationReceivedAt));

      return {
        localSequence: event.localSequence,
        contentHash: event.contentHash,
        status: "stored",
        rawMessageId: inserted.id,
        serverResult
      };
    });
    acknowledgements.push(acknowledgement);
  }

  const [storedSequences, currentRace] = await Promise.all([
    db.select({ sequence: schema.rawDeviceMessages.localSequence })
      .from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.deviceId, batch.deviceId))
      .orderBy(asc(schema.rawDeviceMessages.localSequence)),
    db.select({ snapshotVersion: schema.races.snapshotVersion })
      .from(schema.races).where(eq(schema.races.id, raceId)).then((rows) => rows[0])
  ]);
  if (!currentRace) throw new Error("Loppet finns inte");

  let highestContiguousSequence = 0;
  for (const row of storedSequences) {
    if (row.sequence === highestContiguousSequence + 1) highestContiguousSequence = row.sequence;
    else if (row.sequence > highestContiguousSequence + 1) break;
  }

  const packageVersionStatus = batch.packageVersion === currentRace.snapshotVersion
    ? "current"
    : batch.packageVersion < currentRace.snapshotVersion ? "stale" : "ahead";

  return deviceBatchAcknowledgementSchema.parse({
    deviceId: batch.deviceId,
    highestContiguousSequence,
    currentPackageVersion: currentRace.snapshotVersion,
    packageVersionStatus,
    packageUpdateRequired: packageVersionStatus === "stale",
    acknowledgements
  });
}
