import { createHash, randomUUID } from "node:crypto";
import { canonicalStartCheckinOperation } from "@o-tid/contracts";
import { schema } from "@o-tid/database";

export const at = new Date("2026-09-05T10:00:00.000Z");
export function report(state: "UNMARKED" | "STARTED" | "REPORTED_NOT_STARTED", revision: number) {
  const requestId = randomUUID(), raceId = randomUUID(), entryId = randomUUID(), deviceId = randomUUID(), actorCredentialId = randomUUID(), revisionId = randomUUID();
  const intent = { formatVersion: 1, requestId, dependsOnRequestId: null, raceId, entryId, deviceId, actorCredentialId,
    localSequence: revision, packageVersion: 1, expectedEntryVersion: 1, expectedRevision: revision - 1,
    observedAt: at.toISOString(), action: { kind: "MARK_START", state } };
  const hash = createHash("sha256").update(canonicalStartCheckinOperation(intent)).digest("hex");
  const device: typeof schema.startCheckinDevices.$inferSelect = { id: deviceId, raceId, actorCredentialId,
    capability: "START_CHECKIN", label: "Synthetic device", registeredAt: at };
  const operation: typeof schema.startCheckinOperations.$inferSelect = { requestId, raceId, entryId, deviceId, actorCredentialId,
    localSequence: revision, packageVersion: 1, expectedEntryVersion: 1, expectedRevision: revision - 1, contentHash: hash,
    observedAt: at, receivedAt: at, effect: "APPLIED", resultingRevision: revision, createdRevisionId: revisionId, conflictReason: null,
    intent, receipt: { formatVersion: 1, storage: "STORED", requestId, raceId, entryId, deviceId, localSequence: revision,
      contentHash: hash, receivedAt: at.toISOString(), effect: { kind: "APPLIED", revisionId, revision } } };
  const operationalRevision: typeof schema.startCheckinRevisions.$inferSelect = { id: revisionId, requestId, raceId, entryId,
    revision, operationEffect: "APPLIED", startState: state, manualReturnRegistered: false };
  return { device, operation, operationalRevision };
}

export function fixture() {
  const r = report("REPORTED_NOT_STARTED", 1);
  const resultId = randomUUID(), decisionId = randomUUID(), classId = randomUUID(), courseVersionId = randomUUID();
  const { raceId, entryId, actorCredentialId } = r.operation;
  const decision: typeof schema.startCheckinDnsDecisions.$inferSelect = { id: decisionId, raceId, entryId, actorCredentialId,
    operationRequestId: r.operation.requestId, startCheckinRevisionId: r.operationalRevision.id, operationalRevision: 1,
    classId, courseVersionId, snapshotVersion: 1, expectedLatestResultRevision: 0, createdResultRevisionId: resultId,
    createdResultRevision: 1, policyVersion: "start-checkin-dns-v1", decidedAt: at };
  const result: typeof schema.resultRevisions.$inferSelect = {
    id: resultId, raceId, entryId, readoutId: null, revision: 1, cause: "START_CHECKIN_DID_NOT_START",
    startCheckinDnsDecisionId: decisionId, didNotStartDecisionId: null,
    controlNeutralizationId: null,
    disqualificationDecisionId: null, disqualificationWithdrawalId: null, approvalDecisionId: null, approvalWithdrawalId: null,
    didNotFinishDecisionId: null, didNotFinishWithdrawalId: null, notCompetingDecisionId: null, notCompetingWithdrawalId: null,
    withoutTimingDecisionId: null, withoutTimingWithdrawalId: null,
    manualFinishTimeCorrectionId: null,
    manualFinishTimeCorrectionWithdrawalId: null,
    manualPunchStartTimeCorrectionId: null,
    manualPunchStartTimeCorrectionWithdrawalId: null,
    shortenedCourseClassTransferId: null,
    status: "DNS", reason: "DID_NOT_START", engineVersion: "start-checkin-dns-v1", snapshotVersion: 1, basisHash: null, courseVersionId,
    published: true, createdAt: at, evaluation: { status: "DNS", reason: "DID_NOT_START", entryId, classId, courseVersionId }
  };
  return { ...r, decision, result };
}

export function correction(source: ReturnType<typeof fixture>) {
  const r = report("UNMARKED", 2);
  const { raceId, entryId } = source.operation;
  r.device.raceId = raceId;
  r.operation.raceId = raceId; r.operation.entryId = entryId;
  r.operation.localSequence = 1;
  r.operationalRevision.raceId = raceId; r.operationalRevision.entryId = entryId;
  r.operation.intent = { ...r.operation.intent, raceId, entryId, localSequence: 1 };
  r.operation.contentHash = createHash("sha256").update(canonicalStartCheckinOperation(r.operation.intent)).digest("hex");
  r.operation.receipt = { ...r.operation.receipt, raceId, entryId, localSequence: 1, contentHash: r.operation.contentHash };
  const withdrawal: typeof schema.startCheckinDnsWithdrawals.$inferSelect = {
    id: randomUUID(), raceId, entryId, actorCredentialId: r.device.actorCredentialId,
    operationRequestId: r.operation.requestId, startCheckinRevisionId: r.operationalRevision.id, operationalRevision: 2,
    startCheckinDnsDecisionId: source.decision.id, withdrawnResultRevisionId: source.result.id, withdrawnResultRevision: 1,
    policyVersion: "start-checkin-dns-withdrawal-v1", withdrawnAt: at
  };
  return { ...r, withdrawal };
}
