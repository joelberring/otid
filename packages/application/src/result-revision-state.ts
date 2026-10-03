import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { loadStoredStartCheckinDnsStates, type StoredStartCheckinDnsState } from "./start-checkin-dns-state";
import {
  resolveDidNotStartWithdrawalResultHead,
  resolveManualDidNotFinishResultHead,
  resolveManualDisqualificationResultHead,
  resolveManualOutOfCompetitionResultHead,
  resolveManualResultApprovalResultHead,
  resolveManualWithoutTimingResultHead
} from "@o-tid/domain";
import {
  StoredResultRevisionConflict,
  validateStoredApproval,
  validateStoredApprovalWithdrawal,
  validateStoredDidNotFinish,
  validateStoredDidNotFinishWithdrawal,
  validateStoredDisqualification,
  validateStoredDisqualificationWithdrawal,
  validateStoredOutOfCompetition,
  validateStoredOutOfCompetitionWithdrawal,
  validateStoredWithoutTiming,
  validateStoredWithoutTimingWithdrawal,
  validateStoredManualFinishTimeCorrection,
  validateStoredManualFinishTimeCorrectionWithdrawal,
  validateStoredManualPunchStartTimeCorrection,
  validateStoredManualPunchStartTimeCorrectionWithdrawal,
  validateStoredShortenedCourseClassTransfer,
  type StoredManualFinishTimeCorrectionProof,
  type StoredManualFinishTimeCorrectionWithdrawalProof,
  type StoredManualPunchStartTimeCorrectionProof,
  type StoredManualPunchStartTimeCorrectionWithdrawalProof,
  type StoredShortenedCourseClassTransferProof
} from "./stored-result-revision";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Decision = typeof schema.resultDisqualificationDecisions.$inferSelect;
type Withdrawal = typeof schema.resultDisqualificationWithdrawals.$inferSelect;
type ApprovalDecision = typeof schema.resultApprovalDecisions.$inferSelect;
type ApprovalWithdrawal = typeof schema.resultApprovalWithdrawals.$inferSelect;
type DidNotFinishDecision = typeof schema.didNotFinishDecisions.$inferSelect;
type DidNotFinishWithdrawal = typeof schema.didNotFinishWithdrawals.$inferSelect;
type NotCompetingDecision = typeof schema.notCompetingDecisions.$inferSelect;
type NotCompetingWithdrawal = typeof schema.notCompetingWithdrawals.$inferSelect;
type WithoutTimingDecision = typeof schema.withoutTimingDecisions.$inferSelect;
type WithoutTimingWithdrawal = typeof schema.withoutTimingWithdrawals.$inferSelect;
type Revision = typeof schema.resultRevisions.$inferSelect;

export interface StoredResultHead {
  readonly id: string;
  readonly entryId: string;
  readonly revision: number;
  readonly didNotStartDecisionId: string | null;
  readonly startCheckinDnsDecisionId: string | null;
  readonly manualFinishTimeCorrectionId?: string | null;
  readonly manualFinishTimeCorrectionWithdrawalId?: string | null;
  readonly manualPunchStartTimeCorrectionId?: string | null;
  readonly manualPunchStartTimeCorrectionWithdrawalId?: string | null;
  readonly shortenedCourseClassTransferId?: string | null;
  readonly didNotFinishDecisionId: string | null;
  readonly didNotFinishWithdrawalId: string | null;
  readonly notCompetingDecisionId: string | null;
  readonly notCompetingWithdrawalId: string | null;
  readonly withoutTimingDecisionId: string | null;
  readonly withoutTimingWithdrawalId: string | null;
}

export interface StoredResultDisqualificationState {
  readonly decision: Decision;
  readonly target: Revision;
  readonly disqualified: Revision;
  readonly withdrawal: Withdrawal | null;
  readonly restorationSource: Revision | null;
  readonly restoration: Revision | null;
}

export interface StoredResultApprovalState {
  readonly decision: ApprovalDecision;
  readonly target: Revision;
  readonly approved: Revision;
  readonly withdrawal: ApprovalWithdrawal | null;
  readonly restorationSource: Revision | null;
  readonly restoration: Revision | null;
}

export interface StoredDidNotFinishState {
  readonly decision: DidNotFinishDecision;
  readonly target: Revision;
  readonly didNotFinish: Revision;
  readonly withdrawal: DidNotFinishWithdrawal | null;
  readonly expectedLatest: Revision | null;
  readonly restorationSource: Revision | null;
  readonly restoration: Revision | null;
}

export interface StoredOutOfCompetitionState {
  readonly decision: NotCompetingDecision;
  readonly target: Revision;
  readonly outOfCompetition: Revision;
  readonly withdrawal: NotCompetingWithdrawal | null;
  readonly expectedLatest: Revision | null;
  readonly restorationSource: Revision | null;
  readonly restoration: Revision | null;
}

export interface StoredWithoutTimingState {
  readonly decision: WithoutTimingDecision;
  readonly target: Revision;
  readonly withoutTiming: Revision;
  readonly withdrawal: WithoutTimingWithdrawal | null;
  readonly expectedLatest: Revision | null;
  readonly restorationSource: Revision | null;
  readonly restoration: Revision | null;
}

export type StoredResultHeadState<T extends StoredResultHead> =
  | {
    readonly state: "ACTIVE_RESULT";
    readonly startCheckinDns?: StoredStartCheckinDnsState | null;
    readonly head: T;
    readonly selectedHead: T;
    readonly withdrawal: null;
    readonly disqualification: StoredResultDisqualificationState | null;
    readonly approval: StoredResultApprovalState | null;
    readonly didNotFinish: StoredDidNotFinishState | null;
    readonly notCompeting: StoredOutOfCompetitionState | null;
    readonly withoutTiming: StoredWithoutTimingState | null;
    readonly finishTimeCorrection: StoredManualFinishTimeCorrectionProof | null;
    readonly finishTimeCorrectionWithdrawal: StoredManualFinishTimeCorrectionWithdrawalProof | null;
    readonly punchStartTimeCorrection: StoredManualPunchStartTimeCorrectionProof | null;
    readonly punchStartTimeCorrectionWithdrawal: StoredManualPunchStartTimeCorrectionWithdrawalProof | null;
    readonly shortenedCourseClassTransfer: StoredShortenedCourseClassTransferProof | null;
  }
  | {
    readonly state: "NO_ACTIVE_RESULT";
    readonly startCheckinDns?: StoredStartCheckinDnsState | null;
    readonly head: T;
    readonly selectedHead: T;
    readonly withdrawal: typeof schema.didNotStartWithdrawals.$inferSelect | typeof schema.startCheckinDnsWithdrawals.$inferSelect;
    readonly disqualification: null;
    readonly approval: null;
    readonly didNotFinish: null;
    readonly notCompeting: null;
    readonly withoutTiming: null;
    readonly finishTimeCorrection: null;
    readonly finishTimeCorrectionWithdrawal: null;
    readonly punchStartTimeCorrection: null;
    readonly punchStartTimeCorrectionWithdrawal: null;
    readonly shortenedCourseClassTransfer: null;
  };

function withRevision<T extends StoredResultHead>(displaySource: T, revision: Revision): T {
  return { ...displaySource, ...revision } as T;
}

/**
 * Resolves manual DNS, DSQ, approval and DNF lifecycle state after a reader has
 * made its normal head selection. Active manual decisions deliberately survive
 * later technical readouts; approval and DSQ are mutually exclusive overlays.
 */
