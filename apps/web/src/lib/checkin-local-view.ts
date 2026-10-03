import type { StartCheckinOperation, StartCheckinReceipt, StartCheckinRosterResponse } from "@o-tid/contracts";

/** Local operational intent only: never a result, DNS decision, official start time or forest classification. */
export function checkinLocalView(
  entry: StartCheckinRosterResponse["entries"][number],
  operations: readonly { operation: StartCheckinOperation; receipt: StartCheckinReceipt | null }[]
) {
  const local = operations.filter((row) => row.operation.entryId === entry.entryId);
  const reviewed = new Set(entry.reviewedConflictRequestIds ?? []);
  let revision = entry.revision, state = entry.startState, manualReturnRegistered = entry.manualReturnRegistered;
  let dependsOnRequestId: string | null = null;
  for (const prior of local) {
    if (prior.receipt?.effect.kind === "CONFLICT" || (prior.receipt !== null && prior.receipt.effect.revision <= entry.revision)) continue;
    revision = prior.receipt?.effect.revision ?? prior.operation.expectedRevision + 1;
    state = prior.operation.action.state;
    if (prior.operation.action.kind === "FINISH_CORRECTION") manualReturnRegistered = prior.operation.action.manualReturnRegistered;
    dependsOnRequestId = prior.operation.requestId;
  }
  return { revision, state, manualReturnRegistered, dependsOnRequestId,
    pending: local.filter((row) => row.receipt === null).length,
    conflicts: local.filter((row) => row.receipt?.effect.kind === "CONFLICT" && !reviewed.has(row.operation.requestId)).length,
    reviewedConflicts: local.filter((row) => row.receipt?.effect.kind === "CONFLICT" && reviewed.has(row.operation.requestId)).length };
}
