import { createHash } from "node:crypto";
import {
  DID_NOT_FINISH_DECISION_POLICY_VERSION,
  DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION,
  OUT_OF_COMPETITION_DECISION_POLICY_VERSION,
  OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION,
  WITHOUT_TIMING_DECISION_POLICY_VERSION,
  WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION,
  canonicalJsonBytes,
  manualPunchStartTimeCorrectionRequestSchema,
  manualPunchStartTimeCorrectionResponseSchema,
  manualPunchStartTimeCorrectionWithdrawalRequestSchema,
  manualPunchStartTimeCorrectionWithdrawalResponseSchema,
  shortenedCourseClassTransferCandidateSchema,
  shortenedCourseClassTransferReceiptSchema,
  shortenedCourseClassTransferRequestSchema,
  resultOutcomeSchema,
  type ResultOutcome
} from "@o-tid/contracts";
import {
  createDidNotFinishResult,
  createDisqualifiedResult,
  createManuallyApprovedResult,
  createOutOfCompetitionResult,
  correctPunchedStartTime,
  createWithoutTimingResult,
  type DisqualifiableResult,
  type EvaluationResult,
  type ManuallyApprovableResult
} from "@o-tid/domain";
import { schema } from "@o-tid/database";
import { validateStoredStartCheckinDns } from "./start-checkin-dns-source";

type DatabaseStoredResultRevision = typeof schema.resultRevisions.$inferSelect;
// TASK135 is additive. Keeping the nullable new provenance optional in
// historical reader fixtures/projections makes their absence fail closed only
// when the new cause is claimed, rather than treating old rows as malformed.
export type StoredResultRevision = Omit<DatabaseStoredResultRevision, "shortenedCourseClassTransferId"> & {
  readonly shortenedCourseClassTransferId?: string | null;
};
export type StoredResultRevisionInput = Omit<StoredResultRevision, "manualFinishTimeCorrectionId" | "manualFinishTimeCorrectionWithdrawalId" | "manualPunchStartTimeCorrectionId" | "manualPunchStartTimeCorrectionWithdrawalId" | "shortenedCourseClassTransferId"> & {
  readonly manualFinishTimeCorrectionId?: string | null;
  readonly manualFinishTimeCorrectionWithdrawalId?: string | null;
  readonly manualPunchStartTimeCorrectionId?: string | null;
  readonly manualPunchStartTimeCorrectionWithdrawalId?: string | null;
  readonly shortenedCourseClassTransferId?: string | null;
};
export type StoredManualFinishTimeCorrection = typeof schema.manualFinishTimeCorrections.$inferSelect;
export interface StoredManualFinishTimeCorrectionProof {
  readonly correction: StoredManualFinishTimeCorrection;
  readonly source: StoredResultRevision;
  readonly corrected: StoredResultRevision;
}
export type StoredManualFinishTimeCorrectionWithdrawal =
  typeof schema.manualFinishTimeCorrectionWithdrawals.$inferSelect;
export interface StoredManualFinishTimeCorrectionWithdrawalProof {
  readonly withdrawal: StoredManualFinishTimeCorrectionWithdrawal;
  readonly correction: StoredManualFinishTimeCorrection;
  readonly source: StoredResultRevision;
  readonly corrected: StoredResultRevision;
  readonly restored: StoredResultRevision;
}
export type StoredManualPunchStartTimeCorrection = typeof schema.manualPunchStartTimeCorrections.$inferSelect;
export interface StoredManualPunchStartTimeCorrectionProof {
  readonly correction: StoredManualPunchStartTimeCorrection;
  readonly source: StoredResultRevision;
  readonly sourceStartPunchedAt: Date;
  readonly corrected: StoredResultRevision;
}
export type StoredManualPunchStartTimeCorrectionWithdrawal =
  typeof schema.manualPunchStartTimeCorrectionWithdrawals.$inferSelect;
export interface StoredManualPunchStartTimeCorrectionWithdrawalProof {
  readonly withdrawal: StoredManualPunchStartTimeCorrectionWithdrawal;
  readonly correction: StoredManualPunchStartTimeCorrection;
  readonly source: StoredResultRevision;
  readonly sourceStartPunchedAt: Date;
  readonly corrected: StoredResultRevision;
  readonly restored: StoredResultRevision;
}
export type StoredShortenedCourseClassTransfer = typeof schema.shortenedCourseClassTransfers.$inferSelect;
export type StoredShortenedCourseClassTransferItem = typeof schema.shortenedCourseClassTransferItems.$inferSelect;
export interface StoredShortenedCourseClassTransferProof {
  readonly transfer: StoredShortenedCourseClassTransfer;
  readonly item: StoredShortenedCourseClassTransferItem;
  readonly source: StoredResultRevision;
  readonly created: StoredResultRevision;
}
export type StoredPublishedResultOutcome = Exclude<ResultOutcome, { readonly status: "UNKNOWN_CARD" }>;
export type StoredResultDisqualificationDecision =
  typeof schema.resultDisqualificationDecisions.$inferSelect;
export type StoredResultDisqualificationWithdrawal =
  typeof schema.resultDisqualificationWithdrawals.$inferSelect;
export type StoredResultApprovalDecision = typeof schema.resultApprovalDecisions.$inferSelect;
export type StoredResultApprovalWithdrawal = typeof schema.resultApprovalWithdrawals.$inferSelect;
export type StoredDidNotFinishDecision = typeof schema.didNotFinishDecisions.$inferSelect;
export type StoredDidNotFinishWithdrawal = typeof schema.didNotFinishWithdrawals.$inferSelect;
export type StoredNotCompetingDecision = typeof schema.notCompetingDecisions.$inferSelect;
export type StoredNotCompetingWithdrawal = typeof schema.notCompetingWithdrawals.$inferSelect;
export type StoredWithoutTimingDecision = typeof schema.withoutTimingDecisions.$inferSelect;
export type StoredWithoutTimingWithdrawal = typeof schema.withoutTimingWithdrawals.$inferSelect;
export type StoredDidNotFinishTechnicalOutcome = EvaluationResult & {
  readonly status: "OK" | "MP";
  readonly reason: Exclude<EvaluationResult["reason"], "UNKNOWN_CARD">;
  readonly entryId: string;
  readonly classId: string;
  readonly courseVersionId: string;
};
export type StoredOutOfCompetitionTechnicalOutcome = StoredDidNotFinishTechnicalOutcome;
export type StoredWithoutTimingTechnicalOutcome = StoredDidNotFinishTechnicalOutcome & {
  readonly status: "OK";
  readonly reason: "COMPLETE";
};
export type StoredWithoutTimingRestorationTechnicalOutcome = StoredDidNotFinishTechnicalOutcome;

export class StoredResultRevisionConflict extends Error {}

