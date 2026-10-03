import { createHash } from "node:crypto";
import {
  canonicalStartCheckinOperation, resultOutcomeSchema, StartCheckinOperationSchema, StartCheckinReceiptSchema
} from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import { StoredResultRevisionConflict } from "./stored-result-revision";
import { allowsStartCheckinSourceAction } from "./start-checkin-source-action";

type Operation = typeof schema.startCheckinOperations.$inferSelect;
type OperationalRevision = typeof schema.startCheckinRevisions.$inferSelect;
type Device = typeof schema.startCheckinDevices.$inferSelect;
type Decision = typeof schema.startCheckinDnsDecisions.$inferSelect;
type Withdrawal = typeof schema.startCheckinDnsWithdrawals.$inferSelect;
type Revision = typeof schema.resultRevisions.$inferSelect;
const decisionPolicy = "start-checkin-dns-v1";
const withdrawalPolicy = "start-checkin-dns-withdrawal-v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fail(): never { throw new StoredResultRevisionConflict("Avpricknings-DNS har motsägande provenans"); }
function sameTime(a: Date, b: Date): boolean {
  return Number.isFinite(a.getTime()) && a.getTime() === b.getTime();
}

function appliedOperation(operation: Operation, revision: OperationalRevision, device: Device) {
  const intent = StartCheckinOperationSchema.safeParse(operation.intent);
  const receipt = StartCheckinReceiptSchema.safeParse(operation.receipt);
  if (!intent.success || !receipt.success) return fail();
  const i = intent.data, r = receipt.data;
  if (operation.effect !== "APPLIED" || operation.conflictReason !== null ||
    operation.createdRevisionId !== revision.id || revision.operationEffect !== "APPLIED" ||
    operation.resultingRevision !== revision.revision || operation.expectedRevision + 1 !== revision.revision ||
    revision.requestId !== operation.requestId || revision.raceId !== operation.raceId || revision.entryId !== operation.entryId ||
    i.requestId !== operation.requestId || i.raceId !== operation.raceId || i.entryId !== operation.entryId ||
    i.deviceId !== operation.deviceId || i.actorCredentialId !== operation.actorCredentialId ||
    i.localSequence !== operation.localSequence || i.packageVersion !== operation.packageVersion ||
    i.expectedEntryVersion !== operation.expectedEntryVersion || i.expectedRevision !== operation.expectedRevision ||
    !sameTime(new Date(i.observedAt), operation.observedAt) ||
    createHash("sha256").update(canonicalStartCheckinOperation(i)).digest("hex") !== operation.contentHash ||
    r.requestId !== i.requestId || r.raceId !== i.raceId || r.entryId !== i.entryId || r.deviceId !== i.deviceId ||
    r.localSequence !== i.localSequence || r.contentHash !== operation.contentHash ||
    !sameTime(new Date(r.receivedAt), operation.receivedAt) || r.effect.kind !== "APPLIED" ||
    r.effect.revisionId !== revision.id || r.effect.revision !== revision.revision ||
    device.id !== i.deviceId || device.raceId !== i.raceId || device.actorCredentialId !== i.actorCredentialId ||
    !allowsStartCheckinSourceAction(device.capability, i.action) ||
    i.action.state !== revision.startState ||
    (i.action.kind === "FINISH_CORRECTION" && i.action.manualReturnRegistered !== revision.manualReturnRegistered)) return fail();
  return i;
}

/** Validates immutable historical provenance, not current roster or absence of a later return. */
export function validateStoredStartCheckinDns(source: {
  decision: Decision; result: Revision; operation: Operation; operationalRevision: OperationalRevision; device: Device;
}) {
  const { decision: d, result, operation: op, operationalRevision: rev, device } = source;
  appliedOperation(op, rev, device);
  const parsed = resultOutcomeSchema.safeParse(result.evaluation);
  const olderSources = [result.readoutId, result.didNotStartDecisionId, result.disqualificationDecisionId,
    result.disqualificationWithdrawalId, result.approvalDecisionId, result.approvalWithdrawalId,
    result.didNotFinishDecisionId, result.didNotFinishWithdrawalId, result.notCompetingDecisionId,
    result.notCompetingWithdrawalId, result.withoutTimingDecisionId, result.withoutTimingWithdrawalId];
  if (!parsed.success || parsed.data.status !== "DNS" || !uuid.test(d.id) || !uuid.test(rev.id) ||
    !uuid.test(result.id) || !uuid.test(d.classId) || !uuid.test(d.courseVersionId) ||
    !Number.isInteger(d.expectedLatestResultRevision) || d.expectedLatestResultRevision < 0 ||
    d.expectedLatestResultRevision >= 2_147_483_647 || d.createdResultRevision !== d.expectedLatestResultRevision + 1 ||
    d.policyVersion !== decisionPolicy || result.engineVersion !== decisionPolicy ||
    d.createdResultRevisionId !== result.id || result.startCheckinDnsDecisionId !== d.id ||
    d.createdResultRevision !== result.revision || result.cause !== "START_CHECKIN_DID_NOT_START" ||
    result.status !== "DNS" || result.reason !== "DID_NOT_START" || !result.published || olderSources.some((value) => value !== null) ||
    d.operationRequestId !== op.requestId || d.startCheckinRevisionId !== rev.id || d.operationalRevision !== rev.revision ||
    d.raceId !== op.raceId || d.raceId !== result.raceId || d.entryId !== op.entryId || d.entryId !== result.entryId ||
    d.actorCredentialId !== op.actorCredentialId || d.snapshotVersion !== op.packageVersion ||
    d.snapshotVersion !== result.snapshotVersion || d.courseVersionId !== result.courseVersionId ||
    parsed.data.entryId !== d.entryId || parsed.data.classId !== d.classId || parsed.data.courseVersionId !== d.courseVersionId ||
    rev.startState !== "REPORTED_NOT_STARTED" || rev.manualReturnRegistered ||
    !sameTime(d.decidedAt, op.receivedAt) || !sameTime(d.decidedAt, result.createdAt)) return fail();
  return parsed.data;
}

/** Withdrawal proves a new corrective report; it never restores an older result. */
export function validateStoredStartCheckinDnsWithdrawal(source: Parameters<typeof validateStoredStartCheckinDns>[0], correction: {
  withdrawal: Withdrawal; operation: Operation; operationalRevision: OperationalRevision; device: Device;
}) {
  validateStoredStartCheckinDns(source);
  const { withdrawal: w, operation: op, operationalRevision: rev, device } = correction;
  appliedOperation(op, rev, device);
  if (!uuid.test(w.id) || w.policyVersion !== withdrawalPolicy ||
    w.startCheckinDnsDecisionId !== source.decision.id || w.withdrawnResultRevisionId !== source.result.id ||
    w.withdrawnResultRevision !== source.result.revision || w.raceId !== source.decision.raceId || w.entryId !== source.decision.entryId ||
    w.raceId !== op.raceId || w.entryId !== op.entryId || w.actorCredentialId !== op.actorCredentialId ||
    w.operationRequestId !== op.requestId || w.startCheckinRevisionId !== rev.id || w.operationalRevision !== rev.revision ||
    rev.revision <= source.operationalRevision.revision ||
    (rev.startState === "REPORTED_NOT_STARTED" && !rev.manualReturnRegistered) ||
    !sameTime(w.withdrawnAt, op.receivedAt)) return fail();
  return w;
}