export async function resolveStoredResultHeadStates<T extends StoredResultHead>(
  tx: DatabaseTransaction,
  raceId: string,
  selectedHeads: readonly T[]
): Promise<StoredResultHeadState<T>[]> {
  if (selectedHeads.length === 0) return [];
  const selectedIds = selectedHeads.map((head) => head.id);
  const entryIds = selectedHeads.map((head) => head.entryId);
  const checkinDnsByResult = await loadStoredStartCheckinDnsStates(tx, raceId, entryIds);
  const correctionRows = await tx.select().from(schema.manualFinishTimeCorrections).where(and(
    eq(schema.manualFinishTimeCorrections.raceId, raceId),
    inArray(schema.manualFinishTimeCorrections.createdResultRevisionId, selectedIds)
  ));
  if (new Set(correctionRows.map((row) => row.createdResultRevisionId)).size !== correctionRows.length) {
    throw new StoredResultRevisionConflict("Måltidsrättningen har flera beslut för samma revision");
  }
  const correctionWithdrawalRows = await tx.select().from(schema.manualFinishTimeCorrectionWithdrawals).where(and(
    eq(schema.manualFinishTimeCorrectionWithdrawals.raceId, raceId),
    inArray(schema.manualFinishTimeCorrectionWithdrawals.createdResultRevisionId, selectedIds)
  ));
  const punchStartCorrectionRows = await tx.select().from(schema.manualPunchStartTimeCorrections).where(and(
    eq(schema.manualPunchStartTimeCorrections.raceId, raceId),
    inArray(schema.manualPunchStartTimeCorrections.createdResultRevisionId, selectedIds)
  ));
  const punchStartCorrectionWithdrawalRows = await tx.select().from(schema.manualPunchStartTimeCorrectionWithdrawals).where(and(
    eq(schema.manualPunchStartTimeCorrectionWithdrawals.raceId, raceId),
    inArray(schema.manualPunchStartTimeCorrectionWithdrawals.createdResultRevisionId, selectedIds)
  ));
  if (new Set(punchStartCorrectionRows.map((row) => row.createdResultRevisionId)).size !== punchStartCorrectionRows.length) {
    throw new StoredResultRevisionConflict("Starttidsrättningen har flera beslut för samma revision");
  }
  if (new Set(punchStartCorrectionWithdrawalRows.map((row) => row.createdResultRevisionId)).size !== punchStartCorrectionWithdrawalRows.length) {
    throw new StoredResultRevisionConflict("Starttidsrättningens återtagande har flera journaler för samma revision");
  }
  if (new Set(correctionWithdrawalRows.map((row) => row.createdResultRevisionId)).size !== correctionWithdrawalRows.length) {
    throw new StoredResultRevisionConflict("Måltidsrättningens återtagande har flera journaler för samma revision");
  }
  const withdrawalCorrectionIds = correctionWithdrawalRows.map((row) => row.correctionId);
  const withdrawalCorrections = withdrawalCorrectionIds.length === 0 ? [] : await tx.select()
    .from(schema.manualFinishTimeCorrections).where(inArray(schema.manualFinishTimeCorrections.requestId, withdrawalCorrectionIds));
  const punchStartWithdrawalCorrectionIds = punchStartCorrectionWithdrawalRows.map((row) => row.correctionId);
  const punchStartWithdrawalCorrections = punchStartWithdrawalCorrectionIds.length === 0 ? [] : await tx.select()
    .from(schema.manualPunchStartTimeCorrections).where(inArray(schema.manualPunchStartTimeCorrections.requestId, punchStartWithdrawalCorrectionIds));
  const correctionSourceIds = [...correctionRows.map((row) => row.sourceResultRevisionId),
    ...punchStartCorrectionRows.map((row) => row.sourceResultRevisionId),
    ...punchStartWithdrawalCorrections.map((row) => row.sourceResultRevisionId)];
  const relatedRevisionIds = [...new Set([...correctionSourceIds,
    ...correctionWithdrawalRows.map((row) => row.sourceResultRevisionId),
    ...correctionWithdrawalRows.map((row) => row.correctedResultRevisionId),
    ...punchStartCorrectionWithdrawalRows.map((row) => row.sourceResultRevisionId),
    ...punchStartCorrectionWithdrawalRows.map((row) => row.correctedResultRevisionId)])];
  const correctionSources = relatedRevisionIds.length === 0 ? [] : await tx.select().from(schema.resultRevisions)
    .where(inArray(schema.resultRevisions.id, relatedRevisionIds));
  const sourceById = new Map(correctionSources.map((row) => [row.id, row]));
  const correctionByCreatedId = new Map(correctionRows.map((row) => [row.createdResultRevisionId, row]));
  const punchStartCorrectionByCreatedId = new Map(punchStartCorrectionRows.map((row) => [row.createdResultRevisionId, row]));
  const punchStartWithdrawalByCreatedId = new Map(punchStartCorrectionWithdrawalRows.map((row) => [row.createdResultRevisionId, row]));
  const punchStartWithdrawalCorrectionById = new Map(punchStartWithdrawalCorrections.map((row) => [row.requestId, row]));
  const withdrawalByCreatedId = new Map(correctionWithdrawalRows.map((row) => [row.createdResultRevisionId, row]));
  const withdrawalCorrectionById = new Map(withdrawalCorrections.map((row) => [row.requestId, row]));
  const punchStartReadoutIds = [...punchStartCorrectionRows, ...punchStartWithdrawalCorrections].map((row) => row.sourceReadoutId);
  const punchStartReadouts = punchStartReadoutIds.length === 0 ? [] : await tx.select({ id: schema.cardReadouts.id,
    startPunchedAt: schema.cardReadouts.startPunchedAt }).from(schema.cardReadouts)
    .where(inArray(schema.cardReadouts.id, punchStartReadoutIds));
  const punchStartReadoutById = new Map(punchStartReadouts.map((row) => [row.id, row]));
  const shortenedTransferItems = await tx.select().from(schema.shortenedCourseClassTransferItems).where(and(
    eq(schema.shortenedCourseClassTransferItems.raceId, raceId),
    inArray(schema.shortenedCourseClassTransferItems.createdResultRevisionId, selectedIds)
  ));
  if (new Set(shortenedTransferItems.map((row) => row.createdResultRevisionId)).size !== shortenedTransferItems.length) {
    throw new StoredResultRevisionConflict("Kortbaneöverflyttningen har flera item för samma revision");
  }
  const shortenedTransferIds = [...new Set(shortenedTransferItems.map((row) => row.requestId))];
  const shortenedTransfers = shortenedTransferIds.length === 0 ? [] : await tx.select()
    .from(schema.shortenedCourseClassTransfers).where(inArray(schema.shortenedCourseClassTransfers.requestId, shortenedTransferIds));
  if (shortenedTransfers.length !== shortenedTransferIds.length) {
    throw new StoredResultRevisionConflict("Kortbaneöverflyttningens huvud saknas");
  }
  const shortenedSourceIds = shortenedTransferItems.flatMap((row) => row.sourceResultRevisionId === null ? [] : [row.sourceResultRevisionId]);
  const shortenedSources = shortenedSourceIds.length === 0 ? [] : await tx.select().from(schema.resultRevisions)
    .where(inArray(schema.resultRevisions.id, shortenedSourceIds));
  const shortenedItemByCreatedId = new Map(shortenedTransferItems.map((row) => [row.createdResultRevisionId, row]));
  const shortenedTransferById = new Map(shortenedTransfers.map((row) => [row.requestId, row]));
  const shortenedSourceById = new Map(shortenedSources.map((row) => [row.id, row]));
  const [
    dnsWithdrawals,
    decisions,
    approvalDecisions,
    didNotFinishDecisions,
    notCompetingDecisions,
    withoutTimingDecisions
  ] = await Promise.all([
    tx.select().from(schema.didNotStartWithdrawals).where(and(
      eq(schema.didNotStartWithdrawals.raceId, raceId),
      inArray(schema.didNotStartWithdrawals.withdrawnResultRevisionId, selectedIds)
    )),
    tx.select().from(schema.resultDisqualificationDecisions).where(and(
      eq(schema.resultDisqualificationDecisions.raceId, raceId),
      inArray(schema.resultDisqualificationDecisions.entryId, entryIds)
    )).orderBy(
      desc(schema.resultDisqualificationDecisions.createdResultRevision),
      desc(schema.resultDisqualificationDecisions.id)
    ),
    tx.select().from(schema.resultApprovalDecisions).where(and(
      eq(schema.resultApprovalDecisions.raceId, raceId),
      inArray(schema.resultApprovalDecisions.entryId, entryIds)
    )).orderBy(
      desc(schema.resultApprovalDecisions.createdResultRevision),
      desc(schema.resultApprovalDecisions.id)
    ),
    tx.select().from(schema.didNotFinishDecisions).where(and(
      eq(schema.didNotFinishDecisions.raceId, raceId),
      inArray(schema.didNotFinishDecisions.entryId, entryIds)
    )).orderBy(
      desc(schema.didNotFinishDecisions.createdResultRevision),
      desc(schema.didNotFinishDecisions.id)
    ),
    tx.select().from(schema.notCompetingDecisions).where(and(
      eq(schema.notCompetingDecisions.raceId, raceId),
      inArray(schema.notCompetingDecisions.entryId, entryIds)
    )).orderBy(
      desc(schema.notCompetingDecisions.createdResultRevision),
      desc(schema.notCompetingDecisions.id)
    ),
    tx.select().from(schema.withoutTimingDecisions).where(and(
      eq(schema.withoutTimingDecisions.raceId, raceId),
      inArray(schema.withoutTimingDecisions.entryId, entryIds)
    )).orderBy(
      desc(schema.withoutTimingDecisions.createdResultRevision),
      desc(schema.withoutTimingDecisions.id)
    )
  ]);
  const dnsWithdrawalByRevisionId = new Map(dnsWithdrawals.map((row) => [row.withdrawnResultRevisionId, row]));
  if (dnsWithdrawalByRevisionId.size !== dnsWithdrawals.length) {
    throw new StoredResultRevisionConflict("Resultathuvudet har flera DNS-återtaganden");
  }

  const decisionIds = decisions.map((decision) => decision.id);
  const approvalDecisionIds = approvalDecisions.map((decision) => decision.id);
  const didNotFinishDecisionIds = didNotFinishDecisions.map((decision) => decision.id);
  const notCompetingDecisionIds = notCompetingDecisions.map((decision) => decision.id);
  const withoutTimingDecisionIds = withoutTimingDecisions.map((decision) => decision.id);
  const [
    disqualificationWithdrawals,
    approvalWithdrawals,
    didNotFinishWithdrawals,
    notCompetingWithdrawals,
    withoutTimingWithdrawals
  ] = await Promise.all([
    decisionIds.length === 0 ? Promise.resolve([]) : tx.select()
      .from(schema.resultDisqualificationWithdrawals)
      .where(inArray(schema.resultDisqualificationWithdrawals.disqualificationDecisionId, decisionIds)),
    approvalDecisionIds.length === 0 ? Promise.resolve([]) : tx.select()
      .from(schema.resultApprovalWithdrawals)
      .where(inArray(schema.resultApprovalWithdrawals.approvalDecisionId, approvalDecisionIds)),
    didNotFinishDecisionIds.length === 0 ? Promise.resolve([]) : tx.select()
      .from(schema.didNotFinishWithdrawals)
      .where(inArray(schema.didNotFinishWithdrawals.didNotFinishDecisionId, didNotFinishDecisionIds)),
    notCompetingDecisionIds.length === 0 ? Promise.resolve([]) : tx.select()
      .from(schema.notCompetingWithdrawals)
      .where(inArray(schema.notCompetingWithdrawals.notCompetingDecisionId, notCompetingDecisionIds)),
    withoutTimingDecisionIds.length === 0 ? Promise.resolve([]) : tx.select()
      .from(schema.withoutTimingWithdrawals)
      .where(inArray(schema.withoutTimingWithdrawals.withoutTimingDecisionId, withoutTimingDecisionIds))
  ]);
  const disqualificationWithdrawalByDecision = new Map(
    disqualificationWithdrawals.map((row) => [row.disqualificationDecisionId, row])
  );
  if (disqualificationWithdrawalByDecision.size !== disqualificationWithdrawals.length) {
    throw new StoredResultRevisionConflict("Diskvalifikationsbeslutet har flera återtaganden");
  }
  const approvalWithdrawalByDecision = new Map(approvalWithdrawals.map((row) => [row.approvalDecisionId, row]));
  if (approvalWithdrawalByDecision.size !== approvalWithdrawals.length) {
    throw new StoredResultRevisionConflict("Godkännandebeslutet har flera återtaganden");
  }
  const didNotFinishWithdrawalByDecision = new Map(
    didNotFinishWithdrawals.map((row) => [row.didNotFinishDecisionId, row])
  );
  if (didNotFinishWithdrawalByDecision.size !== didNotFinishWithdrawals.length) {
    throw new StoredResultRevisionConflict("DNF-beslutet har flera återtaganden");
  }
  const notCompetingWithdrawalByDecision = new Map(
    notCompetingWithdrawals.map((row) => [row.notCompetingDecisionId, row])
  );
  if (notCompetingWithdrawalByDecision.size !== notCompetingWithdrawals.length) {
    throw new StoredResultRevisionConflict("OOC-beslutet har flera återtaganden");
  }
  const withoutTimingWithdrawalByDecision = new Map(
    withoutTimingWithdrawals.map((row) => [row.withoutTimingDecisionId, row])
  );
  if (withoutTimingWithdrawalByDecision.size !== withoutTimingWithdrawals.length) {
    throw new StoredResultRevisionConflict("NT-beslutet har flera återtaganden");
  }
  const revisionIds = [
    ...decisions.flatMap((decision) => {
    const withdrawal = disqualificationWithdrawalByDecision.get(decision.id);
    return [
      decision.targetResultRevisionId,
      decision.createdResultRevisionId,
      ...(withdrawal ? [withdrawal.restoredFromResultRevisionId, withdrawal.createdResultRevisionId] : [])
    ];
    }),
    ...approvalDecisions.flatMap((decision) => {
      const withdrawal = approvalWithdrawalByDecision.get(decision.id);
      return [
        decision.targetResultRevisionId,
        decision.createdResultRevisionId,
        ...(withdrawal ? [
          withdrawal.expectedLatestResultRevisionId,
          withdrawal.restoredFromResultRevisionId,
          withdrawal.createdResultRevisionId
        ] : [])
      ];
    }),
    ...didNotFinishDecisions.flatMap((decision) => {
      const withdrawal = didNotFinishWithdrawalByDecision.get(decision.id);
      return [
        decision.targetResultRevisionId,
        decision.createdResultRevisionId,
        ...(withdrawal ? [
          withdrawal.expectedLatestResultRevisionId,
          withdrawal.restoredFromResultRevisionId,
          withdrawal.createdResultRevisionId
        ] : [])
      ];
    }),
    ...notCompetingDecisions.flatMap((decision) => {
      const withdrawal = notCompetingWithdrawalByDecision.get(decision.id);
      return [
        decision.targetResultRevisionId,
        decision.createdResultRevisionId,
        ...(withdrawal ? [
          withdrawal.expectedLatestResultRevisionId,
          withdrawal.restoredFromResultRevisionId,
          withdrawal.createdResultRevisionId
        ] : [])
      ];
    }),
    ...withoutTimingDecisions.flatMap((decision) => {
      const withdrawal = withoutTimingWithdrawalByDecision.get(decision.id);
      return [
        decision.targetResultRevisionId,
        decision.createdResultRevisionId,
        ...(withdrawal ? [
          withdrawal.expectedLatestResultRevisionId,
          withdrawal.restoredFromResultRevisionId,
          withdrawal.createdResultRevisionId
        ] : [])
      ];
    })
  ];
  const revisions = revisionIds.length === 0 ? [] : await tx.select().from(schema.resultRevisions)
    .where(inArray(schema.resultRevisions.id, revisionIds));
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  const disqualificationStatesByEntry = new Map<string, StoredResultDisqualificationState[]>();
  for (const decision of decisions) {
    const target = revisionById.get(decision.targetResultRevisionId);
    const disqualified = revisionById.get(decision.createdResultRevisionId);
    if (!target || !disqualified) {
      throw new StoredResultRevisionConflict("Diskvalifikationens target eller DSQ-revision saknas");
    }
    validateStoredDisqualification(decision, target, disqualified);
    const withdrawal = disqualificationWithdrawalByDecision.get(decision.id) ?? null;
    let restorationSource: Revision | null = null;
    let restoration: Revision | null = null;
    if (withdrawal !== null) {
      restorationSource = revisionById.get(withdrawal.restoredFromResultRevisionId) ?? null;
      restoration = revisionById.get(withdrawal.createdResultRevisionId) ?? null;
      if (!restorationSource || !restoration) {
        throw new StoredResultRevisionConflict("Diskvalifikationsåtertagandets revisionskedja saknas");
      }
      validateStoredDisqualificationWithdrawal(withdrawal, decision, restorationSource, restoration);
    }
    const state = {
      decision,
      target,
      disqualified,
      withdrawal,
      restorationSource,
      restoration
    };
    const states = disqualificationStatesByEntry.get(decision.entryId) ?? [];
    states.push(state);
    disqualificationStatesByEntry.set(decision.entryId, states);
  }
  const approvalStatesByEntry = new Map<string, StoredResultApprovalState[]>();
  for (const decision of approvalDecisions) {
    const target = revisionById.get(decision.targetResultRevisionId);
    const approved = revisionById.get(decision.createdResultRevisionId);
    if (!target || !approved) {
      throw new StoredResultRevisionConflict("Godkännandets target eller approval-revision saknas");
    }
    validateStoredApproval(decision, target, approved);
    const withdrawal = approvalWithdrawalByDecision.get(decision.id) ?? null;
    let restorationSource: Revision | null = null;
    let restoration: Revision | null = null;
    if (withdrawal !== null) {
      restorationSource = revisionById.get(withdrawal.restoredFromResultRevisionId) ?? null;
      restoration = revisionById.get(withdrawal.createdResultRevisionId) ?? null;
      if (!restorationSource || !restoration) {
        throw new StoredResultRevisionConflict("Godkännandeåtertagandets revisionskedja saknas");
      }
      const expectedLatest = revisionById.get(withdrawal.expectedLatestResultRevisionId);
      if (!expectedLatest || expectedLatest.revision !== withdrawal.expectedLatestResultRevision ||
          expectedLatest.raceId !== decision.raceId || expectedLatest.entryId !== decision.entryId) {
        throw new StoredResultRevisionConflict("Godkännandeåtertagandets observerade huvud motsäger revisionskedjan");
      }
      validateStoredApprovalWithdrawal(withdrawal, decision, expectedLatest, restorationSource, restoration);
    }
    const state = {
      decision,
      target,
      approved,
      withdrawal,
      restorationSource,
      restoration
    };
    const states = approvalStatesByEntry.get(decision.entryId) ?? [];
    states.push(state);
    approvalStatesByEntry.set(decision.entryId, states);
  }

  const disqualificationByEntry = new Map<string, StoredResultDisqualificationState>();
  for (const [entryId, states] of disqualificationStatesByEntry) {
    const active = states.filter((state) => state.withdrawal === null);
    if (active.length > 1) {
      throw new StoredResultRevisionConflict("Deltagaren har flera aktiva diskvalifikationsbeslut");
    }
    const selected = active[0] ?? states[0];
    if (selected) disqualificationByEntry.set(entryId, selected);
  }
  const approvalByEntry = new Map<string, StoredResultApprovalState>();
  for (const [entryId, states] of approvalStatesByEntry) {
    const active = states.filter((state) => state.withdrawal === null);
    if (active.length > 1) {
      throw new StoredResultRevisionConflict("Deltagaren har flera aktiva godkännandebeslut");
    }
    const selected = active[0] ?? states[0];
    if (selected) approvalByEntry.set(entryId, selected);
  }

  const didNotFinishStatesByEntry = new Map<string, StoredDidNotFinishState[]>();
  for (const decision of didNotFinishDecisions) {
    const target = revisionById.get(decision.targetResultRevisionId);
    const didNotFinish = revisionById.get(decision.createdResultRevisionId);
    if (!target || !didNotFinish) {
      throw new StoredResultRevisionConflict("DNF-beslutets target eller DNF-revision saknas");
    }
    validateStoredDidNotFinish(decision, target, didNotFinish);
    const withdrawal = didNotFinishWithdrawalByDecision.get(decision.id) ?? null;
    let expectedLatest: Revision | null = null;
    let restorationSource: Revision | null = null;
    let restoration: Revision | null = null;
    if (withdrawal !== null) {
      expectedLatest = revisionById.get(withdrawal.expectedLatestResultRevisionId) ?? null;
      restorationSource = revisionById.get(withdrawal.restoredFromResultRevisionId) ?? null;
      restoration = revisionById.get(withdrawal.createdResultRevisionId) ?? null;
      if (!expectedLatest || !restorationSource || !restoration) {
        throw new StoredResultRevisionConflict("DNF-återtagandets revisionskedja saknas");
      }
      validateStoredDidNotFinishWithdrawal(
        withdrawal,
        decision,
        target,
        didNotFinish,
        expectedLatest,
        restorationSource,
        restoration
      );
    }
    const states = didNotFinishStatesByEntry.get(decision.entryId) ?? [];
    states.push({ decision, target, didNotFinish, withdrawal, expectedLatest, restorationSource, restoration });
    didNotFinishStatesByEntry.set(decision.entryId, states);
  }
  const didNotFinishByEntry = new Map<string, StoredDidNotFinishState>();
  for (const [entryId, states] of didNotFinishStatesByEntry) {
    const active = states.filter((state) => state.withdrawal === null);
    if (active.length > 1) {
      throw new StoredResultRevisionConflict("Deltagaren har flera aktiva DNF-beslut");
    }
    if (active.length === 1 && active[0] !== states[0]) {
      throw new StoredResultRevisionConflict("Ett äldre DNF-beslut är aktivt efter en senare DNF-livscykel");
    }
    const selected = active[0] ?? states[0];
    if (selected) didNotFinishByEntry.set(entryId, selected);
  }

  const notCompetingStatesByEntry = new Map<string, StoredOutOfCompetitionState[]>();
  for (const decision of notCompetingDecisions) {
    const target = revisionById.get(decision.targetResultRevisionId);
    const outOfCompetition = revisionById.get(decision.createdResultRevisionId);
    if (!target || !outOfCompetition) {
      throw new StoredResultRevisionConflict("OOC-beslutets target eller OOC-revision saknas");
    }
    validateStoredOutOfCompetition(decision, target, outOfCompetition);
    const withdrawal = notCompetingWithdrawalByDecision.get(decision.id) ?? null;
    let expectedLatest: Revision | null = null;
    let restorationSource: Revision | null = null;
    let restoration: Revision | null = null;
    if (withdrawal !== null) {
      expectedLatest = revisionById.get(withdrawal.expectedLatestResultRevisionId) ?? null;
      restorationSource = revisionById.get(withdrawal.restoredFromResultRevisionId) ?? null;
      restoration = revisionById.get(withdrawal.createdResultRevisionId) ?? null;
      if (!expectedLatest || !restorationSource || !restoration) {
        throw new StoredResultRevisionConflict("OOC-återtagandets revisionskedja saknas");
      }
      validateStoredOutOfCompetitionWithdrawal(
        withdrawal,
        decision,
        target,
        outOfCompetition,
        expectedLatest,
        restorationSource,
        restoration
      );
    }
    const states = notCompetingStatesByEntry.get(decision.entryId) ?? [];
    states.push({ decision, target, outOfCompetition, withdrawal, expectedLatest, restorationSource, restoration });
    notCompetingStatesByEntry.set(decision.entryId, states);
  }
  const notCompetingByEntry = new Map<string, StoredOutOfCompetitionState>();
  for (const [entryId, states] of notCompetingStatesByEntry) {
    const active = states.filter((state) => state.withdrawal === null);
    if (active.length > 1) {
      throw new StoredResultRevisionConflict("Deltagaren har flera aktiva OOC-beslut");
    }
    if (active.length === 1 && active[0] !== states[0]) {
      throw new StoredResultRevisionConflict("Ett äldre OOC-beslut är aktivt efter en senare OOC-livscykel");
    }
    const selected = active[0] ?? states[0];
    if (selected) notCompetingByEntry.set(entryId, selected);
  }

  const withoutTimingStatesByEntry = new Map<string, StoredWithoutTimingState[]>();
  for (const decision of withoutTimingDecisions) {
    const target = revisionById.get(decision.targetResultRevisionId);
    const withoutTiming = revisionById.get(decision.createdResultRevisionId);
    if (!target || !withoutTiming) {
      throw new StoredResultRevisionConflict("Utan-tidtagning-beslutets target eller NT-revision saknas");
    }
    validateStoredWithoutTiming(decision, target, withoutTiming);
    const withdrawal = withoutTimingWithdrawalByDecision.get(decision.id) ?? null;
    let expectedLatest: Revision | null = null;
    let restorationSource: Revision | null = null;
    let restoration: Revision | null = null;
    if (withdrawal !== null) {
      expectedLatest = revisionById.get(withdrawal.expectedLatestResultRevisionId) ?? null;
      restorationSource = revisionById.get(withdrawal.restoredFromResultRevisionId) ?? null;
      restoration = revisionById.get(withdrawal.createdResultRevisionId) ?? null;
      if (!expectedLatest || !restorationSource || !restoration) {
        throw new StoredResultRevisionConflict("NT-återtagandets revisionskedja saknas");
      }
      validateStoredWithoutTimingWithdrawal(
        withdrawal,
        decision,
        target,
        withoutTiming,
        expectedLatest,
        restorationSource,
        restoration
      );
    }
    const states = withoutTimingStatesByEntry.get(decision.entryId) ?? [];
    states.push({ decision, target, withoutTiming, withdrawal, expectedLatest, restorationSource, restoration });
    withoutTimingStatesByEntry.set(decision.entryId, states);
  }
  const withoutTimingByEntry = new Map<string, StoredWithoutTimingState>();
  for (const [entryId, states] of withoutTimingStatesByEntry) {
    const active = states.filter((state) => state.withdrawal === null);
    if (active.length > 1) {
      throw new StoredResultRevisionConflict("Deltagaren har flera aktiva utan-tidtagning-beslut");
    }
    if (active.length === 1 && active[0] !== states[0]) {
      throw new StoredResultRevisionConflict("Ett äldre NT-beslut är aktivt efter en senare NT-livscykel");
    }
    const selected = active[0] ?? states[0];
    if (selected) withoutTimingByEntry.set(entryId, selected);
  }

  for (const entryId of entryIds) {
    const disqualification = disqualificationByEntry.get(entryId);
    const approval = approvalByEntry.get(entryId);
    const didNotFinish = didNotFinishByEntry.get(entryId);
    const notCompeting = notCompetingByEntry.get(entryId);
    const withoutTiming = withoutTimingByEntry.get(entryId);
    const activeCount = Number(disqualification?.withdrawal === null) +
      Number(approval?.withdrawal === null) + Number(didNotFinish?.withdrawal === null) +
      Number(notCompeting?.withdrawal === null) + Number(withoutTiming?.withdrawal === null);
    if (activeCount > 1) {
      throw new StoredResultRevisionConflict("Aktiva manuella resultat får inte samexistera");
    }
  }

  return selectedHeads.map((selectedHead) => {
    if (selectedHead.manualFinishTimeCorrectionId !== null && selectedHead.manualFinishTimeCorrectionId !== undefined &&
        !correctionByCreatedId.has(selectedHead.id)) {
      throw new StoredResultRevisionConflict("Valt måltidsrättat resultathuvud saknar journalbevis");
    }
    if (selectedHead.manualFinishTimeCorrectionWithdrawalId !== null && selectedHead.manualFinishTimeCorrectionWithdrawalId !== undefined &&
        !withdrawalByCreatedId.has(selectedHead.id)) {
      throw new StoredResultRevisionConflict("Valt återtaget måltidsrättat resultathuvud saknar journalbevis");
    }
    if (selectedHead.manualPunchStartTimeCorrectionId !== null && selectedHead.manualPunchStartTimeCorrectionId !== undefined &&
        !punchStartCorrectionByCreatedId.has(selectedHead.id)) {
      throw new StoredResultRevisionConflict("Valt starttidsrättat resultathuvud saknar journalbevis");
    }
    if (selectedHead.manualPunchStartTimeCorrectionWithdrawalId !== null && selectedHead.manualPunchStartTimeCorrectionWithdrawalId !== undefined &&
        !punchStartWithdrawalByCreatedId.has(selectedHead.id)) {
      throw new StoredResultRevisionConflict("Valt återtaget starttidsrättat resultathuvud saknar journalbevis");
    }
    if (selectedHead.shortenedCourseClassTransferId !== null && selectedHead.shortenedCourseClassTransferId !== undefined &&
        !shortenedItemByCreatedId.has(selectedHead.id)) {
      throw new StoredResultRevisionConflict("Valt kortbaneresultat saknar item-bevis");
    }
    const checkinDns = checkinDnsByResult.get(selectedHead.id) ?? null;
    if (selectedHead.startCheckinDnsDecisionId !== null || checkinDns !== null) {
      if (checkinDns === null || selectedHead.startCheckinDnsDecisionId !== checkinDns.source.decision.id ||
        selectedHead.entryId !== checkinDns.source.result.entryId || selectedHead.revision !== checkinDns.source.result.revision) {
        throw new StoredResultRevisionConflict("Valt avpricknings-DNS saknar matchande källa");
      }
      if (disqualificationByEntry.get(selectedHead.entryId)?.withdrawal === null ||
        approvalByEntry.get(selectedHead.entryId)?.withdrawal === null ||
        didNotFinishByEntry.get(selectedHead.entryId)?.withdrawal === null ||
        notCompetingByEntry.get(selectedHead.entryId)?.withdrawal === null ||
        withoutTimingByEntry.get(selectedHead.entryId)?.withdrawal === null) {
        throw new StoredResultRevisionConflict("Avpricknings-DNS får inte samexistera med aktiv manuell overlay");
      }
      // Reuse the pure exact-target DNS rule, not the old manual journal.
      const checkinResolution = resolveDidNotStartWithdrawalResultHead({
        resultRevisionId: selectedHead.id, didNotStartDecisionId: checkinDns.source.decision.id, value: selectedHead
      }, checkinDns.correction === null ? null : {
        id: checkinDns.correction.withdrawal.id,
        didNotStartDecisionId: checkinDns.correction.withdrawal.startCheckinDnsDecisionId,
        withdrawnResultRevisionId: checkinDns.correction.withdrawal.withdrawnResultRevisionId
      });
      if (checkinResolution.state === "NO_ACTIVE_RESULT" && checkinDns.correction !== null) return {
        state: "NO_ACTIVE_RESULT", head: selectedHead, selectedHead,
        withdrawal: checkinDns.correction.withdrawal, startCheckinDns: checkinDns,
        disqualification: null, approval: null, didNotFinish: null, notCompeting: null, withoutTiming: null, finishTimeCorrection: null, finishTimeCorrectionWithdrawal: null, punchStartTimeCorrection: null, punchStartTimeCorrectionWithdrawal: null, shortenedCourseClassTransfer: null
      };
    }
    const dnsWithdrawal = dnsWithdrawalByRevisionId.get(selectedHead.id);
    const dnsResolution = resolveDidNotStartWithdrawalResultHead(
      {
        resultRevisionId: selectedHead.id,
        didNotStartDecisionId: selectedHead.didNotStartDecisionId,
        value: selectedHead
      },
      dnsWithdrawal === undefined ? null : {
        id: dnsWithdrawal.id,
        didNotStartDecisionId: dnsWithdrawal.didNotStartDecisionId,
        withdrawnResultRevisionId: dnsWithdrawal.withdrawnResultRevisionId
      }
    );
    if (dnsResolution.state === "NO_ACTIVE_RESULT") {
      if (!dnsWithdrawal) throw new StoredResultRevisionConflict("Domänresolven saknar lagrat DNS-återtagande");
      return {
        state: "NO_ACTIVE_RESULT",
        head: selectedHead,
        selectedHead,
        withdrawal: dnsWithdrawal,
        disqualification: null,
        approval: null,
        didNotFinish: null,
        notCompeting: null,
        withoutTiming: null,
        finishTimeCorrection: null,
        finishTimeCorrectionWithdrawal: null,
        punchStartTimeCorrection: null
        , punchStartTimeCorrectionWithdrawal: null, shortenedCourseClassTransfer: null
      };
    }

    const lifecycle = disqualificationByEntry.get(selectedHead.entryId) ?? null;
    const approvalLifecycleForMutex = approvalByEntry.get(selectedHead.entryId) ?? null;
    const didNotFinishLifecycleForMutex = didNotFinishByEntry.get(selectedHead.entryId) ?? null;
    const notCompetingLifecycleForMutex = notCompetingByEntry.get(selectedHead.entryId) ?? null;
    const withoutTimingLifecycleForMutex = withoutTimingByEntry.get(selectedHead.entryId) ?? null;
    if (selectedHead.didNotStartDecisionId !== null && dnsWithdrawal === undefined &&
        (lifecycle?.withdrawal === null || approvalLifecycleForMutex?.withdrawal === null ||
         didNotFinishLifecycleForMutex?.withdrawal === null ||
         notCompetingLifecycleForMutex?.withdrawal === null ||
         withoutTimingLifecycleForMutex?.withdrawal === null)) {
      throw new StoredResultRevisionConflict("Aktivt DNS får inte samexistera med en annan manuell resultat-overlay");
    }
    let normalHead = selectedHead;
    if (lifecycle !== null && lifecycle.withdrawal === null && selectedHead.id === lifecycle.disqualified.id) {
      normalHead = withRevision(selectedHead, lifecycle.target);
    }
    const resolution = resolveManualDisqualificationResultHead(
      { resultRevisionId: normalHead.id, revision: normalHead.revision, value: normalHead },
      lifecycle === null ? null : {
        id: lifecycle.decision.id,
        targetResultRevisionId: lifecycle.target.id,
        disqualifiedResultHead: {
          resultRevisionId: lifecycle.disqualified.id,
          revision: lifecycle.disqualified.revision,
          value: withRevision(selectedHead, lifecycle.disqualified)
        },
        withdrawal: lifecycle.withdrawal === null ? null : {
          id: lifecycle.withdrawal.id,
          resultDisqualificationDecisionId: lifecycle.withdrawal.disqualificationDecisionId,
          disqualifiedResultRevisionId: lifecycle.withdrawal.withdrawnResultRevisionId,
          restorationResultRevisionId: lifecycle.withdrawal.createdResultRevisionId,
          restorationResultRevision: lifecycle.withdrawal.createdResultRevision
        }
      }
    );
    if (resolution.state !== "ACTIVE_RESULT") {
      throw new StoredResultRevisionConflict("Diskvalifikationsresolven saknar aktivt resultathuvud");
    }
    const approvalLifecycle = approvalByEntry.get(selectedHead.entryId) ?? null;
    const approvalResolution = resolveManualResultApprovalResultHead(
      { resultRevisionId: resolution.resultHead.value.id, revision: resolution.resultHead.value.revision, value: resolution.resultHead.value },
      approvalLifecycle === null ? null : {
        id: approvalLifecycle.decision.id,
        targetResultRevisionId: approvalLifecycle.target.id,
        approvedResultHead: {
          resultRevisionId: approvalLifecycle.approved.id,
          revision: approvalLifecycle.approved.revision,
          value: withRevision(selectedHead, approvalLifecycle.approved)
        },
        withdrawal: approvalLifecycle.withdrawal === null ? null : {
          id: approvalLifecycle.withdrawal.id,
          resultApprovalDecisionId: approvalLifecycle.withdrawal.approvalDecisionId,
          approvedResultRevisionId: approvalLifecycle.withdrawal.withdrawnResultRevisionId,
          restorationResultRevisionId: approvalLifecycle.withdrawal.createdResultRevisionId,
          restorationResultRevision: approvalLifecycle.withdrawal.createdResultRevision
        }
      }
    );
    if (approvalResolution.state !== "ACTIVE_RESULT") {
      throw new StoredResultRevisionConflict("Godkännanderesolven saknar aktivt resultathuvud");
    }
    const didNotFinishLifecycle = didNotFinishByEntry.get(selectedHead.entryId) ?? null;
    let dnfUnderlyingHead = approvalResolution.resultHead.value;
    if (didNotFinishLifecycle !== null && selectedHead.id === didNotFinishLifecycle.didNotFinish.id) {
      dnfUnderlyingHead = withRevision(selectedHead, didNotFinishLifecycle.target);
    }
    const didNotFinishResolution = resolveManualDidNotFinishResultHead(
      {
        resultRevisionId: dnfUnderlyingHead.id,
        revision: dnfUnderlyingHead.revision,
        value: dnfUnderlyingHead
      },
      didNotFinishLifecycle === null ? null : {
        id: didNotFinishLifecycle.decision.id,
        targetResultRevisionId: didNotFinishLifecycle.target.id,
        targetResultRevision: didNotFinishLifecycle.target.revision,
        didNotFinishResultRevisionId: didNotFinishLifecycle.didNotFinish.id,
        didNotFinishResultRevision: didNotFinishLifecycle.didNotFinish.revision,
        didNotFinishResultHead: {
          resultRevisionId: didNotFinishLifecycle.didNotFinish.id,
          revision: didNotFinishLifecycle.didNotFinish.revision,
          didNotFinishDecisionId: didNotFinishLifecycle.decision.id,
          value: withRevision(selectedHead, didNotFinishLifecycle.didNotFinish)
        },
        withdrawal: didNotFinishLifecycle.withdrawal === null ? null : {
          id: didNotFinishLifecycle.withdrawal.id,
          didNotFinishDecisionId: didNotFinishLifecycle.withdrawal.didNotFinishDecisionId,
          withdrawnResultRevisionId: didNotFinishLifecycle.withdrawal.withdrawnResultRevisionId,
          withdrawnResultRevision: didNotFinishLifecycle.withdrawal.withdrawnResultRevision,
          expectedLatestResultRevisionId: didNotFinishLifecycle.withdrawal.expectedLatestResultRevisionId,
          expectedLatestResultRevision: didNotFinishLifecycle.withdrawal.expectedLatestResultRevision,
          restorationSourceResultRevisionId: didNotFinishLifecycle.withdrawal.restoredFromResultRevisionId,
          restorationSourceResultRevision: didNotFinishLifecycle.withdrawal.restoredFromResultRevision,
          restorationResultRevisionId: didNotFinishLifecycle.withdrawal.createdResultRevisionId,
          restorationResultRevision: didNotFinishLifecycle.withdrawal.createdResultRevision,
          restorationResultHead: {
            resultRevisionId: didNotFinishLifecycle.restoration!.id,
            revision: didNotFinishLifecycle.restoration!.revision,
            didNotFinishWithdrawalId: didNotFinishLifecycle.withdrawal.id,
            value: withRevision(selectedHead, didNotFinishLifecycle.restoration!)
          }
        }
      }
    );
    if (didNotFinishResolution.state !== "ACTIVE_RESULT") {
      throw new StoredResultRevisionConflict("DNF-resolven saknar aktivt resultathuvud");
    }
    const notCompetingLifecycle = notCompetingByEntry.get(selectedHead.entryId) ?? null;
    const outOfCompetitionResolution = resolveManualOutOfCompetitionResultHead(
      {
        resultRevisionId: didNotFinishResolution.resultHead.value.id,
        revision: didNotFinishResolution.resultHead.value.revision,
        value: didNotFinishResolution.resultHead.value
      },
      notCompetingLifecycle === null ? null : {
        id: notCompetingLifecycle.decision.id,
        targetResultRevisionId: notCompetingLifecycle.target.id,
        targetResultRevision: notCompetingLifecycle.target.revision,
        outOfCompetitionResultRevisionId: notCompetingLifecycle.outOfCompetition.id,
        outOfCompetitionResultRevision: notCompetingLifecycle.outOfCompetition.revision,
        outOfCompetitionResultHead: {
          resultRevisionId: notCompetingLifecycle.outOfCompetition.id,
          revision: notCompetingLifecycle.outOfCompetition.revision,
          notCompetingDecisionId: notCompetingLifecycle.decision.id,
          value: withRevision(selectedHead, notCompetingLifecycle.outOfCompetition)
        },
        withdrawal: notCompetingLifecycle.withdrawal === null ? null : {
          id: notCompetingLifecycle.withdrawal.id,
          notCompetingDecisionId: notCompetingLifecycle.withdrawal.notCompetingDecisionId,
          withdrawnResultRevisionId: notCompetingLifecycle.withdrawal.withdrawnResultRevisionId,
          withdrawnResultRevision: notCompetingLifecycle.withdrawal.withdrawnResultRevision,
          expectedLatestResultRevisionId: notCompetingLifecycle.withdrawal.expectedLatestResultRevisionId,
          expectedLatestResultRevision: notCompetingLifecycle.withdrawal.expectedLatestResultRevision,
          restorationSourceResultRevisionId: notCompetingLifecycle.withdrawal.restoredFromResultRevisionId,
          restorationSourceResultRevision: notCompetingLifecycle.withdrawal.restoredFromResultRevision,
          restorationResultRevisionId: notCompetingLifecycle.withdrawal.createdResultRevisionId,
          restorationResultRevision: notCompetingLifecycle.withdrawal.createdResultRevision,
          restorationResultHead: {
            resultRevisionId: notCompetingLifecycle.restoration!.id,
            revision: notCompetingLifecycle.restoration!.revision,
            notCompetingWithdrawalId: notCompetingLifecycle.withdrawal.id,
            value: withRevision(selectedHead, notCompetingLifecycle.restoration!)
          }
        }
      }
    );
    if (outOfCompetitionResolution.state !== "ACTIVE_RESULT") {
      throw new StoredResultRevisionConflict("OOC-resolven saknar aktivt resultathuvud");
    }
    const withoutTimingLifecycle = withoutTimingByEntry.get(selectedHead.entryId) ?? null;
    const withoutTimingResolution = resolveManualWithoutTimingResultHead(
      {
        resultRevisionId: outOfCompetitionResolution.resultHead.value.id,
        revision: outOfCompetitionResolution.resultHead.value.revision,
        value: outOfCompetitionResolution.resultHead.value
      },
      withoutTimingLifecycle === null ? null : {
        id: withoutTimingLifecycle.decision.id,
        targetResultRevisionId: withoutTimingLifecycle.target.id,
        targetResultRevision: withoutTimingLifecycle.target.revision,
        withoutTimingResultRevisionId: withoutTimingLifecycle.withoutTiming.id,
        withoutTimingResultRevision: withoutTimingLifecycle.withoutTiming.revision,
        withoutTimingResultHead: {
          resultRevisionId: withoutTimingLifecycle.withoutTiming.id,
          revision: withoutTimingLifecycle.withoutTiming.revision,
          withoutTimingDecisionId: withoutTimingLifecycle.decision.id,
          value: withRevision(selectedHead, withoutTimingLifecycle.withoutTiming)
        },
        withdrawal: withoutTimingLifecycle.withdrawal === null ? null : {
          id: withoutTimingLifecycle.withdrawal.id,
          withoutTimingDecisionId: withoutTimingLifecycle.withdrawal.withoutTimingDecisionId,
          withdrawnResultRevisionId: withoutTimingLifecycle.withdrawal.withdrawnResultRevisionId,
          withdrawnResultRevision: withoutTimingLifecycle.withdrawal.withdrawnResultRevision,
          expectedLatestResultRevisionId: withoutTimingLifecycle.withdrawal.expectedLatestResultRevisionId,
          expectedLatestResultRevision: withoutTimingLifecycle.withdrawal.expectedLatestResultRevision,
          restorationSourceResultRevisionId: withoutTimingLifecycle.withdrawal.restoredFromResultRevisionId,
          restorationSourceResultRevision: withoutTimingLifecycle.withdrawal.restoredFromResultRevision,
          restorationResultRevisionId: withoutTimingLifecycle.withdrawal.createdResultRevisionId,
          restorationResultRevision: withoutTimingLifecycle.withdrawal.createdResultRevision,
          restorationResultHead: {
            resultRevisionId: withoutTimingLifecycle.restoration!.id,
            revision: withoutTimingLifecycle.restoration!.revision,
            withoutTimingWithdrawalId: withoutTimingLifecycle.withdrawal.id,
            value: withRevision(selectedHead, withoutTimingLifecycle.restoration!)
          }
        }
      }
    );
    if (withoutTimingResolution.state !== "ACTIVE_RESULT") {
      throw new StoredResultRevisionConflict("Utan-tidtagning-resolven saknar aktivt resultathuvud");
    }
    const correction = correctionByCreatedId.get(selectedHead.id) ?? null;
    const finishTimeCorrection = correction === null ? null : {
      correction,
      source: sourceById.get(correction.sourceResultRevisionId),
      corrected: selectedHead
    };
    let correctionProof: StoredManualFinishTimeCorrectionProof | null = null;
    if (finishTimeCorrection !== null) {
      if (finishTimeCorrection.source === undefined) {
        throw new StoredResultRevisionConflict("Måltidsrättningens källrevision saknas");
      }
      correctionProof = {
        correction: finishTimeCorrection.correction,
        source: finishTimeCorrection.source,
        corrected: finishTimeCorrection.corrected as unknown as typeof schema.resultRevisions.$inferSelect
      };
    }
    if (correctionProof !== null) validateStoredManualFinishTimeCorrection(correctionProof);
    const correctionWithdrawal = withdrawalByCreatedId.get(selectedHead.id) ?? null;
    let correctionWithdrawalProof: StoredManualFinishTimeCorrectionWithdrawalProof | null = null;
    if (correctionWithdrawal !== null) {
      const correction = withdrawalCorrectionById.get(correctionWithdrawal.correctionId);
      const source = sourceById.get(correctionWithdrawal.sourceResultRevisionId);
      const corrected = sourceById.get(correctionWithdrawal.correctedResultRevisionId);
      if (!correction || !source || !corrected) throw new StoredResultRevisionConflict("Måltidsrättningens återtagandekedja saknas");
      correctionWithdrawalProof = {
        withdrawal: correctionWithdrawal, correction, source, corrected,
        restored: selectedHead as unknown as Revision
      };
      validateStoredManualFinishTimeCorrectionWithdrawal(correctionWithdrawalProof);
    }
    const punchStartCorrection = punchStartCorrectionByCreatedId.get(selectedHead.id) ?? null;
    let punchStartTimeCorrectionProof: StoredManualPunchStartTimeCorrectionProof | null = null;
    if (punchStartCorrection !== null) {
      const source = sourceById.get(punchStartCorrection.sourceResultRevisionId);
      const readout = punchStartReadoutById.get(punchStartCorrection.sourceReadoutId);
      if (!source || !readout?.startPunchedAt) {
        throw new StoredResultRevisionConflict("Starttidsrättningens källa eller observerade start saknas");
      }
      punchStartTimeCorrectionProof = { correction: punchStartCorrection, source,
        sourceStartPunchedAt: readout.startPunchedAt, corrected: selectedHead as unknown as Revision };
      validateStoredManualPunchStartTimeCorrection(punchStartTimeCorrectionProof);
    }
    const punchStartWithdrawal = punchStartWithdrawalByCreatedId.get(selectedHead.id) ?? null;
    let punchStartTimeCorrectionWithdrawalProof: StoredManualPunchStartTimeCorrectionWithdrawalProof | null = null;
    if (punchStartWithdrawal !== null) {
      const correction = punchStartWithdrawalCorrectionById.get(punchStartWithdrawal.correctionId);
      const source = sourceById.get(punchStartWithdrawal.sourceResultRevisionId);
      const corrected = sourceById.get(punchStartWithdrawal.correctedResultRevisionId);
      const readout = correction === undefined ? undefined : punchStartReadoutById.get(correction.sourceReadoutId);
      if (!correction || !source || !corrected || !readout?.startPunchedAt) {
        throw new StoredResultRevisionConflict("Starttidsrättningens återtagandekedja saknas");
      }
      punchStartTimeCorrectionWithdrawalProof = { withdrawal: punchStartWithdrawal, correction, source,
        sourceStartPunchedAt: readout.startPunchedAt, corrected, restored: selectedHead as unknown as Revision };
      validateStoredManualPunchStartTimeCorrectionWithdrawal(punchStartTimeCorrectionWithdrawalProof);
    }
    const shortenedItem = shortenedItemByCreatedId.get(selectedHead.id) ?? null;
    let shortenedCourseClassTransferProof: StoredShortenedCourseClassTransferProof | null = null;
    if (shortenedItem !== null) {
      const transfer = shortenedTransferById.get(shortenedItem.requestId);
      const source = shortenedItem.sourceResultRevisionId === null ? undefined : shortenedSourceById.get(shortenedItem.sourceResultRevisionId);
      if (!transfer || !source) {
        throw new StoredResultRevisionConflict("Kortbaneöverflyttningens källa eller huvud saknas");
      }
      shortenedCourseClassTransferProof = { transfer, item: shortenedItem, source,
        created: selectedHead as unknown as Revision };
      validateStoredShortenedCourseClassTransfer(shortenedCourseClassTransferProof);
    }
    return {
      state: "ACTIVE_RESULT",
      head: withoutTimingResolution.resultHead.value,
      startCheckinDns: checkinDns,
      selectedHead,
      withdrawal: null,
      disqualification: lifecycle,
      approval: approvalLifecycle,
      didNotFinish: didNotFinishLifecycle,
      notCompeting: notCompetingLifecycle,
      withoutTiming: withoutTimingLifecycle,
      finishTimeCorrection: correctionProof,
      finishTimeCorrectionWithdrawal: correctionWithdrawalProof,
      punchStartTimeCorrection: punchStartTimeCorrectionProof,
      punchStartTimeCorrectionWithdrawal: punchStartTimeCorrectionWithdrawalProof,
      shortenedCourseClassTransfer: shortenedCourseClassTransferProof
    };
  });
}

