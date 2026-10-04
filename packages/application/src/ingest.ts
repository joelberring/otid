import { and, asc, desc, eq, max } from "drizzle-orm";
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
import { evaluateCardReadout, RESULT_ENGINE_VERSION, type NormalizedCardReadout } from "@o-tid/domain";
import { lockEntryForRevision, lockRaceForSnapshot } from "./concurrency";
import { contentHash, evaluationHash as hashEvaluation } from "./hash";
import { loadRaceSnapshot, type DbExecutor } from "./snapshot";
import { appliedControlNeutralization } from "./class-control-neutralization";
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
      const [readoutRow] = await tx.insert(schema.cardReadouts).values({
        raceId,
        rawMessageId: inserted.id,
        cardNumber: payload.cardNumber,
        startPunchedAt: payload.startPunchedAt ? new Date(payload.startPunchedAt) : null,
        finishPunchedAt: payload.finishPunchedAt ? new Date(payload.finishPunchedAt) : null,
        punches: payload.punches,
        readAt: new Date(event.stationReceivedAt)
      }).returning();
      if (!readoutRow) throw new Error("Normaliserad avläsning kunde inte sparas");

      const normalized: NormalizedCardReadout = {
        id: readoutRow.id,
        raceId,
        cardNumber: readoutRow.cardNumber,
        ...(readoutRow.startPunchedAt ? { startPunchedAt: readoutRow.startPunchedAt.toISOString() } : {}),
        ...(readoutRow.finishPunchedAt ? { finishPunchedAt: readoutRow.finishPunchedAt.toISOString() } : {}),
        punches: readoutRow.punches,
        rawMessageId: inserted.id,
        readAt: readoutRow.readAt.toISOString()
      };
      const snapshot = await loadRaceSnapshot(tx, raceId);
        const evaluation = evaluateCardReadout(normalized, snapshot);
        const controlNeutralizationId = appliedControlNeutralization(snapshot, evaluation);
      const resultEvaluationHash = hashEvaluation(evaluation);
      let serverResult: ServerResultSummary;

      if (evaluation.entryId && evaluation.courseVersionId) {
        await lockEntryForRevision(tx, raceId, evaluation.entryId);
        const [latest] = await tx.select({ revision: max(schema.resultRevisions.revision) })
          .from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, evaluation.entryId));
        const revision = (latest?.revision ?? 0) + 1;
        const [created] = await tx.insert(schema.resultRevisions).values({
          raceId,
          entryId: evaluation.entryId,
          readoutId: readoutRow.id,
          revision,
          cause: "CARD_READOUT",
          status: evaluation.status,
          reason: evaluation.reason,
          evaluation,
          engineVersion: RESULT_ENGINE_VERSION,
          snapshotVersion: snapshot.race.snapshotVersion,
          courseVersionId: evaluation.courseVersionId,
          controlNeutralizationId,
          published: true
        }).returning({ id: schema.resultRevisions.id });
        if (!created) throw new Error("Resultatrevisionen kunde inte sparas");
        // Stafett: sträckans måltid ger nästa sträckas start; senare sträckor räknas om vid behov.
        const teamId = await relayTeamOfEntry(tx, evaluation.entryId);
        if (teamId) await synchronizeRelayTeams(tx, raceId, [teamId], snapshot.race.snapshotVersion);
        serverResult = serverResultSummarySchema.parse({
          resultRevisionId: created.id,
          revision,
          status: evaluation.status,
          reason: evaluation.reason,
          engineVersion: RESULT_ENGINE_VERSION,
          snapshotVersion: snapshot.race.snapshotVersion,
          evaluationHash: resultEvaluationHash,
          courseVersionId: evaluation.courseVersionId
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
        rawMessageId: inserted.id,
        serverResult,
        evaluationHash: resultEvaluationHash
      });

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