function canonicalEquals(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalJsonBytes(left);
  const rightBytes = canonicalJsonBytes(right);
  return leftBytes.length === rightBytes.length && leftBytes.every((byte, index) => byte === rightBytes[index]);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

function outcomeWithoutFinishTiming(outcome: EvaluationResult): Record<string, unknown> {
  const comparable = { ...outcome } as Record<string, unknown>;
  delete comparable.finishTime;
  delete comparable.elapsedMs;
  return comparable;
}

function sameStoredResultRevision(
  actual: StoredResultRevisionInput,
  expected: StoredResultRevision
): boolean {
  for (const key of Object.keys(expected) as (keyof StoredResultRevision)[]) {
    const left = actual[key];
    const right = expected[key];
    if (right instanceof Date) {
      if (!(left instanceof Date) || left.getTime() !== right.getTime()) return false;
    } else if (!canonicalEquals(left, right)) {
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates the reciprocal journal proof for the only technical result that a
 * TASK135 class transfer may append. The created revision is accepted only
 * after the exact source class, selected entry, raw readout and frozen prefix
 * basis all agree.
 */
export function validateStoredShortenedCourseClassTransfer(
  proof: StoredShortenedCourseClassTransferProof
): void {
  const request = shortenedCourseClassTransferRequestSchema.safeParse(proof.transfer.request);
  const receipt = shortenedCourseClassTransferReceiptSchema.safeParse(proof.transfer.response);
  const frozen = proof.transfer.frozenBasis;
  if (!request.success || !receipt.success || !isRecord(frozen) ||
      frozen.kind !== "SHORTENED_COURSE_CLASS_TRANSFER_BASIS" || !isRecord(frozen.semantic)) {
    throw new StoredResultRevisionConflict("Kortbaneöverflyttningen har ogiltig journalgrund");
  }
  if (proof.transfer.sourceHash !== sha256(frozen)) {
    throw new StoredResultRevisionConflict("Kortbaneöverflyttningens bas-hash kan inte valideras");
  }
  const candidate = shortenedCourseClassTransferCandidateSchema.safeParse({
    ...frozen.semantic,
    basisHash: proof.transfer.sourceHash
  });
  if (!candidate.success || receipt.data.replayed ||
      !canonicalEquals(request.data, proof.transfer.request) ||
      !canonicalEquals(receipt.data, proof.transfer.response)) {
    throw new StoredResultRevisionConflict("Kortbaneöverflyttningens journal kan inte valideras");
  }
  const value = candidate.data;
  if (proof.transfer.requestId !== request.data.requestId || proof.transfer.requestId !== receipt.data.requestId ||
      proof.transfer.raceId !== value.raceId || proof.transfer.sourceClassId !== value.sourceClassId ||
      proof.transfer.sourceCourseId !== value.sourceCourseId || proof.transfer.sourceCourseVersionId !== value.sourceCourseVersionId ||
      proof.transfer.sourceSnapshotVersion !== value.snapshotVersion || proof.transfer.sourceHash !== value.basisHash ||
      proof.transfer.shortCourseId !== receipt.data.shortCourseId ||
      proof.transfer.shortCourseVersionId !== receipt.data.shortCourseVersionId ||
      proof.transfer.shortClassId !== receipt.data.shortClassId ||
      receipt.data.sourceClassId !== proof.transfer.sourceClassId ||
      receipt.data.sourceCourseVersionId !== proof.transfer.sourceCourseVersionId ||
      receipt.data.sourceSnapshotVersion !== proof.transfer.sourceSnapshotVersion ||
      receipt.data.sourceBasisHash !== proof.transfer.sourceHash ||
      receipt.data.snapshotVersionAfter !== proof.transfer.sourceSnapshotVersion + 1 ||
      request.data.sourceClassId !== value.sourceClassId ||
      request.data.expectedSourceCourseVersionId !== value.sourceCourseVersionId ||
      request.data.expectedSourceStartRule !== value.sourceStartRule ||
      request.data.expectedSnapshotVersion !== value.snapshotVersion ||
      request.data.expectedBasisHash !== value.basisHash ||
      request.data.expectedSourceControlCount !== value.sourceControls.length ||
      !canonicalEquals(request.data.controlPrefix, value.sourceControls.slice(0, request.data.controlPrefix.length))) {
    throw new StoredResultRevisionConflict("Kortbaneöverflyttningens receipt motsäger sin frysta grund");
  }
  const candidateEntry = value.entries.find((entry) => entry.entryId === proof.item.entryId);
  const receiptItem = receipt.data.items.find((item) => item.entryId === proof.item.entryId);
  if (!candidateEntry || !receiptItem || proof.item.requestId !== proof.transfer.requestId ||
      proof.item.raceId !== proof.transfer.raceId ||
      proof.item.sourceResultRevisionId === null || proof.item.sourceResultRevision === null ||
      proof.item.sourceReadoutId === null || proof.item.createdResultRevisionId === null ||
      proof.item.createdResultRevision === null || receiptItem.effect !== "MOVED_AND_REEVALUATED" ||
      receiptItem.entryVersionBefore !== proof.item.entryVersionBefore ||
      receiptItem.entryVersionAfter !== proof.item.entryVersionAfter ||
      receiptItem.sourceResultRevisionId !== proof.item.sourceResultRevisionId ||
      receiptItem.sourceReadoutId !== proof.item.sourceReadoutId ||
      receiptItem.createdResultRevisionId !== proof.item.createdResultRevisionId ||
      receiptItem.createdResultRevision !== proof.item.createdResultRevision ||
      candidateEntry.sourceResult.kind !== "CARD_READOUT_MP") {
    throw new StoredResultRevisionConflict("Kortbaneöverflyttningens entrymanifest är ofullständigt");
  }
  const source = proof.source;
  const created = proof.created;
  if (source.id !== proof.item.sourceResultRevisionId || source.revision !== proof.item.sourceResultRevision ||
      source.raceId !== proof.transfer.raceId || source.entryId !== proof.item.entryId ||
      source.cause !== "CARD_READOUT" || !source.published || source.status !== "MP" ||
      source.readoutId !== proof.item.sourceReadoutId || source.courseVersionId !== proof.transfer.sourceCourseVersionId ||
      candidateEntry.sourceResult.resultRevisionId !== source.id ||
      candidateEntry.sourceResult.resultRevision !== source.revision ||
      candidateEntry.sourceResult.readoutId !== source.readoutId ||
      candidateEntry.sourceResult.snapshotVersion !== source.snapshotVersion ||
      candidateEntry.sourceResult.courseVersionId !== source.courseVersionId ||
      candidateEntry.sourceResult.status !== source.status || candidateEntry.sourceResult.cause !== source.cause ||
      candidateEntry.sourceResult.published !== source.published ||
      created.id !== proof.item.createdResultRevisionId || created.revision !== proof.item.createdResultRevision ||
      created.raceId !== proof.transfer.raceId || created.entryId !== proof.item.entryId ||
      created.revision !== source.revision + 1 || created.cause !== "SHORTENED_COURSE_CLASS_TRANSFER" ||
      created.shortenedCourseClassTransferId !== proof.transfer.requestId || created.readoutId !== source.readoutId ||
      !created.published || created.snapshotVersion !== receipt.data.snapshotVersionAfter ||
      created.courseVersionId !== proof.transfer.shortCourseVersionId ||
      (created.status !== "OK" && created.status !== "MP") || receiptItem.resultingStatus !== created.status) {
    throw new StoredResultRevisionConflict("Kortbaneöverflyttningens revisionsproveniens motsäger sin källa");
  }
  // The source must satisfy the normal historical technical rule as well;
  // otherwise a malformed earlier revision could be smuggled through transfer.
  parseStrictStoredResultRevision(source);
}

export function parseStrictStoredResultRevision(
  row: StoredResultRevisionInput,
  checkinSource?: Parameters<typeof validateStoredStartCheckinDns>[0],
  correctionProof?: StoredManualFinishTimeCorrectionProof,
  correctionWithdrawalProof?: StoredManualFinishTimeCorrectionWithdrawalProof,
  punchStartCorrectionProof?: StoredManualPunchStartTimeCorrectionProof,
  punchStartCorrectionWithdrawalProof?: StoredManualPunchStartTimeCorrectionWithdrawalProof,
  shortenedCourseClassTransferProof?: StoredShortenedCourseClassTransferProof
): StoredPublishedResultOutcome {
  if (row.startCheckinDnsDecisionId !== null) {
    if (!checkinSource) throw new StoredResultRevisionConflict("Avpricknings-DNS kräver full källvalidering");
    // Reader rows may include display columns. Compare every stored result
    // column, never accept a valid proof for a different/modified projection.
    for (const key of Object.keys(checkinSource.result) as (keyof StoredResultRevision)[]) {
      const expected = checkinSource.result[key], actual = row[key];
      const matches = expected instanceof Date
        ? actual instanceof Date && expected.getTime() === actual.getTime()
        : canonicalEquals(expected, actual);
      if (!matches) throw new StoredResultRevisionConflict("Källbeviset matchar inte vald resultatrevision");
    }
    return validateStoredStartCheckinDns(checkinSource);
  }
  if (row.cause === "MANUAL_FINISH_TIME_CORRECTION") {
    if (!correctionProof) throw new StoredResultRevisionConflict("Måltidsrättning kräver fullständigt källbevis");
    validateStoredManualFinishTimeCorrection(correctionProof);
    if (!sameStoredResultRevision(row, correctionProof.corrected)) {
      throw new StoredResultRevisionConflict("Måltidsrättningens källbevis matchar inte vald resultatrevision");
    }
  } else if (row.cause === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL") {
    if (!correctionWithdrawalProof) throw new StoredResultRevisionConflict("Återtagande av måltidsrättning kräver fullständigt källbevis");
    validateStoredManualFinishTimeCorrectionWithdrawal(correctionWithdrawalProof);
    if (!sameStoredResultRevision(row, correctionWithdrawalProof.restored)) {
      throw new StoredResultRevisionConflict("Måltidsrättningens återtagandebevis matchar inte vald resultatrevision");
    }
  } else if (row.cause === "MANUAL_PUNCH_START_TIME_CORRECTION") {
    if (!punchStartCorrectionProof) throw new StoredResultRevisionConflict("Starttidsrättning kräver fullständigt källbevis");
    validateStoredManualPunchStartTimeCorrection(punchStartCorrectionProof);
    if (!sameStoredResultRevision(row, punchStartCorrectionProof.corrected)) {
      throw new StoredResultRevisionConflict("Starttidsrättningens källbevis matchar inte vald resultatrevision");
    }
  } else if (row.cause === "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL") {
    if (!punchStartCorrectionWithdrawalProof) throw new StoredResultRevisionConflict("Återtagande av starttidsrättning kräver fullständigt källbevis");
    validateStoredManualPunchStartTimeCorrectionWithdrawal(punchStartCorrectionWithdrawalProof);
    if (!sameStoredResultRevision(row, punchStartCorrectionWithdrawalProof.restored)) {
      throw new StoredResultRevisionConflict("Starttidsrättningens återtagandebevis matchar inte vald resultatrevision");
    }
  } else if (row.cause === "SHORTENED_COURSE_CLASS_TRANSFER") {
    if (!shortenedCourseClassTransferProof) throw new StoredResultRevisionConflict("Kortbaneöverflyttning kräver fullständigt källbevis");
    validateStoredShortenedCourseClassTransfer(shortenedCourseClassTransferProof);
    if (!sameStoredResultRevision(row, shortenedCourseClassTransferProof.created)) {
      throw new StoredResultRevisionConflict("Kortbaneöverflyttningens källbevis matchar inte vald resultatrevision");
    }
  } else if (row.manualFinishTimeCorrectionId != null || row.manualFinishTimeCorrectionWithdrawalId != null ||
      row.manualPunchStartTimeCorrectionId != null || row.manualPunchStartTimeCorrectionWithdrawalId != null ||
      row.shortenedCourseClassTransferId != null) {
    throw new StoredResultRevisionConflict("Resultatrevisionen har oväntad måltidsrättningsproveniens");
  }
  if (row.cause !== "SHORTENED_COURSE_CLASS_TRANSFER" && row.shortenedCourseClassTransferId != null) {
    throw new StoredResultRevisionConflict("Resultatrevisionen har oväntad kortbaneproveniens");
  }
  const parsed = resultOutcomeSchema.safeParse(row.evaluation);
  if (!parsed.success || parsed.data.status === "UNKNOWN_CARD" ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 ||
      !Number.isSafeInteger(row.snapshotVersion) || row.snapshotVersion < 1 ||
      !("entryId" in parsed.data) || parsed.data.entryId !== row.entryId ||
      !("classId" in parsed.data) || parsed.data.classId === undefined ||
      !("courseVersionId" in parsed.data) || parsed.data.courseVersionId !== row.courseVersionId ||
      parsed.data.status !== row.status || parsed.data.reason !== row.reason) {
    throw new StoredResultRevisionConflict("Resultatrevisionen motsäger sitt lagrade utfall");
  }

  const technical = row.cause === "CARD_READOUT" ||
    row.cause === "CLASS_CHANGE_RECALCULATION" || row.cause === "EXPLICIT_RECALCULATION" ||
    row.cause === "UNKNOWN_READOUT_RESOLUTION";
  const manualDns = row.cause === "MANUAL_DID_NOT_START";
  const manualDisqualification = row.cause === "MANUAL_DISQUALIFICATION";
  const manualRestoration = row.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL";
  const manualApproval = row.cause === "MANUAL_RESULT_APPROVAL";
  const manualApprovalRestoration = row.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL";
  const manualOutOfCompetition = row.cause === "MANUAL_OUT_OF_COMPETITION";
  const manualOutOfCompetitionRestoration = row.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL";
  const manualWithoutTiming = row.cause === "MANUAL_WITHOUT_TIMING";
  const manualWithoutTimingRestoration = row.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL";
  const manualFinishTimeCorrection = row.cause === "MANUAL_FINISH_TIME_CORRECTION";
  const manualFinishTimeCorrectionWithdrawal = row.cause === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL";
  const manualPunchStartTimeCorrection = row.cause === "MANUAL_PUNCH_START_TIME_CORRECTION";
  const manualPunchStartTimeCorrectionWithdrawal = row.cause === "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL";
  const shortenedCourseClassTransfer = row.cause === "SHORTENED_COURSE_CLASS_TRANSFER";
  const sourceShapeMatches = shortenedCourseClassTransfer
    ? row.readoutId !== null && row.shortenedCourseClassTransferId !== null && row.didNotStartDecisionId === null &&
      row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
      row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
      row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
      row.notCompetingDecisionId === null && row.notCompetingWithdrawalId === null &&
      row.withoutTimingDecisionId === null && row.withoutTimingWithdrawalId === null &&
      row.startCheckinDnsDecisionId === null && row.manualFinishTimeCorrectionId === null &&
      row.manualFinishTimeCorrectionWithdrawalId === null && row.manualPunchStartTimeCorrectionId === null &&
      row.manualPunchStartTimeCorrectionWithdrawalId === null && (parsed.data.status === "OK" || parsed.data.status === "MP")
    : manualPunchStartTimeCorrection
    ? row.readoutId === null && row.didNotStartDecisionId === null &&
      row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
      row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
      row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
      row.notCompetingDecisionId === null && row.notCompetingWithdrawalId === null &&
      row.withoutTimingDecisionId === null && row.withoutTimingWithdrawalId === null &&
      row.startCheckinDnsDecisionId === null && row.manualPunchStartTimeCorrectionId != null &&
      row.manualPunchStartTimeCorrectionWithdrawalId == null && row.manualFinishTimeCorrectionId == null && row.manualFinishTimeCorrectionWithdrawalId == null &&
      (parsed.data.status === "OK" || parsed.data.status === "MP")
    : manualPunchStartTimeCorrectionWithdrawal
    ? row.readoutId === null && row.didNotStartDecisionId === null &&
      row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
      row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
      row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
      row.notCompetingDecisionId === null && row.notCompetingWithdrawalId === null &&
      row.withoutTimingDecisionId === null && row.withoutTimingWithdrawalId === null &&
      row.startCheckinDnsDecisionId === null && row.manualPunchStartTimeCorrectionId == null &&
      row.manualPunchStartTimeCorrectionWithdrawalId != null && row.manualFinishTimeCorrectionId == null &&
      row.manualFinishTimeCorrectionWithdrawalId == null && (parsed.data.status === "OK" || parsed.data.status === "MP")
    : manualFinishTimeCorrection
    ? row.readoutId === null && row.didNotStartDecisionId === null &&
      row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
      row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
      row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
      row.notCompetingDecisionId === null && row.notCompetingWithdrawalId === null &&
      row.withoutTimingDecisionId === null && row.withoutTimingWithdrawalId === null &&
      row.startCheckinDnsDecisionId === null && row.manualFinishTimeCorrectionId != null &&
      row.manualFinishTimeCorrectionWithdrawalId == null &&
      (parsed.data.status === "OK" || parsed.data.status === "MP")
    : manualFinishTimeCorrectionWithdrawal
      ? row.readoutId === null && row.didNotStartDecisionId === null &&
        row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
        row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
        row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
        row.notCompetingDecisionId === null && row.notCompetingWithdrawalId === null &&
        row.withoutTimingDecisionId === null && row.withoutTimingWithdrawalId === null &&
        row.startCheckinDnsDecisionId === null && row.manualFinishTimeCorrectionId == null &&
        row.manualFinishTimeCorrectionWithdrawalId != null &&
        (parsed.data.status === "OK" || parsed.data.status === "MP")
    : technical
    ? row.readoutId !== null && row.didNotStartDecisionId === null &&
      row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
      row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
      row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
      (parsed.data.status === "OK" || parsed.data.status === "MP")
    : manualDns
      ? row.readoutId === null && row.didNotStartDecisionId !== null &&
        row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
        row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
        row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
        parsed.data.status === "DNS"
      : manualDisqualification
        ? row.readoutId === null && row.didNotStartDecisionId === null &&
          row.disqualificationDecisionId !== null && row.disqualificationWithdrawalId === null &&
          row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
          row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
          parsed.data.status === "DSQ"
        : manualRestoration
          ? row.readoutId === null && row.didNotStartDecisionId === null &&
            row.disqualificationDecisionId === null && row.disqualificationWithdrawalId !== null &&
            row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
            row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
            (parsed.data.status === "OK" || parsed.data.status === "MP")
          : manualApproval
            ? row.readoutId === null && row.didNotStartDecisionId === null &&
              row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
              row.approvalDecisionId !== null && row.approvalWithdrawalId === null &&
              row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
              parsed.data.status === "OK" && parsed.data.reason === "MANUAL_APPROVAL"
            : manualApprovalRestoration
              ? row.readoutId === null && row.didNotStartDecisionId === null &&
                row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
                row.approvalDecisionId === null && row.approvalWithdrawalId !== null &&
                row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
                (parsed.data.status === "OK" || parsed.data.status === "MP") &&
                parsed.data.reason !== "MANUAL_APPROVAL"
              : row.cause === "MANUAL_DID_NOT_FINISH"
                ? row.readoutId === null && row.didNotStartDecisionId === null &&
                  row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
                  row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
                  row.didNotFinishDecisionId !== null && row.didNotFinishWithdrawalId === null &&
                  parsed.data.status === "DNF" &&
                  parsed.data.reason === "DID_NOT_FINISH"
                : row.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
                  ? row.readoutId === null && row.didNotStartDecisionId === null &&
                    row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
                    row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
                    row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId !== null &&
                    (parsed.data.status === "OK" || parsed.data.status === "MP") &&
                    parsed.data.reason !== "MANUAL_APPROVAL"
                  : manualOutOfCompetition
                    ? row.readoutId === null && row.didNotStartDecisionId === null &&
                      row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
                      row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
                      row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
                      row.notCompetingDecisionId !== null && parsed.data.status === "OOC" &&
                      parsed.data.reason === "OUT_OF_COMPETITION"
                    : manualOutOfCompetitionRestoration
                      ? row.readoutId === null && row.didNotStartDecisionId === null &&
                        row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
                        row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
                        row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
                        row.notCompetingDecisionId === null && row.notCompetingWithdrawalId !== null &&
                        (parsed.data.status === "OK" || parsed.data.status === "MP") &&
                        parsed.data.reason !== "MANUAL_APPROVAL"
                      : manualWithoutTiming
                        ? row.readoutId === null && row.didNotStartDecisionId === null &&
                          row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
                          row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
                          row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
                          row.notCompetingDecisionId === null && row.notCompetingWithdrawalId === null &&
                          row.withoutTimingDecisionId !== null && parsed.data.status === "NT" &&
                          parsed.data.reason === "WITHOUT_TIMING"
                        : manualWithoutTimingRestoration
                          ? row.readoutId === null && row.didNotStartDecisionId === null &&
                            row.disqualificationDecisionId === null && row.disqualificationWithdrawalId === null &&
                            row.approvalDecisionId === null && row.approvalWithdrawalId === null &&
                            row.didNotFinishDecisionId === null && row.didNotFinishWithdrawalId === null &&
                            row.notCompetingDecisionId === null && row.notCompetingWithdrawalId === null &&
                            row.withoutTimingDecisionId === null && row.withoutTimingWithdrawalId !== null &&
                            (parsed.data.status === "OK" || parsed.data.status === "MP") &&
                            parsed.data.reason !== "MANUAL_APPROVAL"
                        : false;
  const outOfCompetitionReferenceMatches = manualOutOfCompetition
    ? row.notCompetingDecisionId !== null && row.notCompetingWithdrawalId === null
    : manualOutOfCompetitionRestoration
      ? row.notCompetingDecisionId === null && row.notCompetingWithdrawalId !== null
      : row.notCompetingDecisionId === null && row.notCompetingWithdrawalId === null;
  const withoutTimingReferenceMatches = manualWithoutTiming
    ? row.withoutTimingDecisionId !== null && row.withoutTimingWithdrawalId === null
    : manualWithoutTimingRestoration
      ? row.withoutTimingDecisionId === null && row.withoutTimingWithdrawalId !== null
      : row.withoutTimingDecisionId === null && row.withoutTimingWithdrawalId === null;
  if (!sourceShapeMatches || !outOfCompetitionReferenceMatches || !withoutTimingReferenceMatches) {
    throw new StoredResultRevisionConflict("Resultatrevisionens orsak och proveniens motsäger varandra");
  }
  return parsed.data as StoredPublishedResultOutcome;
}

/** Validates the immutable journal and both reciprocal revisions for a finish correction. */
export function validateStoredManualFinishTimeCorrection(
  proof: StoredManualFinishTimeCorrectionProof
): void {
  const { correction, source, corrected } = proof;
  const sourceOutcome = parseStrictStoredResultRevision(source);
  const correctedOutcome = resultOutcomeSchema.safeParse(corrected.evaluation);
  const sourceValue = sourceOutcome as EvaluationResult;
  const correctedValue = correctedOutcome.success ? correctedOutcome.data as EvaluationResult : undefined;
  const sourceFinishTime = (sourceValue as { readonly finishTime: string }).finishTime;
  const sourceComparable = outcomeWithoutFinishTiming(sourceValue);
  const correctedComparable = correctedValue ? outcomeWithoutFinishTiming(correctedValue) : undefined;
  const directTechnical = source.cause === "CARD_READOUT" || source.cause === "CLASS_CHANGE_RECALCULATION" ||
    source.cause === "EXPLICIT_RECALCULATION" || source.cause === "UNKNOWN_READOUT_RESOLUTION";
  if (!correctedValue || !sourceValue.startTime || !sourceFinishTime ||
      !correctedValue.startTime || !correctedValue.finishTime || correctedValue.elapsedMs === undefined) {
    throw new StoredResultRevisionConflict("Måltidsrättningens resultat saknar komplett start eller måltid");
  }
  if (!directTechnical || !source.published || source.readoutId === null ||
      (sourceOutcome.status !== "OK" && sourceOutcome.status !== "MP") || !correctedOutcome.success ||
      corrected.cause !== "MANUAL_FINISH_TIME_CORRECTION" || !corrected.published ||
      corrected.manualFinishTimeCorrectionId !== correction.requestId ||
      correction.sourceResultRevisionId !== source.id || correction.createdResultRevisionId !== corrected.id ||
      correction.sourceResultRevision !== source.revision || correction.createdResultRevision !== corrected.revision ||
      correction.raceId !== source.raceId || correction.raceId !== corrected.raceId ||
      correction.entryId !== source.entryId || correction.entryId !== corrected.entryId ||
      correction.sourceReadoutId !== source.readoutId || correction.createdResultRevision !== source.revision + 1 ||
      corrected.revision !== source.revision + 1 || corrected.readoutId !== null ||
      corrected.status !== source.status || corrected.reason !== source.reason ||
      corrected.courseVersionId !== source.courseVersionId || corrected.snapshotVersion !== source.snapshotVersion ||
      !canonicalEquals(sourceComparable, correctedComparable) ||
      correction.sourceFinishTime.getTime() !== Date.parse(sourceFinishTime) ||
      correction.correctedFinishTime.getTime() !== Date.parse(correctedValue.finishTime)) {
    throw new StoredResultRevisionConflict("Måltidsrättningens källbevis motsäger resultatrevisionen");
  }
  if (!correctedValue.startTime || !correctedValue.finishTime || correctedValue.elapsedMs === undefined ||
      Date.parse(correctedValue.finishTime) - Date.parse(correctedValue.startTime) !== correctedValue.elapsedMs ||
      Date.parse(correctedValue.finishTime) <= Date.parse(sourceValue.startTime) ||
      Date.parse(correctedValue.finishTime) === Date.parse(sourceFinishTime)) {
    throw new StoredResultRevisionConflict("Korrigerad måltid är ogiltig");
  }
}

/** Validates immutable PUNCH-start provenance and the derived start/split timing. */
export function validateStoredManualPunchStartTimeCorrection(
  proof: StoredManualPunchStartTimeCorrectionProof
): void {
  const { correction, source, sourceStartPunchedAt, corrected } = proof;
  const request = manualPunchStartTimeCorrectionRequestSchema.safeParse(correction.request);
  const response = manualPunchStartTimeCorrectionResponseSchema.safeParse(correction.response);
  const sourceOutcome = parseStrictStoredResultRevision(source) as EvaluationResult;
  const directTechnical = source.cause === "CARD_READOUT" || source.cause === "CLASS_CHANGE_RECALCULATION" ||
    source.cause === "EXPLICIT_RECALCULATION" || source.cause === "UNKNOWN_READOUT_RESOLUTION";
  if (!request.success || !response.success || response.data.source.startRule !== "PUNCH" ||
      response.data.requestId !== correction.requestId || response.data.correctionId !== correction.requestId ||
      response.data.raceId !== correction.raceId || response.data.entryId !== correction.entryId ||
      response.data.classId !== correction.classId || response.data.courseVersionId !== correction.courseVersionId ||
      response.data.sourceBasisHash !== correction.basisHash ||
      response.data.source.resultRevisionId !== correction.sourceResultRevisionId ||
      response.data.source.resultRevision !== correction.sourceResultRevision ||
      response.data.source.readoutId !== correction.sourceReadoutId ||
      response.data.source.startTime !== correction.sourceStartTime.toISOString() ||
      response.data.correctedStartTime !== correction.correctedStartTime.toISOString() ||
      response.data.createdResultRevisionId !== correction.createdResultRevisionId ||
      response.data.createdResultRevision !== correction.createdResultRevision ||
      !canonicalEquals(request.data, response.data.request) ||
      !directTechnical || !source.published || source.readoutId === null ||
      (sourceOutcome.status !== "OK" && sourceOutcome.status !== "MP") || !sourceOutcome.startTime ||
      !sourceOutcome.finishTime || sourceOutcome.elapsedMs === undefined ||
      correction.sourceResultRevisionId !== source.id || correction.createdResultRevisionId !== corrected.id ||
      correction.sourceResultRevision !== source.revision || correction.createdResultRevision !== corrected.revision ||
      correction.raceId !== source.raceId || correction.raceId !== corrected.raceId ||
      correction.entryId !== source.entryId || correction.entryId !== corrected.entryId ||
      correction.sourceReadoutId !== source.readoutId || corrected.revision !== source.revision + 1 ||
      correction.createdResultRevision !== source.revision + 1 || corrected.cause !== "MANUAL_PUNCH_START_TIME_CORRECTION" ||
      !corrected.published || corrected.readoutId !== null ||
      corrected.manualPunchStartTimeCorrectionId !== correction.requestId ||
      corrected.manualFinishTimeCorrectionId !== null || corrected.manualFinishTimeCorrectionWithdrawalId !== null ||
      corrected.courseVersionId !== source.courseVersionId || corrected.snapshotVersion !== source.snapshotVersion ||
      correction.sourceStartTime.getTime() !== Date.parse(sourceOutcome.startTime) ||
      sourceStartPunchedAt.getTime() !== Date.parse(sourceOutcome.startTime)) {
    throw new StoredResultRevisionConflict("Starttidsrättningens källbevis motsäger resultatrevisionen");
  }
  let expected: EvaluationResult;
  try {
    expected = correctPunchedStartTime(sourceOutcome as Parameters<typeof correctPunchedStartTime>[0], correction.correctedStartTime.toISOString());
  } catch {
    throw new StoredResultRevisionConflict("Starttidsrättningens tidsgrund är ogiltig");
  }
  const parsed = resultOutcomeSchema.safeParse(corrected.evaluation);
  if (!parsed.success || !canonicalEquals(parsed.data, expected) || corrected.status !== expected.status ||
      corrected.reason !== expected.reason) {
    throw new StoredResultRevisionConflict("Starttidsrättningen bevarar inte korrekt resultatfakta");
  }
}

/** Validates the immutable `technical -> PUNCH start correction -> restoration` chain. */
export function validateStoredManualPunchStartTimeCorrectionWithdrawal(
  proof: StoredManualPunchStartTimeCorrectionWithdrawalProof
): void {
  const { withdrawal, correction, source, sourceStartPunchedAt, corrected, restored } = proof;
  validateStoredManualPunchStartTimeCorrection({ correction, source, sourceStartPunchedAt, corrected });
  const request = manualPunchStartTimeCorrectionWithdrawalRequestSchema.safeParse(withdrawal.request);
  const response = manualPunchStartTimeCorrectionWithdrawalResponseSchema.safeParse(withdrawal.response);
  const sourceOutcome = parseStrictStoredResultRevision(source);
  const restoredOutcome = resultOutcomeSchema.safeParse(restored.evaluation);
  if (!request.success || !response.success || !restoredOutcome.success ||
      response.data.requestId !== withdrawal.requestId || response.data.withdrawalId !== withdrawal.id ||
      response.data.correctionId !== correction.requestId || !canonicalEquals(response.data.request, request.data) ||
      response.data.source.id !== source.id || response.data.source.revision !== source.revision ||
      response.data.corrected.id !== corrected.id || response.data.corrected.revision !== corrected.revision ||
      response.data.created.id !== restored.id || response.data.created.revision !== restored.revision ||
      response.data.created.startTime !== (sourceOutcome as EvaluationResult).startTime ||
      withdrawal.correctionId !== correction.requestId || withdrawal.sourceResultRevisionId !== source.id ||
      withdrawal.sourceResultRevision !== source.revision || withdrawal.correctedResultRevisionId !== corrected.id ||
      withdrawal.correctedResultRevision !== corrected.revision || withdrawal.createdResultRevisionId !== restored.id ||
      withdrawal.createdResultRevision !== restored.revision || withdrawal.raceId !== source.raceId ||
      withdrawal.raceId !== corrected.raceId || withdrawal.raceId !== restored.raceId ||
      withdrawal.entryId !== source.entryId || withdrawal.entryId !== corrected.entryId || withdrawal.entryId !== restored.entryId ||
      corrected.revision !== source.revision + 1 || restored.revision !== corrected.revision + 1 ||
      restored.cause !== "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL" || !restored.published ||
      restored.readoutId !== null || restored.manualPunchStartTimeCorrectionId !== null ||
      restored.manualPunchStartTimeCorrectionWithdrawalId !== withdrawal.id ||
      restored.status !== source.status || restored.reason !== source.reason ||
      restored.courseVersionId !== source.courseVersionId || restored.snapshotVersion !== source.snapshotVersion ||
      !canonicalEquals(restoredOutcome.data, sourceOutcome)) {
    throw new StoredResultRevisionConflict("Starttidsrättningens återtagandebevis motsäger revisionskedjan");
  }
}

/** Validates the immutable `technical -> correction -> restoration` chain. */
export function validateStoredManualFinishTimeCorrectionWithdrawal(
  proof: StoredManualFinishTimeCorrectionWithdrawalProof
): void {
  const { withdrawal, correction, source, corrected, restored } = proof;
  validateStoredManualFinishTimeCorrection({ correction, source, corrected });
  const restoredOutcome = resultOutcomeSchema.safeParse(restored.evaluation);
  if (!restoredOutcome.success || restored.cause !== "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" ||
      !restored.published || restored.manualFinishTimeCorrectionId !== null ||
      restored.manualFinishTimeCorrectionWithdrawalId !== withdrawal.id || restored.readoutId !== null ||
      withdrawal.correctionId !== correction.requestId || withdrawal.sourceResultRevisionId !== source.id ||
      withdrawal.sourceResultRevision !== source.revision || withdrawal.correctedResultRevisionId !== corrected.id ||
      withdrawal.correctedResultRevision !== corrected.revision || withdrawal.createdResultRevisionId !== restored.id ||
      withdrawal.createdResultRevision !== restored.revision || withdrawal.raceId !== source.raceId ||
      withdrawal.raceId !== corrected.raceId || withdrawal.raceId !== restored.raceId ||
      withdrawal.entryId !== source.entryId || withdrawal.entryId !== corrected.entryId || withdrawal.entryId !== restored.entryId ||
      corrected.revision !== source.revision + 1 || restored.revision !== corrected.revision + 1 ||
      restored.status !== source.status || restored.reason !== source.reason ||
      restored.courseVersionId !== source.courseVersionId || restored.snapshotVersion !== source.snapshotVersion ||
      !canonicalEquals(restoredOutcome.data, parseStrictStoredResultRevision(source))) {
    throw new StoredResultRevisionConflict("Måltidsrättningens återtagandebevis motsäger revisionskedjan");
  }
}

export function parseWithoutTimingTechnicalRevision(
  row: StoredResultRevision
): StoredWithoutTimingTechnicalOutcome {
  const outcome = parseStrictStoredResultRevision(row);
  const technical = row.cause === "CARD_READOUT" ||
    row.cause === "CLASS_CHANGE_RECALCULATION" || row.cause === "EXPLICIT_RECALCULATION" ||
    row.cause === "UNKNOWN_READOUT_RESOLUTION";
  if (!technical || !row.published || outcome.status !== "OK" || outcome.reason !== "COMPLETE") {
    throw new StoredResultRevisionConflict(
      "Resultatrevisionen är inte en publicerad direkt teknisk OK/COMPLETE-källa för utan tidtagning"
    );
  }
  createWithoutTimingResult(outcome as EvaluationResult);
  return outcome as StoredWithoutTimingTechnicalOutcome;
}

export function validateStoredWithoutTiming(
  decision: StoredWithoutTimingDecision,
  target: StoredResultRevision,
  withoutTiming: StoredResultRevision
): void {
  const targetOutcome = parseWithoutTimingTechnicalRevision(target);
  const withoutTimingOutcome = parseStrictStoredResultRevision(withoutTiming);
  if (decision.targetResultRevisionId !== target.id || decision.targetResultRevision !== target.revision ||
      decision.createdResultRevisionId !== withoutTiming.id ||
      decision.createdResultRevision !== withoutTiming.revision ||
      decision.raceId !== target.raceId || decision.raceId !== withoutTiming.raceId ||
      decision.entryId !== target.entryId || decision.entryId !== withoutTiming.entryId ||
      decision.expectedClassId !== targetOutcome.classId ||
      decision.expectedCourseVersionId !== target.courseVersionId ||
      decision.expectedSnapshotVersion !== target.snapshotVersion ||
      decision.createdResultRevision !== decision.targetResultRevision + 1 ||
      decision.status !== "NT" || decision.reason !== "WITHOUT_TIMING" ||
      decision.policyVersion !== WITHOUT_TIMING_DECISION_POLICY_VERSION ||
      withoutTiming.withoutTimingDecisionId !== decision.id ||
      withoutTiming.cause !== "MANUAL_WITHOUT_TIMING" ||
      withoutTiming.status !== "NT" || withoutTiming.reason !== "WITHOUT_TIMING" ||
      !withoutTiming.published || withoutTiming.engineVersion !== decision.policyVersion ||
      withoutTiming.courseVersionId !== target.courseVersionId ||
      withoutTiming.snapshotVersion !== target.snapshotVersion ||
      !canonicalEquals(withoutTimingOutcome, createWithoutTimingResult(targetOutcome))) {
    throw new StoredResultRevisionConflict("Utan-tidtagning-beslutet motsäger target eller NT-revision");
  }
}

/** Strict direct technical OK/MP source for an explicit NT withdrawal. */
export function parseWithoutTimingRestorationTechnicalRevision(
  row: StoredResultRevision
): StoredWithoutTimingRestorationTechnicalOutcome {
  const outcome = parseStrictStoredResultRevision(row);
  const technical = row.cause === "CARD_READOUT" ||
    row.cause === "CLASS_CHANGE_RECALCULATION" || row.cause === "EXPLICIT_RECALCULATION" ||
    row.cause === "UNKNOWN_READOUT_RESOLUTION";
  if (!technical || row.readoutId === null || !row.published ||
      (outcome.status !== "OK" && outcome.status !== "MP")) {
    throw new StoredResultRevisionConflict(
      "Resultatrevisionen är inte en publicerad direkt teknisk OK/MP-källa för NT-återtagande"
    );
  }
  return outcome as StoredWithoutTimingRestorationTechnicalOutcome;
}

export function validateStoredWithoutTimingWithdrawal(
  withdrawal: StoredWithoutTimingWithdrawal,
  decision: StoredWithoutTimingDecision,
  target: StoredResultRevision,
  withoutTiming: StoredResultRevision,
  expectedLatest: StoredResultRevision,
  source: StoredResultRevision,
  restored: StoredResultRevision
): void {
  validateStoredWithoutTiming(decision, target, withoutTiming);
  const sourceOutcome = parseWithoutTimingRestorationTechnicalRevision(source);
  const restoredOutcome = parseStrictStoredResultRevision(restored);
  const noLaterTechnical = expectedLatest.id === withoutTiming.id &&
    expectedLatest.revision === withoutTiming.revision &&
    source.id === target.id && source.revision === target.revision;
  const laterTechnical = expectedLatest.revision > withoutTiming.revision &&
    expectedLatest.id !== withoutTiming.id && expectedLatest.id !== target.id &&
    source.id === expectedLatest.id && source.revision === expectedLatest.revision;
  if (withdrawal.withoutTimingDecisionId !== decision.id ||
      withdrawal.targetResultRevisionId !== target.id ||
      withdrawal.targetResultRevision !== target.revision ||
      withdrawal.withdrawnResultRevisionId !== withoutTiming.id ||
      withdrawal.withdrawnResultRevision !== withoutTiming.revision ||
      withdrawal.expectedLatestResultRevisionId !== expectedLatest.id ||
      withdrawal.expectedLatestResultRevision !== expectedLatest.revision ||
      withdrawal.restoredFromResultRevisionId !== source.id ||
      withdrawal.restoredFromResultRevision !== source.revision ||
      withdrawal.createdResultRevisionId !== restored.id ||
      withdrawal.createdResultRevision !== restored.revision ||
      withdrawal.raceId !== decision.raceId || withdrawal.raceId !== target.raceId ||
      withdrawal.raceId !== withoutTiming.raceId || withdrawal.raceId !== expectedLatest.raceId ||
      withdrawal.raceId !== source.raceId || withdrawal.raceId !== restored.raceId ||
      withdrawal.entryId !== decision.entryId || withdrawal.entryId !== target.entryId ||
      withdrawal.entryId !== withoutTiming.entryId || withdrawal.entryId !== expectedLatest.entryId ||
      withdrawal.entryId !== source.entryId || withdrawal.entryId !== restored.entryId ||
      withdrawal.expectedClassId !== sourceOutcome.classId ||
      withdrawal.expectedCourseVersionId !== source.courseVersionId ||
      withdrawal.expectedSnapshotVersion !== source.snapshotVersion ||
      (!noLaterTechnical && !laterTechnical) ||
      withdrawal.createdResultRevision !== withdrawal.expectedLatestResultRevision + 1 ||
      withdrawal.policyVersion !== WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION ||
      withdrawal.reason !== "ERRONEOUS_MANUAL_WITHOUT_TIMING" ||
      restored.withoutTimingWithdrawalId !== withdrawal.id ||
      restored.cause !== "MANUAL_WITHOUT_TIMING_WITHDRAWAL" || !restored.published ||
      restored.engineVersion !== withdrawal.policyVersion ||
      restored.courseVersionId !== source.courseVersionId ||
      restored.snapshotVersion !== source.snapshotVersion ||
      !canonicalEquals(restoredOutcome, sourceOutcome)) {
    throw new StoredResultRevisionConflict("NT-återtagandet motsäger källa eller restaureringsrevision");
  }
}

export function parseOutOfCompetitionTechnicalRevision(
  row: StoredResultRevision
): StoredOutOfCompetitionTechnicalOutcome {
  const outcome = parseStrictStoredResultRevision(row);
  const technical = row.cause === "CARD_READOUT" ||
    row.cause === "CLASS_CHANGE_RECALCULATION" || row.cause === "EXPLICIT_RECALCULATION" ||
    row.cause === "UNKNOWN_READOUT_RESOLUTION";
  if (!technical || !row.published || (outcome.status !== "OK" && outcome.status !== "MP")) {
    throw new StoredResultRevisionConflict("Resultatrevisionen är inte en publicerad teknisk OK/MP-källa för OOC");
  }
  createOutOfCompetitionResult(outcome as EvaluationResult);
  return outcome as StoredOutOfCompetitionTechnicalOutcome;
}

export function validateStoredOutOfCompetition(
  decision: StoredNotCompetingDecision,
  target: StoredResultRevision,
  outOfCompetition: StoredResultRevision
): void {
  const targetOutcome = parseOutOfCompetitionTechnicalRevision(target);
  const outOfCompetitionOutcome = parseStrictStoredResultRevision(outOfCompetition);
  if (decision.targetResultRevisionId !== target.id || decision.targetResultRevision !== target.revision ||
      decision.createdResultRevisionId !== outOfCompetition.id ||
      decision.createdResultRevision !== outOfCompetition.revision ||
      decision.raceId !== target.raceId || decision.raceId !== outOfCompetition.raceId ||
      decision.entryId !== target.entryId || decision.entryId !== outOfCompetition.entryId ||
      decision.expectedClassId !== targetOutcome.classId ||
      decision.expectedCourseVersionId !== target.courseVersionId ||
      decision.expectedSnapshotVersion !== target.snapshotVersion ||
      decision.createdResultRevision !== decision.targetResultRevision + 1 ||
      decision.status !== "OOC" || decision.reason !== "OUT_OF_COMPETITION" ||
      decision.policyVersion !== OUT_OF_COMPETITION_DECISION_POLICY_VERSION ||
      outOfCompetition.notCompetingDecisionId !== decision.id ||
      outOfCompetition.cause !== "MANUAL_OUT_OF_COMPETITION" ||
      outOfCompetition.status !== "OOC" || outOfCompetition.reason !== "OUT_OF_COMPETITION" ||
      !outOfCompetition.published || outOfCompetition.engineVersion !== decision.policyVersion ||
      outOfCompetition.courseVersionId !== target.courseVersionId ||
      outOfCompetition.snapshotVersion !== target.snapshotVersion ||
      !canonicalEquals(outOfCompetitionOutcome, createOutOfCompetitionResult(targetOutcome))) {
    throw new StoredResultRevisionConflict("OOC-beslutet motsäger target eller OOC-revision");
  }
}

export function validateStoredOutOfCompetitionWithdrawal(
  withdrawal: StoredNotCompetingWithdrawal,
  decision: StoredNotCompetingDecision,
  target: StoredResultRevision,
  outOfCompetition: StoredResultRevision,
  expectedLatest: StoredResultRevision,
  source: StoredResultRevision,
  restored: StoredResultRevision
): void {
  validateStoredOutOfCompetition(decision, target, outOfCompetition);
  const sourceOutcome = parseOutOfCompetitionTechnicalRevision(source);
  const restoredOutcome = parseStrictStoredResultRevision(restored);
  const noLaterTechnical = expectedLatest.id === outOfCompetition.id &&
    expectedLatest.revision === outOfCompetition.revision &&
    source.id === target.id && source.revision === target.revision;
  const laterTechnical = expectedLatest.revision > outOfCompetition.revision &&
    expectedLatest.id !== outOfCompetition.id && expectedLatest.id !== target.id &&
    source.id === expectedLatest.id && source.revision === expectedLatest.revision;
  if (withdrawal.notCompetingDecisionId !== decision.id ||
      withdrawal.targetResultRevisionId !== target.id ||
      withdrawal.targetResultRevision !== target.revision ||
      withdrawal.withdrawnResultRevisionId !== outOfCompetition.id ||
      withdrawal.withdrawnResultRevision !== outOfCompetition.revision ||
      withdrawal.expectedLatestResultRevisionId !== expectedLatest.id ||
      withdrawal.expectedLatestResultRevision !== expectedLatest.revision ||
      withdrawal.restoredFromResultRevisionId !== source.id ||
      withdrawal.restoredFromResultRevision !== source.revision ||
      withdrawal.createdResultRevisionId !== restored.id ||
      withdrawal.createdResultRevision !== restored.revision ||
      withdrawal.raceId !== decision.raceId || withdrawal.raceId !== target.raceId ||
      withdrawal.raceId !== outOfCompetition.raceId || withdrawal.raceId !== expectedLatest.raceId ||
      withdrawal.raceId !== source.raceId || withdrawal.raceId !== restored.raceId ||
      withdrawal.entryId !== decision.entryId || withdrawal.entryId !== target.entryId ||
      withdrawal.entryId !== outOfCompetition.entryId || withdrawal.entryId !== expectedLatest.entryId ||
      withdrawal.entryId !== source.entryId || withdrawal.entryId !== restored.entryId ||
      withdrawal.expectedClassId !== sourceOutcome.classId ||
      withdrawal.expectedCourseVersionId !== source.courseVersionId ||
      withdrawal.expectedSnapshotVersion !== source.snapshotVersion ||
      (!noLaterTechnical && !laterTechnical) ||
      withdrawal.createdResultRevision !== withdrawal.expectedLatestResultRevision + 1 ||
      withdrawal.policyVersion !== OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION ||
      withdrawal.reason !== "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" ||
      restored.notCompetingWithdrawalId !== withdrawal.id ||
      restored.cause !== "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" || !restored.published ||
      restored.engineVersion !== withdrawal.policyVersion ||
      restored.courseVersionId !== source.courseVersionId ||
      restored.snapshotVersion !== source.snapshotVersion ||
      !canonicalEquals(restoredOutcome, sourceOutcome)) {
    throw new StoredResultRevisionConflict("OOC-återtagandet motsäger källa eller restaureringsrevision");
  }
}

export function parseDisqualifiableTechnicalRevision(row: StoredResultRevision): DisqualifiableResult {
  const outcome = parseStrictStoredResultRevision(row);
  const technical = row.cause === "CARD_READOUT" ||
    row.cause === "CLASS_CHANGE_RECALCULATION" || row.cause === "EXPLICIT_RECALCULATION" ||
    row.cause === "UNKNOWN_READOUT_RESOLUTION";
  if (!technical || !row.published || (outcome.status !== "OK" && outcome.status !== "MP")) {
    throw new StoredResultRevisionConflict("Resultatrevisionen är inte en publicerad teknisk OK/MP-källa");
  }
  return outcome as DisqualifiableResult;
}

export function parseApprovableTechnicalRevision(row: StoredResultRevision): ManuallyApprovableResult {
  const outcome = parseStrictStoredResultRevision(row);
  const technical = row.cause === "CARD_READOUT" ||
    row.cause === "CLASS_CHANGE_RECALCULATION" || row.cause === "EXPLICIT_RECALCULATION" ||
    row.cause === "UNKNOWN_READOUT_RESOLUTION";
  if (!technical || !row.published || outcome.status !== "MP") {
    throw new StoredResultRevisionConflict("Resultatrevisionen är inte en publicerad teknisk MP-källa");
  }
  // The constructor is the one domain-level place that proves time and split
  // facts are sufficient for a rankable approval.
  createManuallyApprovedResult(outcome);
  return outcome as ManuallyApprovableResult;
}

export function parseDidNotFinishTechnicalRevision(row: StoredResultRevision): StoredDidNotFinishTechnicalOutcome {
  const outcome = parseStrictStoredResultRevision(row);
  const technical = row.cause === "CARD_READOUT" ||
    row.cause === "CLASS_CHANGE_RECALCULATION" || row.cause === "EXPLICIT_RECALCULATION" ||
    row.cause === "UNKNOWN_READOUT_RESOLUTION";
  if (!technical || !row.published || (outcome.status !== "OK" && outcome.status !== "MP")) {
    throw new StoredResultRevisionConflict("Resultatrevisionen är inte en publicerad teknisk OK/MP-källa för DNF");
  }
  createDidNotFinishResult(outcome as EvaluationResult);
  return outcome as StoredDidNotFinishTechnicalOutcome;
}

export function validateStoredDidNotFinish(
  decision: StoredDidNotFinishDecision,
  target: StoredResultRevision,
  didNotFinish: StoredResultRevision
): void {
  const targetOutcome = parseDidNotFinishTechnicalRevision(target);
  const didNotFinishOutcome = parseStrictStoredResultRevision(didNotFinish);
  if (decision.targetResultRevisionId !== target.id || decision.targetResultRevision !== target.revision ||
      decision.createdResultRevisionId !== didNotFinish.id || decision.createdResultRevision !== didNotFinish.revision ||
      decision.raceId !== target.raceId || decision.raceId !== didNotFinish.raceId ||
      decision.entryId !== target.entryId || decision.entryId !== didNotFinish.entryId ||
      decision.expectedClassId !== targetOutcome.classId ||
      decision.expectedCourseVersionId !== target.courseVersionId ||
      decision.expectedSnapshotVersion !== target.snapshotVersion ||
      decision.createdResultRevision !== decision.targetResultRevision + 1 ||
      decision.status !== "DNF" || decision.reason !== "DID_NOT_FINISH" ||
      decision.policyVersion !== DID_NOT_FINISH_DECISION_POLICY_VERSION ||
      didNotFinish.didNotFinishDecisionId !== decision.id || didNotFinish.cause !== "MANUAL_DID_NOT_FINISH" ||
      didNotFinish.status !== "DNF" || didNotFinish.reason !== "DID_NOT_FINISH" || !didNotFinish.published ||
      didNotFinish.engineVersion !== decision.policyVersion ||
      didNotFinish.courseVersionId !== target.courseVersionId ||
      didNotFinish.snapshotVersion !== target.snapshotVersion ||
      !canonicalEquals(didNotFinishOutcome, createDidNotFinishResult(targetOutcome))) {
    throw new StoredResultRevisionConflict("DNF-beslutet motsäger target eller DNF-revision");
  }
}

export function validateStoredDidNotFinishWithdrawal(
  withdrawal: StoredDidNotFinishWithdrawal,
  decision: StoredDidNotFinishDecision,
  target: StoredResultRevision,
  didNotFinish: StoredResultRevision,
  expectedLatest: StoredResultRevision,
  source: StoredResultRevision,
  restored: StoredResultRevision
): void {
  validateStoredDidNotFinish(decision, target, didNotFinish);
  const sourceOutcome = parseDidNotFinishTechnicalRevision(source);
  const restoredOutcome = parseStrictStoredResultRevision(restored);
  const noLaterTechnical = expectedLatest.id === didNotFinish.id &&
    expectedLatest.revision === didNotFinish.revision &&
    source.id === target.id && source.revision === target.revision;
  const laterTechnical = expectedLatest.revision > didNotFinish.revision &&
    expectedLatest.id !== didNotFinish.id && expectedLatest.id !== target.id &&
    source.id === expectedLatest.id &&
    source.revision === expectedLatest.revision;
  if (withdrawal.didNotFinishDecisionId !== decision.id ||
      withdrawal.targetResultRevisionId !== target.id ||
      withdrawal.targetResultRevision !== target.revision ||
      withdrawal.withdrawnResultRevisionId !== didNotFinish.id ||
      withdrawal.withdrawnResultRevision !== didNotFinish.revision ||
      withdrawal.expectedLatestResultRevisionId !== expectedLatest.id ||
      withdrawal.expectedLatestResultRevision !== expectedLatest.revision ||
      withdrawal.restoredFromResultRevisionId !== source.id ||
      withdrawal.restoredFromResultRevision !== source.revision ||
      withdrawal.createdResultRevisionId !== restored.id ||
      withdrawal.createdResultRevision !== restored.revision ||
      withdrawal.raceId !== decision.raceId || withdrawal.raceId !== target.raceId ||
      withdrawal.raceId !== didNotFinish.raceId || withdrawal.raceId !== expectedLatest.raceId ||
      withdrawal.raceId !== source.raceId || withdrawal.raceId !== restored.raceId ||
      withdrawal.entryId !== decision.entryId || withdrawal.entryId !== target.entryId ||
      withdrawal.entryId !== didNotFinish.entryId || withdrawal.entryId !== expectedLatest.entryId ||
      withdrawal.entryId !== source.entryId || withdrawal.entryId !== restored.entryId ||
      withdrawal.expectedClassId !== sourceOutcome.classId ||
      withdrawal.expectedCourseVersionId !== source.courseVersionId ||
      withdrawal.expectedSnapshotVersion !== source.snapshotVersion ||
      (!noLaterTechnical && !laterTechnical) ||
      withdrawal.createdResultRevision !== withdrawal.expectedLatestResultRevision + 1 ||
      withdrawal.policyVersion !== DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION ||
      withdrawal.reason !== "ERRONEOUS_MANUAL_DID_NOT_FINISH" ||
      restored.didNotFinishWithdrawalId !== withdrawal.id ||
      restored.cause !== "MANUAL_DID_NOT_FINISH_WITHDRAWAL" || !restored.published ||
      restored.engineVersion !== withdrawal.policyVersion ||
      restored.courseVersionId !== source.courseVersionId ||
      restored.snapshotVersion !== source.snapshotVersion ||
      !canonicalEquals(restoredOutcome, sourceOutcome)) {
    throw new StoredResultRevisionConflict("DNF-återtagandet motsäger källa eller restaureringsrevision");
  }
}

export function validateStoredDisqualification(
  decision: StoredResultDisqualificationDecision,
  target: StoredResultRevision,
  disqualified: StoredResultRevision
): void {
  const targetOutcome = parseDisqualifiableTechnicalRevision(target);
  const disqualifiedOutcome = parseStrictStoredResultRevision(disqualified);
  if (decision.targetResultRevisionId !== target.id ||
      decision.targetResultRevision !== target.revision ||
      decision.createdResultRevisionId !== disqualified.id ||
      decision.createdResultRevision !== disqualified.revision ||
      decision.raceId !== target.raceId || decision.raceId !== disqualified.raceId ||
      decision.entryId !== target.entryId || decision.entryId !== disqualified.entryId ||
      disqualified.disqualificationDecisionId !== decision.id ||
      decision.status !== "DSQ" || decision.reason !== "MANUAL_DISQUALIFICATION" ||
      disqualified.status !== "DSQ" || disqualified.reason !== "MANUAL_DISQUALIFICATION" ||
      !disqualified.published ||
      disqualified.courseVersionId !== target.courseVersionId ||
      disqualified.snapshotVersion !== target.snapshotVersion ||
      !canonicalEquals(disqualifiedOutcome, createDisqualifiedResult(targetOutcome))) {
    throw new StoredResultRevisionConflict("Diskvalifikationsbeslutet motsäger target eller DSQ-revision");
  }
}

export function validateStoredDisqualificationWithdrawal(
  withdrawal: StoredResultDisqualificationWithdrawal,
  decision: StoredResultDisqualificationDecision,
  source: StoredResultRevision,
  restored: StoredResultRevision
): void {
  const sourceOutcome = parseDisqualifiableTechnicalRevision(source);
  const restoredOutcome = parseStrictStoredResultRevision(restored);
  if (withdrawal.disqualificationDecisionId !== decision.id ||
      withdrawal.withdrawnResultRevisionId !== decision.createdResultRevisionId ||
      withdrawal.withdrawnResultRevision !== decision.createdResultRevision ||
      withdrawal.restoredFromResultRevisionId !== source.id ||
      withdrawal.restoredFromResultRevision !== source.revision ||
      withdrawal.createdResultRevisionId !== restored.id ||
      withdrawal.createdResultRevision !== restored.revision ||
      withdrawal.raceId !== decision.raceId || withdrawal.raceId !== source.raceId ||
      withdrawal.raceId !== restored.raceId ||
      withdrawal.entryId !== decision.entryId || withdrawal.entryId !== source.entryId ||
      withdrawal.entryId !== restored.entryId ||
      restored.disqualificationWithdrawalId !== withdrawal.id ||
      restored.cause !== "MANUAL_DISQUALIFICATION_WITHDRAWAL" || !restored.published ||
      restored.courseVersionId !== source.courseVersionId ||
      restored.snapshotVersion !== source.snapshotVersion ||
      !canonicalEquals(restoredOutcome, sourceOutcome)) {
    throw new StoredResultRevisionConflict("Återtagandet motsäger källan eller restaureringsrevisionen");
  }
}

export function validateStoredApproval(
  decision: StoredResultApprovalDecision,
  target: StoredResultRevision,
  approved: StoredResultRevision
): void {
  const targetOutcome = parseApprovableTechnicalRevision(target);
  const approvedOutcome = parseStrictStoredResultRevision(approved);
  if (decision.targetResultRevisionId !== target.id || decision.targetResultRevision !== target.revision ||
      decision.createdResultRevisionId !== approved.id || decision.createdResultRevision !== approved.revision ||
      decision.raceId !== target.raceId || decision.raceId !== approved.raceId ||
      decision.entryId !== target.entryId || decision.entryId !== approved.entryId ||
      decision.expectedClassId !== targetOutcome.classId ||
      decision.expectedCourseVersionId !== target.courseVersionId ||
      decision.expectedSnapshotVersion !== target.snapshotVersion ||
      decision.createdResultRevision !== decision.targetResultRevision + 1 ||
      approved.approvalDecisionId !== decision.id || approved.cause !== "MANUAL_RESULT_APPROVAL" ||
      approved.status !== "OK" || approved.reason !== "MANUAL_APPROVAL" || !approved.published ||
      approved.courseVersionId !== target.courseVersionId || approved.snapshotVersion !== target.snapshotVersion ||
      !canonicalEquals(approvedOutcome, createManuallyApprovedResult(targetOutcome))) {
    throw new StoredResultRevisionConflict("Godkännandebeslutet motsäger target eller approval-revision");
  }
}

export function validateStoredApprovalWithdrawal(
  withdrawal: StoredResultApprovalWithdrawal,
  decision: StoredResultApprovalDecision,
  expectedLatest: StoredResultRevision,
  source: StoredResultRevision,
  restored: StoredResultRevision
): void {
  const sourceOutcome = parseDisqualifiableTechnicalRevision(source);
  const restoredOutcome = parseStrictStoredResultRevision(restored);
  if (withdrawal.approvalDecisionId !== decision.id ||
      withdrawal.withdrawnResultRevisionId !== decision.createdResultRevisionId ||
      withdrawal.withdrawnResultRevision !== decision.createdResultRevision ||
      withdrawal.expectedLatestResultRevisionId !== expectedLatest.id ||
      withdrawal.expectedLatestResultRevision !== expectedLatest.revision ||
      withdrawal.restoredFromResultRevisionId !== source.id ||
      withdrawal.restoredFromResultRevision !== source.revision ||
      withdrawal.createdResultRevisionId !== restored.id ||
      withdrawal.createdResultRevision !== restored.revision ||
      withdrawal.raceId !== decision.raceId || withdrawal.raceId !== expectedLatest.raceId ||
      withdrawal.raceId !== source.raceId || withdrawal.raceId !== restored.raceId ||
      withdrawal.entryId !== decision.entryId || withdrawal.entryId !== expectedLatest.entryId ||
      withdrawal.entryId !== source.entryId || withdrawal.entryId !== restored.entryId ||
      withdrawal.restoredFromResultRevision > withdrawal.expectedLatestResultRevision ||
      withdrawal.createdResultRevision !== withdrawal.expectedLatestResultRevision + 1 ||
      restored.approvalWithdrawalId !== withdrawal.id ||
      restored.cause !== "MANUAL_RESULT_APPROVAL_WITHDRAWAL" || !restored.published ||
      restored.courseVersionId !== source.courseVersionId || restored.snapshotVersion !== source.snapshotVersion ||
      !canonicalEquals(restoredOutcome, sourceOutcome)) {
    throw new StoredResultRevisionConflict("Godkännandeåtertagandet motsäger källa eller restaureringsrevision");
  }
}
