import { Buffer } from "node:buffer";
import { and, asc, desc, eq, gt, inArray, lt, lte, max, or, sql } from "drizzle-orm";
import {
  readoutHistoryDetailResponseSchema,
  readoutHistoryListResponseSchema,
  serverResultSummarySchema,
  type ReadoutHistoryDetailResponse,
  type ReadoutHistoryListResponse,
  type ServerResultSummary
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import {
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { parseStrictStoredResultRevision, StoredResultRevisionConflict,
  type StoredManualFinishTimeCorrectionProof, type StoredManualFinishTimeCorrectionWithdrawalProof,
  type StoredManualPunchStartTimeCorrectionProof, type StoredManualPunchStartTimeCorrectionWithdrawalProof,
  type StoredShortenedCourseClassTransferProof } from "./stored-result-revision";
import { loadStoredStartCheckinDnsStates } from "./start-checkin-dns-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,1024}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

interface ListCursor {
  v: 2;
  raceId: string;
  receivedAt: string;
  readoutId: string;
}

interface DetailCursor {
  v: 1;
  raceId: string;
  readoutId: string;
  upperRevision: number;
  afterRevision: number;
}

function encodeCursor(value: ListCursor | DetailCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string): unknown {
  if (!CURSOR_PATTERN.test(value)) throw new Error("invalid cursor");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) throw new Error("invalid cursor");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseListCursor(value: string | undefined, raceId: string): ListCursor | undefined {
  if (value === undefined) return undefined;
  const parsed = record(decodeCursor(value));
  if (!parsed || Object.keys(parsed).sort().join(",") !== "raceId,readoutId,receivedAt,v" ||
      parsed.v !== 2 || parsed.raceId !== raceId || typeof parsed.receivedAt !== "string" ||
      !INSTANT_PATTERN.test(parsed.receivedAt) || !UUID_PATTERN.test(String(parsed.readoutId))) {
    throw new Error("invalid cursor");
  }
  const receivedAt = new Date(parsed.receivedAt);
  if (!Number.isFinite(receivedAt.getTime()) || receivedAt.toISOString() !== `${parsed.receivedAt.slice(0, 23)}Z`) throw new Error("invalid cursor");
  return { v: 2, raceId, receivedAt: parsed.receivedAt, readoutId: String(parsed.readoutId) };
}

function parseDetailCursor(value: string | undefined, raceId: string, readoutId: string): DetailCursor | undefined {
  if (value === undefined) return undefined;
  const parsed = record(decodeCursor(value));
  if (!parsed || Object.keys(parsed).sort().join(",") !== "afterRevision,raceId,readoutId,upperRevision,v" ||
      parsed.v !== 1 || parsed.raceId !== raceId || parsed.readoutId !== readoutId ||
      !Number.isSafeInteger(parsed.upperRevision) || !Number.isSafeInteger(parsed.afterRevision) ||
      Number(parsed.upperRevision) < 1 || Number(parsed.afterRevision) < 0 ||
      Number(parsed.afterRevision) >= Number(parsed.upperRevision)) {
    throw new Error("invalid cursor");
  }
  return {
    v: 1, raceId, readoutId,
    upperRevision: Number(parsed.upperRevision),
    afterRevision: Number(parsed.afterRevision)
  };
}

function assessment(value: Record<string, unknown> | null): ServerResultSummary | null {
  if (value === null) return null;
  const parsed = serverResultSummarySchema.safeParse(value);
  if (!parsed.success) throw new Error("Ogiltigt bevarat serverutfall");
  return parsed.data;
}

function publicAssessment(value: ServerResultSummary | null) {
  if (value === null) return null;
  return {
    status: value.status,
    reason: value.reason,
    engineVersion: value.engineVersion,
    snapshotVersion: value.snapshotVersion,
    courseVersionId: value.status === "UNKNOWN_CARD" ? null : value.courseVersionId
  };
}

function validLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) throw new Error("invalid limit");
  return value;
}

export type ReadoutHistoryListResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" }
  | { status: "ok"; response: ReadoutHistoryListResponse };

