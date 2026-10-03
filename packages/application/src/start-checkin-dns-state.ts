import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import {
  validateStoredStartCheckinDns,
  validateStoredStartCheckinDnsWithdrawal
} from "./start-checkin-dns-source";
import { StoredResultRevisionConflict } from "./stored-result-revision";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Operation = typeof schema.startCheckinOperations.$inferSelect;
type OperationalRevision = typeof schema.startCheckinRevisions.$inferSelect;
type Device = typeof schema.startCheckinDevices.$inferSelect;

const MAX_ENTRIES = 10_000;
const MAX_SOURCES = 100_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type StoredStartCheckinDnsState = {
  readonly source: Parameters<typeof validateStoredStartCheckinDns>[0];
  readonly correction: Parameters<typeof validateStoredStartCheckinDnsWithdrawal>[1] | null;
};

function conflict(message: string): never {
  throw new StoredResultRevisionConflict(message);
}

function validateSelection(raceId: string, entryIds: readonly string[]): void {
  if (!UUID_PATTERN.test(raceId) || entryIds.length > MAX_ENTRIES) {
    conflict("Avpricknings-DNS-källans urval är ogiltigt eller för stort");
  }
  const seen = new Set<string>();
  for (const entryId of entryIds) {
    if (!UUID_PATTERN.test(entryId) || seen.has(entryId)) {
      conflict("Avpricknings-DNS-källans deltagarurval är inte kanoniskt");
    }
    seen.add(entryId);
  }
}

function mapRows<T>(rows: readonly T[], key: (row: T) => string, description: string): Map<string, T> {
  const byId = new Map(rows.map((row) => [key(row), row]));
  if (byId.size !== rows.length) conflict(`${description} har motstridiga dubletter`);
  return byId;
}

function required<T>(rows: ReadonlyMap<string, T>, id: string, description: string): T {
  const row = rows.get(id);
  if (!row) conflict(`${description} saknas`);
  return row;
}

/**
 * Loads every immutable check-in DNS lifecycle for the selected entries. The
 * caller deliberately chooses a result head and applies any withdrawal later.
 */