export type ActiveManualResultOverrideState =
  | "NONE"
  | "ACTIVE_DID_NOT_START"
  | "ACTIVE_DISQUALIFICATION"
  | "ACTIVE_APPROVAL"
  | "ACTIVE_DID_NOT_FINISH"
  | "ACTIVE_OUT_OF_COMPETITION"
  | "ACTIVE_WITHOUT_TIMING";

/**
 * Shared entry-locked writer gate. The central resolver performs the full
 * reciprocal-provenance validation; this wrapper exposes one bounded state to
 * every manual-result mutation.
 */
export async function loadActiveManualResultOverrideState<T extends StoredResultHead>(
  tx: DatabaseTransaction,
  raceId: string,
  selectedHead: T | null
): Promise<ActiveManualResultOverrideState> {
  if (selectedHead === null) return "NONE";
  const [resolved] = await resolveStoredResultHeadStates(tx, raceId, [selectedHead]);
  if (!resolved) throw new StoredResultRevisionConflict("Resultathuvudets manuella tillstånd saknas");
  if (resolved.state === "NO_ACTIVE_RESULT") return "NONE";
  if (resolved.withoutTiming?.withdrawal === null) return "ACTIVE_WITHOUT_TIMING";
  if (resolved.notCompeting?.withdrawal === null) return "ACTIVE_OUT_OF_COMPETITION";
  if (resolved.didNotFinish?.withdrawal === null) return "ACTIVE_DID_NOT_FINISH";
  if (resolved.approval?.withdrawal === null) return "ACTIVE_APPROVAL";
  if (resolved.disqualification?.withdrawal === null) return "ACTIVE_DISQUALIFICATION";
  if (resolved.head.didNotStartDecisionId !== null) return "ACTIVE_DID_NOT_START";
  if (resolved.startCheckinDns) return "ACTIVE_DID_NOT_START";
  return "NONE";
}