export async function listReadoutHistoryAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf"> & {
    cursor?: string;
    limit: number;
  },
  now = new Date()
): Promise<ReadoutHistoryListResult> {
  let cursor: ListCursor | undefined;
  let limit: number;
  try {
    cursor = parseListCursor(input.cursor, input.raceId);
    limit = validLimit(input.limit);
  } catch {
    return { status: "invalid-request" };
  }
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      sessionToken: input.sessionToken,
      raceId: input.raceId,
      capability: "VIEW_READOUT_RESULT_HISTORY"
    }, now);
    if (authorization.status !== "authenticated") return authorization;

    const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
      .where(eq(schema.races.id, authorization.principal.raceId)).for("share");
    if (!race) return { status: "not-found" } as const;

    const seek = cursor === undefined ? undefined : or(
      lt(schema.rawDeviceMessages.serverReceivedAt, sql`${cursor.receivedAt}::timestamptz`),
      and(
        eq(schema.rawDeviceMessages.serverReceivedAt, sql`${cursor.receivedAt}::timestamptz`),
        lt(schema.cardReadouts.id, cursor.readoutId)
      )
    );
    const rows = await tx.select({
      id: schema.cardReadouts.id,
      readAt: schema.cardReadouts.readAt,
      cardNumber: schema.cardReadouts.cardNumber,
      serverReceivedAt: sql<string>`to_char(${schema.rawDeviceMessages.serverReceivedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      serverResult: schema.deviceIngestOutcomes.serverResult
    }).from(schema.cardReadouts)
      .innerJoin(schema.rawDeviceMessages, eq(schema.cardReadouts.rawMessageId, schema.rawDeviceMessages.id))
      .leftJoin(schema.deviceIngestOutcomes, eq(schema.cardReadouts.rawMessageId, schema.deviceIngestOutcomes.rawMessageId))
      .where(and(eq(schema.cardReadouts.raceId, race.id), seek))
      .orderBy(desc(schema.rawDeviceMessages.serverReceivedAt), desc(schema.cardReadouts.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const parsedAssessments = page.map((row) => assessment(row.serverResult));
    const initialRevisionIds = parsedAssessments.flatMap((value) =>
      value && value.status !== "UNKNOWN_CARD" ? [value.resultRevisionId] : []
    );
    const identities = initialRevisionIds.length === 0 ? [] : await tx.select({
      revisionId: schema.resultRevisions.id,
      entryId: schema.entries.id,
      givenName: schema.entries.givenName,
      familyName: schema.entries.familyName
    }).from(schema.resultRevisions)
      .innerJoin(schema.entries, eq(schema.resultRevisions.entryId, schema.entries.id))
      .where(and(
        eq(schema.resultRevisions.raceId, race.id),
        inArray(schema.resultRevisions.id, initialRevisionIds)
      ));
    const identityByRevision = new Map(identities.map((identity) => [identity.revisionId, {
      id: identity.entryId,
      displayName: `${identity.givenName} ${identity.familyName}`
    }]));

    const last = page.at(-1);
    const response = readoutHistoryListResponseSchema.parse({
      formatVersion: 10,
      raceId: race.id,
      items: page.map((row, index) => {
        const value = parsedAssessments[index] ?? null;
        return {
          id: row.id,
          readAt: row.readAt.toISOString(),
          cardNumber: row.cardNumber,
          entry: value && value.status !== "UNKNOWN_CARD"
            ? identityByRevision.get(value.resultRevisionId) ?? null
            : null,
          firstServerAssessment: publicAssessment(value)
        };
      }),
      nextCursor: rows.length > limit && last ? encodeCursor({
        v: 2, raceId: race.id, receivedAt: last.serverReceivedAt, readoutId: last.id
      }) : null
    });
    return { status: "ok", response } as const;
  }, { isolationLevel: "repeatable read" });
}

export type ReadoutHistoryDetailResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" }
  | { status: "ok"; response: ReadoutHistoryDetailResponse };

export async function getReadoutHistoryAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf"> & {
    readoutId: string;
    cursor?: string;
    limit: number;
  },
  now = new Date()
): Promise<ReadoutHistoryDetailResult> {
  if (!UUID_PATTERN.test(input.readoutId)) return { status: "invalid-request" };
  let cursor: DetailCursor | undefined;
  let limit: number;
  try {
    cursor = parseDetailCursor(input.cursor, input.raceId, input.readoutId);
    limit = validLimit(input.limit);
  } catch {
    return { status: "invalid-request" };
  }

  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      sessionToken: input.sessionToken,
      raceId: input.raceId,
      capability: "VIEW_READOUT_RESULT_HISTORY"
    }, now);
    if (authorization.status !== "authenticated") return authorization;
    const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
      .where(eq(schema.races.id, authorization.principal.raceId)).for("share");
    if (!race) return { status: "not-found" } as const;

    const [readout] = await tx.select({
      id: schema.cardReadouts.id,
      cardNumber: schema.cardReadouts.cardNumber,
      readAt: schema.cardReadouts.readAt,
      startPunchedAt: schema.cardReadouts.startPunchedAt,
      finishPunchedAt: schema.cardReadouts.finishPunchedAt,
      punches: schema.cardReadouts.punches,
      serverResult: schema.deviceIngestOutcomes.serverResult
    }).from(schema.cardReadouts)
      .leftJoin(schema.deviceIngestOutcomes, eq(schema.cardReadouts.rawMessageId, schema.deviceIngestOutcomes.rawMessageId))
      .where(and(eq(schema.cardReadouts.id, input.readoutId), eq(schema.cardReadouts.raceId, race.id)));
    if (!readout) return { status: "not-found" } as const;
    const firstAssessment = assessment(readout.serverResult);

    const [initialRevision] = await tx.select({
      entryId: schema.resultRevisions.entryId,
      givenName: schema.entries.givenName,
      familyName: schema.entries.familyName
    }).from(schema.resultRevisions)
      .innerJoin(schema.entries, eq(schema.resultRevisions.entryId, schema.entries.id))
      .where(and(
        eq(schema.resultRevisions.raceId, race.id),
        eq(schema.resultRevisions.readoutId, readout.id),
        eq(schema.resultRevisions.cause, "CARD_READOUT")
      ))
      .orderBy(asc(schema.resultRevisions.revision), asc(schema.resultRevisions.id))
      .limit(1);

    if (!initialRevision) {
      const response = readoutHistoryDetailResponseSchema.parse({
        formatVersion: 12,
        raceId: race.id,
        readout: {
          id: readout.id,
          cardNumber: readout.cardNumber,
          readAt: readout.readAt.toISOString(),
          startPunchedAt: readout.startPunchedAt?.toISOString() ?? null,
          finishPunchedAt: readout.finishPunchedAt?.toISOString() ?? null,
          punches: readout.punches
        },
        firstServerAssessment: publicAssessment(firstAssessment),
        entry: null,
        history: { upperRevision: 0, items: [], nextCursor: null }
      });
      return { status: "ok", response } as const;
    }

    const upperRevision = cursor?.upperRevision ?? (await tx.select({ value: max(schema.resultRevisions.revision) })
      .from(schema.resultRevisions)
      .where(and(
        eq(schema.resultRevisions.raceId, race.id),
        eq(schema.resultRevisions.entryId, initialRevision.entryId)
      )))[0]?.value ?? 0;
    if (upperRevision < 1) throw new Error("Deltagaren saknar resultatrevision");
    const afterRevision = cursor?.afterRevision ?? 0;
    const revisions = await tx.select({
      id: schema.resultRevisions.id,
      raceId: schema.resultRevisions.raceId,
      entryId: schema.resultRevisions.entryId,
      revision: schema.resultRevisions.revision,
      readoutId: schema.resultRevisions.readoutId,
      didNotStartDecisionId: schema.resultRevisions.didNotStartDecisionId,
      startCheckinDnsDecisionId: schema.resultRevisions.startCheckinDnsDecisionId,
      controlNeutralizationId: schema.resultRevisions.controlNeutralizationId,
      disqualificationDecisionId: schema.resultRevisions.disqualificationDecisionId,
      disqualificationWithdrawalId: schema.resultRevisions.disqualificationWithdrawalId,
      approvalDecisionId: schema.resultRevisions.approvalDecisionId,
      approvalWithdrawalId: schema.resultRevisions.approvalWithdrawalId,
      didNotFinishDecisionId: schema.resultRevisions.didNotFinishDecisionId,
      didNotFinishWithdrawalId: schema.resultRevisions.didNotFinishWithdrawalId,
      notCompetingDecisionId: schema.resultRevisions.notCompetingDecisionId,
      notCompetingWithdrawalId: schema.resultRevisions.notCompetingWithdrawalId,
      withoutTimingDecisionId: schema.resultRevisions.withoutTimingDecisionId,
      withoutTimingWithdrawalId: schema.resultRevisions.withoutTimingWithdrawalId,
      manualFinishTimeCorrectionId: schema.resultRevisions.manualFinishTimeCorrectionId,
      manualFinishTimeCorrectionWithdrawalId: schema.resultRevisions.manualFinishTimeCorrectionWithdrawalId,
      manualPunchStartTimeCorrectionId: schema.resultRevisions.manualPunchStartTimeCorrectionId,
      manualPunchStartTimeCorrectionWithdrawalId: schema.resultRevisions.manualPunchStartTimeCorrectionWithdrawalId,
      shortenedCourseClassTransferId: schema.resultRevisions.shortenedCourseClassTransferId,
      cause: schema.resultRevisions.cause,
      status: schema.resultRevisions.status,
      reason: schema.resultRevisions.reason,
      engineVersion: schema.resultRevisions.engineVersion,
      snapshotVersion: schema.resultRevisions.snapshotVersion,
      courseVersionId: schema.resultRevisions.courseVersionId,
      published: schema.resultRevisions.published,
      createdAt: schema.resultRevisions.createdAt,
      evaluation: schema.resultRevisions.evaluation
    }).from(schema.resultRevisions)
      .where(and(
        eq(schema.resultRevisions.raceId, race.id),
        eq(schema.resultRevisions.entryId, initialRevision.entryId),
        gt(schema.resultRevisions.revision, afterRevision),
        lte(schema.resultRevisions.revision, upperRevision)
      ))
      .orderBy(asc(schema.resultRevisions.revision), asc(schema.resultRevisions.id))
      .limit(limit + 1);
    const decisionIds = revisions.flatMap((revision) =>
      revision.disqualificationDecisionId === null ? [] : [revision.disqualificationDecisionId]
    );
    const withdrawalIds = revisions.flatMap((revision) =>
      revision.disqualificationWithdrawalId === null ? [] : [revision.disqualificationWithdrawalId]
    );
    const approvalDecisionIds = revisions.flatMap((revision) =>
      revision.approvalDecisionId === null ? [] : [revision.approvalDecisionId]
    );
    const approvalWithdrawalIds = revisions.flatMap((revision) =>
      revision.approvalWithdrawalId === null ? [] : [revision.approvalWithdrawalId]
    );
    const didNotFinishDecisionIds = revisions.flatMap((revision) =>
      revision.didNotFinishDecisionId === null ? [] : [revision.didNotFinishDecisionId]
    );
    const didNotFinishWithdrawalIds = revisions.flatMap((revision) =>
      revision.didNotFinishWithdrawalId === null ? [] : [revision.didNotFinishWithdrawalId]
    );
    const notCompetingDecisionIds = revisions.flatMap((revision) =>
      revision.notCompetingDecisionId === null ? [] : [revision.notCompetingDecisionId]
    );
    const notCompetingWithdrawalIds = revisions.flatMap((revision) =>
      revision.notCompetingWithdrawalId === null ? [] : [revision.notCompetingWithdrawalId]
    );
    const withoutTimingDecisionIds = revisions.flatMap((revision) =>
      revision.withoutTimingDecisionId === null ? [] : [revision.withoutTimingDecisionId]
    );
    const withoutTimingWithdrawalIds = revisions.flatMap((revision) =>
      revision.withoutTimingWithdrawalId === null ? [] : [revision.withoutTimingWithdrawalId]
    );
    const [
      withdrawals,
      approvalWithdrawals,
      didNotFinishWithdrawals,
      notCompetingWithdrawals,
      withoutTimingWithdrawals
    ] = await Promise.all([
      withdrawalIds.length === 0 ? Promise.resolve([]) : tx.select()
        .from(schema.resultDisqualificationWithdrawals)
        .where(inArray(schema.resultDisqualificationWithdrawals.id, withdrawalIds)),
      approvalWithdrawalIds.length === 0 ? Promise.resolve([]) : tx.select()
        .from(schema.resultApprovalWithdrawals)
        .where(inArray(schema.resultApprovalWithdrawals.id, approvalWithdrawalIds)),
      didNotFinishWithdrawalIds.length === 0 ? Promise.resolve([]) : tx.select()
        .from(schema.didNotFinishWithdrawals)
        .where(inArray(schema.didNotFinishWithdrawals.id, didNotFinishWithdrawalIds)),
      notCompetingWithdrawalIds.length === 0 ? Promise.resolve([]) : tx.select()
        .from(schema.notCompetingWithdrawals)
        .where(inArray(schema.notCompetingWithdrawals.id, notCompetingWithdrawalIds)),
      withoutTimingWithdrawalIds.length === 0 ? Promise.resolve([]) : tx.select()
        .from(schema.withoutTimingWithdrawals)
        .where(inArray(schema.withoutTimingWithdrawals.id, withoutTimingWithdrawalIds))
    ]);
    const allDecisionIds = [...new Set([
      ...decisionIds,
      ...withdrawals.map((withdrawal) => withdrawal.disqualificationDecisionId)
    ])];
    const decisions = allDecisionIds.length === 0 ? [] : await tx.select()
      .from(schema.resultDisqualificationDecisions)
      .where(inArray(schema.resultDisqualificationDecisions.id, allDecisionIds));
    const allApprovalDecisionIds = [...new Set([
      ...approvalDecisionIds,
      ...approvalWithdrawals.map((withdrawal) => withdrawal.approvalDecisionId)
    ])];
    const approvalDecisions = allApprovalDecisionIds.length === 0 ? [] : await tx.select()
      .from(schema.resultApprovalDecisions)
      .where(inArray(schema.resultApprovalDecisions.id, allApprovalDecisionIds));
    const allDidNotFinishDecisionIds = [...new Set([
      ...didNotFinishDecisionIds,
      ...didNotFinishWithdrawals.map((withdrawal) => withdrawal.didNotFinishDecisionId)
    ])];
    const didNotFinishDecisions = allDidNotFinishDecisionIds.length === 0 ? [] : await tx.select()
      .from(schema.didNotFinishDecisions)
      .where(inArray(schema.didNotFinishDecisions.id, allDidNotFinishDecisionIds));
    const allNotCompetingDecisionIds = [...new Set([
      ...notCompetingDecisionIds,
      ...notCompetingWithdrawals.map((withdrawal) => withdrawal.notCompetingDecisionId)
    ])];
    const notCompetingDecisions = allNotCompetingDecisionIds.length === 0 ? [] : await tx.select()
      .from(schema.notCompetingDecisions)
      .where(inArray(schema.notCompetingDecisions.id, allNotCompetingDecisionIds));
    const allWithoutTimingDecisionIds = [...new Set([
      ...withoutTimingDecisionIds,
      ...withoutTimingWithdrawals.map((withdrawal) => withdrawal.withoutTimingDecisionId)
    ])];
    const withoutTimingDecisions = allWithoutTimingDecisionIds.length === 0 ? [] : await tx.select()
      .from(schema.withoutTimingDecisions)
      .where(inArray(schema.withoutTimingDecisions.id, allWithoutTimingDecisionIds));
    const decisionById = new Map(decisions.map((decision) => [decision.id, decision]));
    const withdrawalById = new Map(withdrawals.map((withdrawal) => [withdrawal.id, withdrawal]));
    const approvalDecisionById = new Map(approvalDecisions.map((decision) => [decision.id, decision]));
    const approvalWithdrawalById = new Map(approvalWithdrawals.map((withdrawal) => [withdrawal.id, withdrawal]));
    const didNotFinishDecisionById = new Map(didNotFinishDecisions.map((decision) => [decision.id, decision]));
    const didNotFinishWithdrawalById = new Map(
      didNotFinishWithdrawals.map((withdrawal) => [withdrawal.id, withdrawal])
    );
    const notCompetingDecisionById = new Map(
      notCompetingDecisions.map((decision) => [decision.id, decision])
    );
    const notCompetingWithdrawalById = new Map(
      notCompetingWithdrawals.map((withdrawal) => [withdrawal.id, withdrawal])
    );
    const withoutTimingDecisionById = new Map(
      withoutTimingDecisions.map((decision) => [decision.id, decision])
    );
    const withoutTimingWithdrawalById = new Map(
      withoutTimingWithdrawals.map((withdrawal) => [withdrawal.id, withdrawal])
    );
    const correctionRows = revisions.length === 0 ? [] : await tx.select().from(schema.manualFinishTimeCorrections)
      .where(and(eq(schema.manualFinishTimeCorrections.raceId, race.id),
        inArray(schema.manualFinishTimeCorrections.createdResultRevisionId, revisions.map((revision) => revision.id))));
    if (new Set(correctionRows.map((correction) => correction.createdResultRevisionId)).size !== correctionRows.length) {
      throw new StoredResultRevisionConflict("Resultathistoriken har flera måltidsrättningar för samma revision");
    }
    const correctionWithdrawalRows = revisions.length === 0 ? [] : await tx.select().from(schema.manualFinishTimeCorrectionWithdrawals)
      .where(and(eq(schema.manualFinishTimeCorrectionWithdrawals.raceId, race.id),
        inArray(schema.manualFinishTimeCorrectionWithdrawals.createdResultRevisionId, revisions.map((revision) => revision.id))));
    if (new Set(correctionWithdrawalRows.map((withdrawal) => withdrawal.createdResultRevisionId)).size !== correctionWithdrawalRows.length) {
      throw new StoredResultRevisionConflict("Resultathistoriken har flera återtaganden för samma måltidsrättning");
    }
    const punchStartCorrectionRows = revisions.length === 0 ? [] : await tx.select().from(schema.manualPunchStartTimeCorrections)
      .where(and(eq(schema.manualPunchStartTimeCorrections.raceId, race.id),
        inArray(schema.manualPunchStartTimeCorrections.createdResultRevisionId, revisions.map((revision) => revision.id))));
    if (new Set(punchStartCorrectionRows.map((correction) => correction.createdResultRevisionId)).size !== punchStartCorrectionRows.length) {
      throw new StoredResultRevisionConflict("Resultathistoriken har flera starttidsrättningar för samma revision");
    }
    const punchStartCorrectionWithdrawalRows = revisions.length === 0 ? [] : await tx.select().from(schema.manualPunchStartTimeCorrectionWithdrawals)
      .where(and(eq(schema.manualPunchStartTimeCorrectionWithdrawals.raceId, race.id),
        inArray(schema.manualPunchStartTimeCorrectionWithdrawals.createdResultRevisionId, revisions.map((revision) => revision.id))));
    if (new Set(punchStartCorrectionWithdrawalRows.map((withdrawal) => withdrawal.createdResultRevisionId)).size !== punchStartCorrectionWithdrawalRows.length) {
      throw new StoredResultRevisionConflict("Resultathistoriken har flera återtaganden för samma starträttning");
    }
    const withdrawalCorrectionIds = correctionWithdrawalRows.map((withdrawal) => withdrawal.correctionId);
    const withdrawalCorrections = withdrawalCorrectionIds.length === 0 ? [] : await tx.select().from(schema.manualFinishTimeCorrections)
      .where(inArray(schema.manualFinishTimeCorrections.requestId, withdrawalCorrectionIds));
    const punchStartWithdrawalCorrectionIds = punchStartCorrectionWithdrawalRows.map((withdrawal) => withdrawal.correctionId);
    const punchStartWithdrawalCorrections = punchStartWithdrawalCorrectionIds.length === 0 ? [] : await tx.select().from(schema.manualPunchStartTimeCorrections)
      .where(inArray(schema.manualPunchStartTimeCorrections.requestId, punchStartWithdrawalCorrectionIds));
    const correctionSourceIds = [...correctionRows.map((correction) => correction.sourceResultRevisionId),
      ...punchStartCorrectionRows.map((correction) => correction.sourceResultRevisionId),
      ...punchStartWithdrawalCorrections.map((correction) => correction.sourceResultRevisionId),
      ...correctionWithdrawalRows.map((withdrawal) => withdrawal.sourceResultRevisionId),
      ...correctionWithdrawalRows.map((withdrawal) => withdrawal.correctedResultRevisionId),
      ...punchStartCorrectionWithdrawalRows.map((withdrawal) => withdrawal.sourceResultRevisionId),
      ...punchStartCorrectionWithdrawalRows.map((withdrawal) => withdrawal.correctedResultRevisionId)];
    const correctionSources = correctionSourceIds.length === 0 ? [] : await tx.select().from(schema.resultRevisions)
      .where(inArray(schema.resultRevisions.id, [...new Set(correctionSourceIds)]));
    const correctionSourceById = new Map(correctionSources.map((source) => [source.id, source]));
    const correctionByCreatedId = new Map(correctionRows.map((correction) => [correction.createdResultRevisionId, correction]));
    const punchStartCorrectionByCreatedId = new Map(punchStartCorrectionRows.map((correction) => [correction.createdResultRevisionId, correction]));
    const punchStartWithdrawalByCreatedId = new Map(punchStartCorrectionWithdrawalRows.map((withdrawal) => [withdrawal.createdResultRevisionId, withdrawal]));
    const correctionWithdrawalByCreatedId = new Map(correctionWithdrawalRows.map((withdrawal) => [withdrawal.createdResultRevisionId, withdrawal]));
    const correctionById = new Map([...correctionRows, ...withdrawalCorrections].map((correction) => [correction.requestId, correction]));
    const punchStartCorrectionById = new Map([...punchStartCorrectionRows, ...punchStartWithdrawalCorrections].map((correction) => [correction.requestId, correction]));
    const punchStartReadoutIds = [...punchStartCorrectionRows, ...punchStartWithdrawalCorrections].map((correction) => correction.sourceReadoutId);
    const punchStartReadouts = punchStartReadoutIds.length === 0 ? [] : await tx.select({ id: schema.cardReadouts.id,
      startPunchedAt: schema.cardReadouts.startPunchedAt }).from(schema.cardReadouts)
      .where(inArray(schema.cardReadouts.id, punchStartReadoutIds));
    const punchStartReadoutById = new Map(punchStartReadouts.map((readout) => [readout.id, readout]));
    const shortenedTransferItems = revisions.length === 0 ? [] : await tx.select().from(schema.shortenedCourseClassTransferItems)
      .where(and(eq(schema.shortenedCourseClassTransferItems.raceId, race.id),
        inArray(schema.shortenedCourseClassTransferItems.createdResultRevisionId, revisions.map((revision) => revision.id))));
    if (new Set(shortenedTransferItems.map((item) => item.createdResultRevisionId)).size !== shortenedTransferItems.length) {
      throw new StoredResultRevisionConflict("Resultathistoriken har flera kortbaneitem för samma revision");
    }
    const shortenedTransferIds = [...new Set(shortenedTransferItems.map((item) => item.requestId))];
    const shortenedTransfers = shortenedTransferIds.length === 0 ? [] : await tx.select().from(schema.shortenedCourseClassTransfers)
      .where(inArray(schema.shortenedCourseClassTransfers.requestId, shortenedTransferIds));
    if (shortenedTransfers.length !== shortenedTransferIds.length) {
      throw new StoredResultRevisionConflict("Resultathistorikens kortbanehuvud saknas");
    }
    const shortenedSourceIds = shortenedTransferItems.flatMap((item) => item.sourceResultRevisionId === null ? [] : [item.sourceResultRevisionId]);
    const shortenedSources = shortenedSourceIds.length === 0 ? [] : await tx.select().from(schema.resultRevisions)
      .where(inArray(schema.resultRevisions.id, shortenedSourceIds));
    const shortenedItemByCreatedId = new Map(shortenedTransferItems.map((item) => [item.createdResultRevisionId, item]));
    const shortenedTransferById = new Map(shortenedTransfers.map((transfer) => [transfer.requestId, transfer]));
    const shortenedSourceById = new Map(shortenedSources.map((source) => [source.id, source]));
    const checkinStates = await loadStoredStartCheckinDnsStates(tx, race.id, [initialRevision.entryId]);
    const page = revisions.slice(0, limit).map((revision) => {
      const checkin = checkinStates.get(revision.id);
      const correction = correctionByCreatedId.get(revision.id);
      const correctionWithdrawal = correctionWithdrawalByCreatedId.get(revision.id);
      const punchStartCorrection = punchStartCorrectionByCreatedId.get(revision.id);
      const punchStartCorrectionWithdrawal = punchStartWithdrawalByCreatedId.get(revision.id);
      let correctionProof: StoredManualFinishTimeCorrectionProof | undefined;
      if (revision.cause === "MANUAL_FINISH_TIME_CORRECTION") {
        if (!correction || revision.manualFinishTimeCorrectionId !== correction.requestId) {
          throw new StoredResultRevisionConflict("Måltidsrättningens journal saknas eller motsäger revisionen");
        }
        const source = correctionSourceById.get(correction.sourceResultRevisionId);
        if (!source) throw new StoredResultRevisionConflict("Måltidsrättningens källrevision saknas");
        correctionProof = { correction, source, corrected: revision };
      } else if (correction) {
        throw new StoredResultRevisionConflict("Måltidsrättningens journal pekar på fel revisionsorsak");
      }
      let correctionWithdrawalProof: StoredManualFinishTimeCorrectionWithdrawalProof | undefined;
      if (revision.cause === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL") {
        if (!correctionWithdrawal || revision.manualFinishTimeCorrectionWithdrawalId !== correctionWithdrawal.id) {
          throw new StoredResultRevisionConflict("Måltidsrättningens återtagande saknas eller motsäger revisionen");
        }
        const source = correctionSourceById.get(correctionWithdrawal.sourceResultRevisionId);
        const corrected = correctionSourceById.get(correctionWithdrawal.correctedResultRevisionId);
        const originalCorrection = correctionById.get(correctionWithdrawal.correctionId);
        if (!source || !corrected || !originalCorrection) throw new StoredResultRevisionConflict("Måltidsrättningens återtagandekedja saknas");
        correctionWithdrawalProof = { withdrawal: correctionWithdrawal, correction: originalCorrection, source, corrected, restored: revision };
      } else if (correctionWithdrawal) {
        throw new StoredResultRevisionConflict("Måltidsrättningens återtagande pekar på fel revisionsorsak");
      }
      let punchStartCorrectionProof: StoredManualPunchStartTimeCorrectionProof | undefined;
      if (revision.cause === "MANUAL_PUNCH_START_TIME_CORRECTION") {
        if (!punchStartCorrection || revision.manualPunchStartTimeCorrectionId !== punchStartCorrection.requestId) {
          throw new StoredResultRevisionConflict("Starttidsrättningens journal saknas eller motsäger revisionen");
        }
        const source = correctionSourceById.get(punchStartCorrection.sourceResultRevisionId);
        const readout = punchStartReadoutById.get(punchStartCorrection.sourceReadoutId);
        if (!source || !readout?.startPunchedAt) throw new StoredResultRevisionConflict("Starttidsrättningens källa saknas");
        punchStartCorrectionProof = { correction: punchStartCorrection, source, sourceStartPunchedAt: readout.startPunchedAt, corrected: revision };
      } else if (punchStartCorrection) {
        throw new StoredResultRevisionConflict("Starttidsrättningens journal pekar på fel revisionsorsak");
      }
      let punchStartCorrectionWithdrawalProof: StoredManualPunchStartTimeCorrectionWithdrawalProof | undefined;
      if (revision.cause === "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL") {
        if (!punchStartCorrectionWithdrawal || revision.manualPunchStartTimeCorrectionWithdrawalId !== punchStartCorrectionWithdrawal.id) {
          throw new StoredResultRevisionConflict("Starträttningens återtagande saknas eller motsäger revisionen");
        }
        const source = correctionSourceById.get(punchStartCorrectionWithdrawal.sourceResultRevisionId);
        const corrected = correctionSourceById.get(punchStartCorrectionWithdrawal.correctedResultRevisionId);
        const correction = punchStartCorrectionById.get(punchStartCorrectionWithdrawal.correctionId);
        const readout = correction === undefined ? undefined : punchStartReadoutById.get(correction.sourceReadoutId);
        if (!source || !corrected || !correction || !readout?.startPunchedAt) throw new StoredResultRevisionConflict("Starträttningens återtagandekedja saknas");
        punchStartCorrectionWithdrawalProof = { withdrawal: punchStartCorrectionWithdrawal, correction, source, corrected,
          restored: revision, sourceStartPunchedAt: readout.startPunchedAt };
      } else if (punchStartCorrectionWithdrawal) {
        throw new StoredResultRevisionConflict("Starträttningens återtagande pekar på fel revisionsorsak");
      }
      let shortenedCourseClassTransferProof: StoredShortenedCourseClassTransferProof | undefined;
      if (revision.cause === "SHORTENED_COURSE_CLASS_TRANSFER") {
        const item = shortenedItemByCreatedId.get(revision.id);
        const transfer = item === undefined ? undefined : shortenedTransferById.get(item.requestId);
        const source = item?.sourceResultRevisionId === null || item === undefined
          ? undefined : shortenedSourceById.get(item.sourceResultRevisionId);
        if (!item || !transfer || !source || revision.shortenedCourseClassTransferId !== transfer.requestId) {
          throw new StoredResultRevisionConflict("Kortbaneöverflyttningens journal saknas eller motsäger revisionen");
        }
        shortenedCourseClassTransferProof = { transfer, item, source, created: revision };
      } else if (shortenedItemByCreatedId.has(revision.id) || revision.shortenedCourseClassTransferId !== null) {
        throw new StoredResultRevisionConflict("Kortbaneöverflyttningens item pekar på fel revisionsorsak");
      }
      const evaluation = parseStrictStoredResultRevision(revision, checkin?.source, correctionProof, correctionWithdrawalProof,
        punchStartCorrectionProof, punchStartCorrectionWithdrawalProof, shortenedCourseClassTransferProof);
      let source;
      if (revision.cause === "MANUAL_FINISH_TIME_CORRECTION" && correctionProof) {
        const correction = correctionProof.correction;
        source = {
          kind: "MANUAL_FINISH_TIME_CORRECTION" as const,
          manualFinishTimeCorrectionId: correction.requestId,
          sourceResultRevisionId: correction.sourceResultRevisionId,
          sourceResultRevision: correction.sourceResultRevision,
          sourceReadoutId: correction.sourceReadoutId,
          sourceFinishTime: correction.sourceFinishTime.toISOString(),
          correctedFinishTime: correction.correctedFinishTime.toISOString()
        };
      } else if (revision.cause === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" && correctionWithdrawalProof) {
        const withdrawal = correctionWithdrawalProof.withdrawal;
        source = { kind: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" as const,
          manualFinishTimeCorrectionWithdrawalId: withdrawal.id, manualFinishTimeCorrectionId: withdrawal.correctionId,
          sourceResultRevisionId: withdrawal.sourceResultRevisionId, sourceResultRevision: withdrawal.sourceResultRevision,
          correctedResultRevisionId: withdrawal.correctedResultRevisionId, correctedResultRevision: withdrawal.correctedResultRevision };
      } else if (revision.cause === "MANUAL_PUNCH_START_TIME_CORRECTION" && punchStartCorrectionProof) {
        const correction = punchStartCorrectionProof.correction;
        source = { kind: "MANUAL_PUNCH_START_TIME_CORRECTION" as const,
          manualPunchStartTimeCorrectionId: correction.requestId, sourceResultRevisionId: correction.sourceResultRevisionId,
          sourceResultRevision: correction.sourceResultRevision, sourceReadoutId: correction.sourceReadoutId,
          sourceStartTime: correction.sourceStartTime.toISOString(), correctedStartTime: correction.correctedStartTime.toISOString() };
      } else if (revision.cause === "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL" && punchStartCorrectionWithdrawalProof) {
        const withdrawal = punchStartCorrectionWithdrawalProof.withdrawal;
        source = { kind: "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL" as const,
          manualPunchStartTimeCorrectionWithdrawalId: withdrawal.id, manualPunchStartTimeCorrectionId: withdrawal.correctionId,
          sourceResultRevisionId: withdrawal.sourceResultRevisionId, sourceResultRevision: withdrawal.sourceResultRevision,
          correctedResultRevisionId: withdrawal.correctedResultRevisionId, correctedResultRevision: withdrawal.correctedResultRevision };
      } else if (revision.cause === "SHORTENED_COURSE_CLASS_TRANSFER" && shortenedCourseClassTransferProof) {
        const transfer = shortenedCourseClassTransferProof.transfer;
        const item = shortenedCourseClassTransferProof.item;
        source = { kind: "SHORTENED_COURSE_CLASS_TRANSFER" as const,
          shortenedCourseClassTransferId: transfer.requestId, sourceResultRevisionId: item.sourceResultRevisionId!,
          sourceResultRevision: item.sourceResultRevision!, sourceReadoutId: item.sourceReadoutId!,
          sourceClassId: transfer.sourceClassId, sourceCourseVersionId: transfer.sourceCourseVersionId,
          shortClassId: transfer.shortClassId, shortCourseVersionId: transfer.shortCourseVersionId };
      } else if (revision.cause === "START_CHECKIN_DID_NOT_START" && checkin) {
        const decision = checkin.source.decision, withdrawal = checkin.correction?.withdrawal;
        source = {
          kind: "START_CHECKIN_DID_NOT_START" as const,
          startCheckinDnsDecisionId: decision.id,
          operationRequestId: decision.operationRequestId,
          startCheckinRevisionId: decision.startCheckinRevisionId,
          operationalRevision: decision.operationalRevision,
          withdrawal: withdrawal === undefined ? null : {
            id: withdrawal.id, operationRequestId: withdrawal.operationRequestId,
            startCheckinRevisionId: withdrawal.startCheckinRevisionId,
            operationalRevision: withdrawal.operationalRevision
          }
        };
      } else if (revision.cause === "MANUAL_DID_NOT_START" && revision.didNotStartDecisionId !== null) {
        source = { kind: "MANUAL_DID_NOT_START" as const, didNotStartDecisionId: revision.didNotStartDecisionId };
      } else if (revision.cause === "MANUAL_DID_NOT_FINISH" && revision.didNotFinishDecisionId !== null) {
        const decision = didNotFinishDecisionById.get(revision.didNotFinishDecisionId);
        if (!decision) throw new Error("DNF-beslutet saknas i resultathistoriken");
        source = {
          kind: "MANUAL_DID_NOT_FINISH" as const,
          didNotFinishDecisionId: decision.id,
          targetResultRevisionId: decision.targetResultRevisionId
        };
      } else if (revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL" &&
          revision.didNotFinishWithdrawalId !== null) {
        const withdrawal = didNotFinishWithdrawalById.get(revision.didNotFinishWithdrawalId);
        if (!withdrawal) throw new Error("DNF-återtagandet saknas i resultathistoriken");
        const decision = didNotFinishDecisionById.get(withdrawal.didNotFinishDecisionId);
        if (!decision) throw new Error("DNF-återtagandets beslut saknas i resultathistoriken");
        source = {
          kind: "MANUAL_DID_NOT_FINISH_WITHDRAWAL" as const,
          didNotFinishWithdrawalId: withdrawal.id,
          didNotFinishDecisionId: decision.id,
          targetResultRevisionId: decision.targetResultRevisionId,
          didNotFinishResultRevisionId: withdrawal.withdrawnResultRevisionId,
          restorationSourceResultRevisionId: withdrawal.restoredFromResultRevisionId
        };
      } else if (revision.cause === "MANUAL_OUT_OF_COMPETITION" &&
          revision.notCompetingDecisionId !== null) {
        const decision = notCompetingDecisionById.get(revision.notCompetingDecisionId);
        if (!decision || decision.createdResultRevisionId !== revision.id) {
          throw new Error("OOC-beslutet saknas eller motsäger resultathistoriken");
        }
        source = {
          kind: "MANUAL_OUT_OF_COMPETITION" as const,
          notCompetingDecisionId: decision.id,
          targetResultRevisionId: decision.targetResultRevisionId
        };
      } else if (revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" &&
          revision.notCompetingWithdrawalId !== null) {
        const withdrawal = notCompetingWithdrawalById.get(revision.notCompetingWithdrawalId);
        if (!withdrawal || withdrawal.createdResultRevisionId !== revision.id) {
          throw new Error("OOC-återtagandet saknas eller motsäger resultathistoriken");
        }
        const decision = notCompetingDecisionById.get(withdrawal.notCompetingDecisionId);
        if (!decision) throw new Error("OOC-återtagandets beslut saknas i resultathistoriken");
        source = {
          kind: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" as const,
          notCompetingWithdrawalId: withdrawal.id,
          notCompetingDecisionId: decision.id,
          targetResultRevisionId: decision.targetResultRevisionId,
          outOfCompetitionResultRevisionId: withdrawal.withdrawnResultRevisionId,
          absoluteResultRevisionId: withdrawal.expectedLatestResultRevisionId,
          absoluteResultRevision: withdrawal.expectedLatestResultRevision,
          restorationSourceResultRevisionId: withdrawal.restoredFromResultRevisionId
        };
      } else if (revision.cause === "MANUAL_WITHOUT_TIMING" && revision.withoutTimingDecisionId !== null) {
        const decision = withoutTimingDecisionById.get(revision.withoutTimingDecisionId);
        if (!decision || decision.createdResultRevisionId !== revision.id) {
          throw new Error("Utan-tidtagning-beslutet saknas eller motsäger resultathistoriken");
        }
        source = {
          kind: "MANUAL_WITHOUT_TIMING" as const,
          withoutTimingDecisionId: decision.id,
          targetResultRevisionId: decision.targetResultRevisionId
        };
      } else if (revision.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL" &&
          revision.withoutTimingWithdrawalId !== null) {
        const withdrawal = withoutTimingWithdrawalById.get(revision.withoutTimingWithdrawalId);
        if (!withdrawal || withdrawal.createdResultRevisionId !== revision.id) {
          throw new Error("NT-återtagandet saknas eller motsäger resultathistoriken");
        }
        const decision = withoutTimingDecisionById.get(withdrawal.withoutTimingDecisionId);
        if (!decision) throw new Error("NT-återtagandets beslut saknas i resultathistoriken");
        source = {
          kind: "MANUAL_WITHOUT_TIMING_WITHDRAWAL" as const,
          withoutTimingWithdrawalId: withdrawal.id,
          withoutTimingDecisionId: decision.id,
          targetResultRevisionId: decision.targetResultRevisionId,
          withoutTimingResultRevisionId: withdrawal.withdrawnResultRevisionId,
          absoluteResultRevisionId: withdrawal.expectedLatestResultRevisionId,
          absoluteResultRevision: withdrawal.expectedLatestResultRevision,
          restorationSourceResultRevisionId: withdrawal.restoredFromResultRevisionId
        };
      } else if (revision.cause === "MANUAL_DISQUALIFICATION" && revision.disqualificationDecisionId !== null) {
        const decision = decisionById.get(revision.disqualificationDecisionId);
        if (!decision) throw new Error("Diskvalifikationsbeslutet saknas i resultathistoriken");
        source = {
          kind: "MANUAL_DISQUALIFICATION" as const,
          resultDisqualificationDecisionId: decision.id,
          targetResultRevisionId: decision.targetResultRevisionId
        };
      } else if (revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL" &&
          revision.disqualificationWithdrawalId !== null) {
        const withdrawal = withdrawalById.get(revision.disqualificationWithdrawalId);
        if (!withdrawal) throw new Error("Diskvalifikationsåtertagandet saknas i resultathistoriken");
        source = {
          kind: "MANUAL_DISQUALIFICATION_WITHDRAWAL" as const,
          resultDisqualificationWithdrawalId: withdrawal.id,
          resultDisqualificationDecisionId: withdrawal.disqualificationDecisionId,
          targetResultRevisionId: decisionById.get(withdrawal.disqualificationDecisionId)?.targetResultRevisionId,
          disqualifiedResultRevisionId: withdrawal.withdrawnResultRevisionId,
          restorationSourceResultRevisionId: withdrawal.restoredFromResultRevisionId
        };
        if (source.targetResultRevisionId === undefined) {
          throw new Error("Återtagandets diskvalifikationsbeslut saknas i resultathistoriken");
        }
      } else if (revision.cause === "MANUAL_RESULT_APPROVAL" && revision.approvalDecisionId !== null) {
        const decision = approvalDecisionById.get(revision.approvalDecisionId);
        if (!decision) throw new Error("Godkännandebeslutet saknas i resultathistoriken");
        source = {
          kind: "MANUAL_RESULT_APPROVAL" as const,
          resultApprovalDecisionId: decision.id,
          targetResultRevisionId: decision.targetResultRevisionId
        };
      } else if (revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL" &&
          revision.approvalWithdrawalId !== null) {
        const withdrawal = approvalWithdrawalById.get(revision.approvalWithdrawalId);
        if (!withdrawal) throw new Error("Godkännandeåtertagandet saknas i resultathistoriken");
        const decision = approvalDecisionById.get(withdrawal.approvalDecisionId);
        if (!decision) throw new Error("Godkännandeåtertagandets beslut saknas i resultathistoriken");
        source = {
          kind: "MANUAL_RESULT_APPROVAL_WITHDRAWAL" as const,
          resultApprovalWithdrawalId: withdrawal.id,
          resultApprovalDecisionId: decision.id,
          targetResultRevisionId: decision.targetResultRevisionId,
          approvedResultRevisionId: withdrawal.withdrawnResultRevisionId,
          restorationSourceResultRevisionId: withdrawal.restoredFromResultRevisionId
        };
      } else if (revision.readoutId !== null) {
        source = { kind: "READOUT_RESULT" as const, readoutId: revision.readoutId };
      } else {
        throw new Error("Resultathistorikens revisionsproveniens är ogiltig");
      }
      const {
        raceId: ignoredRaceId,
        entryId: ignoredEntryId,
        readoutId: ignoredReadoutId,
        didNotStartDecisionId: ignoredDidNotStartDecisionId,
        startCheckinDnsDecisionId: ignoredStartCheckinDnsDecisionId,
        controlNeutralizationId: ignoredControlNeutralizationId,
        disqualificationDecisionId: ignoredDisqualificationDecisionId,
        disqualificationWithdrawalId: ignoredDisqualificationWithdrawalId,
        approvalDecisionId: ignoredApprovalDecisionId,
        approvalWithdrawalId: ignoredApprovalWithdrawalId,
        didNotFinishDecisionId: ignoredDidNotFinishDecisionId,
        didNotFinishWithdrawalId: ignoredDidNotFinishWithdrawalId,
        notCompetingDecisionId: ignoredNotCompetingDecisionId,
        notCompetingWithdrawalId: ignoredNotCompetingWithdrawalId,
        withoutTimingDecisionId: ignoredWithoutTimingDecisionId,
        withoutTimingWithdrawalId: ignoredWithoutTimingWithdrawalId,
        manualFinishTimeCorrectionId: ignoredManualFinishTimeCorrectionId,
        manualFinishTimeCorrectionWithdrawalId: ignoredManualFinishTimeCorrectionWithdrawalId,
        manualPunchStartTimeCorrectionId: ignoredManualPunchStartTimeCorrectionId,
        manualPunchStartTimeCorrectionWithdrawalId: ignoredManualPunchStartTimeCorrectionWithdrawalId,
        shortenedCourseClassTransferId: ignoredShortenedCourseClassTransferId,
        ...publicRevision
      } = revision;
      void ignoredRaceId;
      void ignoredEntryId;
      void ignoredReadoutId;
      void ignoredDidNotStartDecisionId;
      void ignoredStartCheckinDnsDecisionId;
      void ignoredControlNeutralizationId;
      void ignoredDisqualificationDecisionId;
      void ignoredDisqualificationWithdrawalId;
      void ignoredApprovalDecisionId;
      void ignoredApprovalWithdrawalId;
      void ignoredDidNotFinishDecisionId;
      void ignoredDidNotFinishWithdrawalId;
      void ignoredNotCompetingDecisionId;
      void ignoredNotCompetingWithdrawalId;
      void ignoredWithoutTimingDecisionId;
      void ignoredWithoutTimingWithdrawalId;
      void ignoredManualFinishTimeCorrectionId;
      void ignoredManualFinishTimeCorrectionWithdrawalId;
      void ignoredManualPunchStartTimeCorrectionId;
      void ignoredManualPunchStartTimeCorrectionWithdrawalId;
      void ignoredShortenedCourseClassTransferId;
      return {
        ...publicRevision,
        source,
        createdAt: revision.createdAt.toISOString(),
        evaluation
      };
    });
    const last = page.at(-1);
    const response = readoutHistoryDetailResponseSchema.parse({
      formatVersion: 15,
      raceId: race.id,
      readout: {
        id: readout.id,
        cardNumber: readout.cardNumber,
        readAt: readout.readAt.toISOString(),
        startPunchedAt: readout.startPunchedAt?.toISOString() ?? null,
        finishPunchedAt: readout.finishPunchedAt?.toISOString() ?? null,
        punches: readout.punches
      },
      firstServerAssessment: publicAssessment(firstAssessment),
      entry: {
        id: initialRevision.entryId,
        displayName: `${initialRevision.givenName} ${initialRevision.familyName}`
      },
      history: {
        upperRevision,
        items: page,
        nextCursor: revisions.length > limit && last ? encodeCursor({
          v: 1, raceId: race.id, readoutId: readout.id,
          upperRevision, afterRevision: last.revision
        }) : null
      }
    });
    return { status: "ok", response } as const;
  }, { isolationLevel: "repeatable read" });
}