export async function loadStoredStartCheckinDnsStates(
  tx: DatabaseTransaction,
  raceId: string,
  entryIds: readonly string[]
): Promise<Map<string, StoredStartCheckinDnsState>> {
  validateSelection(raceId, entryIds);
  if (entryIds.length === 0) return new Map();

  const decisions = await tx.select().from(schema.startCheckinDnsDecisions).where(and(
    eq(schema.startCheckinDnsDecisions.raceId, raceId),
    inArray(schema.startCheckinDnsDecisions.entryId, entryIds)
  )).limit(MAX_SOURCES + 1);
  if (decisions.length > MAX_SOURCES) {
    conflict("Avpricknings-DNS-källor överskrider läsarens gräns");
  }
  const selectedEntryIds = new Set(entryIds);
  if (decisions.some((decision) => decision.raceId !== raceId || !selectedEntryIds.has(decision.entryId))) {
    conflict("Avpricknings-DNS-beslutet ligger utanför valt lopp eller deltagare");
  }
  if (decisions.length === 0) return new Map();

  const decisionById = mapRows(decisions, (decision) => decision.id, "Avpricknings-DNS-besluten");
  const decisionIds = [...decisionById.keys()];
  const [results, withdrawals] = await Promise.all([
    tx.select().from(schema.resultRevisions)
      .where(inArray(schema.resultRevisions.id, decisions.map((decision) => decision.createdResultRevisionId))),
    tx.select().from(schema.startCheckinDnsWithdrawals).where(and(
      eq(schema.startCheckinDnsWithdrawals.raceId, raceId),
      inArray(schema.startCheckinDnsWithdrawals.startCheckinDnsDecisionId, decisionIds)
    )).limit(MAX_SOURCES + 1)
  ]);
  if (decisions.length + withdrawals.length > MAX_SOURCES) {
    conflict("Avpricknings-DNS-källor överskrider läsarens gräns");
  }
  const resultById = mapRows(results, (result) => result.id, "Avpricknings-DNS-resultatrevisionerna");
  const withdrawalByDecisionId = new Map(withdrawals.map((withdrawal) => [withdrawal.startCheckinDnsDecisionId, withdrawal]));
  if (withdrawalByDecisionId.size !== withdrawals.length) {
    conflict("Avpricknings-DNS-beslutet har flera återtaganden");
  }
  for (const withdrawal of withdrawals) {
    const decision = decisionById.get(withdrawal.startCheckinDnsDecisionId);
    if (!decision || withdrawal.raceId !== raceId || withdrawal.entryId !== decision.entryId) {
      conflict("Avpricknings-DNS-återtagandet ligger utanför sin källa");
    }
  }

  const operationsByRequestId = new Map<string, Operation>();
  const revisionsById = new Map<string, OperationalRevision>();
  const devicesById = new Map<string, Device>();
  const sourceReferences = [
    ...decisions.map((decision) => ({ requestId: decision.operationRequestId, revisionId: decision.startCheckinRevisionId })),
    ...withdrawals.map((withdrawal) => ({ requestId: withdrawal.operationRequestId, revisionId: withdrawal.startCheckinRevisionId }))
  ];
  const requestIds = [...new Set(sourceReferences.map((reference) => reference.requestId))];
  const operationalRevisionIds = [...new Set(sourceReferences.map((reference) => reference.revisionId))];
  const operations = await tx.select().from(schema.startCheckinOperations)
    .where(inArray(schema.startCheckinOperations.requestId, requestIds));
  for (const [id, row] of mapRows(operations, (operation) => operation.requestId, "Avpricknings-DNS-operationerna")) operationsByRequestId.set(id, row);
  const operationalRevisions = await tx.select().from(schema.startCheckinRevisions)
    .where(inArray(schema.startCheckinRevisions.id, operationalRevisionIds));
  for (const [id, row] of mapRows(operationalRevisions, (revision) => revision.id, "Avpricknings-DNS-operativa revisionerna")) revisionsById.set(id, row);
  const deviceIds = [...new Set(operations.map((operation) => operation.deviceId))];
  const devices = await tx.select().from(schema.startCheckinDevices)
    .where(inArray(schema.startCheckinDevices.id, deviceIds));
  for (const [id, row] of mapRows(devices, (device) => device.id, "Avpricknings-DNS-enheterna")) devicesById.set(id, row);

  const states = new Map<string, StoredStartCheckinDnsState>();
  for (const decision of decisions) {
    const result = required(resultById, decision.createdResultRevisionId, "Avpricknings-DNS-resultatrevisionen");
    const operation = required(operationsByRequestId, decision.operationRequestId, "Avpricknings-DNS-operationen");
    const operationalRevision = required(revisionsById, decision.startCheckinRevisionId, "Avpricknings-DNS-operativa revisionen");
    const device = required(devicesById, operation.deviceId, "Avpricknings-DNS-enheten");
    const source = { decision, result, operation, operationalRevision, device };
    validateStoredStartCheckinDns(source);

    const withdrawal = withdrawalByDecisionId.get(decision.id);
    const correction = withdrawal === undefined ? null : {
      withdrawal,
      operation: required(operationsByRequestId, withdrawal.operationRequestId, "Avpricknings-DNS-återtagandeoperationen"),
      operationalRevision: required(revisionsById, withdrawal.startCheckinRevisionId, "Avpricknings-DNS-återtaganderevisionen"),
      device: required(devicesById,
        required(operationsByRequestId, withdrawal.operationRequestId, "Avpricknings-DNS-återtagandeoperationen").deviceId,
        "Avpricknings-DNS-återtagandeenheten")
    };
    if (correction !== null) validateStoredStartCheckinDnsWithdrawal(source, correction);
    if (states.has(result.id)) conflict("Flera avpricknings-DNS-källor pekar på samma resultatrevision");
    states.set(result.id, { source, correction });
  }
  return states;
}
