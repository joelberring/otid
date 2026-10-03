import { resultFinalizationRequestSchema, resultFinalizationIdempotencyKeySchema,
  frozenRaceFinalizationListResponseSchema, raceResultFinalizationMetadataSchema, iofResultListExportMetadataSchema,
  resultRecalculationCandidateResponseSchema, resultRecalculationIdempotencyKeySchema,
  resultRecalculationRequestSchema, resultRecalculationResponseSchema, administratorEffectiveResultResponseSchema,
  classResultRecalculationCandidateResponseSchema, classResultRecalculationIdempotencyKeySchema,
  classResultRecalculationRequestSchema, classResultRecalculationResponseSchema,
  administratorEntryChangesResponseSchema, didNotStartCandidateResponseSchema, didNotStartRequestSchema,
  didNotStartIdempotencyKeySchema, didNotStartWithdrawalListResponseSchema, didNotStartWithdrawalRequestSchema,
  didNotStartWithdrawalIdempotencyKeySchema, didNotFinishCandidateResponseSchema, didNotFinishRequestSchema,
  didNotFinishIdempotencyKeySchema, didNotFinishWithdrawalListResponseSchema, didNotFinishWithdrawalRequestSchema,
  didNotFinishWithdrawalIdempotencyKeySchema, resultDisqualificationCandidateResponseSchema,
  resultDisqualificationRequestSchema, resultDisqualificationIdempotencyKeySchema,
  resultDisqualificationWithdrawalListResponseSchema, resultDisqualificationWithdrawalRequestSchema,
  resultDisqualificationWithdrawalIdempotencyKeySchema, resultApprovalCandidateResponseSchema,
  resultApprovalRequestSchema, resultApprovalIdempotencyKeySchema, resultApprovalWithdrawalListResponseSchema,
  resultApprovalWithdrawalRequestSchema, resultApprovalWithdrawalIdempotencyKeySchema,
  outOfCompetitionCandidateResponseSchema, outOfCompetitionRequestSchema, outOfCompetitionIdempotencyKeySchema,
  outOfCompetitionWithdrawalListResponseSchema, outOfCompetitionWithdrawalRequestSchema,
  outOfCompetitionWithdrawalIdempotencyKeySchema, withoutTimingCandidateResponseSchema, withoutTimingRequestSchema,
  withoutTimingIdempotencyKeySchema, withoutTimingWithdrawalListResponseSchema, withoutTimingWithdrawalRequestSchema,
  withoutTimingWithdrawalIdempotencyKeySchema } from "@o-tid/contracts";
import { entryClassAdminFailure as failure, entryClassAdminJson as json, hasNoEntryClassAdminRequestBody,
  privateEntryClassAdminHeaders, readEntryClassAdminJson } from "./entry-class-admin-security";
import { parseDidNotStartResponse } from "./did-not-start-admin-client";
import { parseDidNotStartWithdrawalResponse } from "./did-not-start-withdrawal-admin-client";
import { parseDidNotFinishResponse } from "./did-not-finish-admin-client";
import { parseDidNotFinishWithdrawalResponse } from "./did-not-finish-withdrawal-admin-client";
import { parseResultDisqualificationResponse } from "./result-disqualification-admin-client";
import { parseResultDisqualificationWithdrawalResponse } from "./result-disqualification-withdrawal-admin-client";
import { parseResultApprovalResponse } from "./result-approval-admin-client";
import { parseResultApprovalWithdrawalResponse } from "./result-approval-withdrawal-admin-client";
import { parseOutOfCompetitionResponse } from "./out-of-competition-admin-client";
import { parseOutOfCompetitionWithdrawalResponse } from "./out-of-competition-withdrawal-admin-client";
import { parseWithoutTimingResponse } from "./without-timing-admin-client";
import { parseWithoutTimingWithdrawalResponse } from "./without-timing-withdrawal-admin-client";
import { parseResultFinalizationCandidates, parseResultFinalizationResponse } from "./result-finalization-admin-client";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/** Resultat: beslut (DNS, DNF, DSQ, OOC, NT, godkännande), omräkning, historik, fastställande och export. Ger undefined för åtgärder som inte hör till gruppen. */
export async function handleResultRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof, beforeVersion } = context;
  if (action.kind === "finalization-candidates") {
    const result = await dependencies.finalizationCandidates(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    return json(parseResultFinalizationCandidates(result.response, raceId));
  }
  if (action.kind === "finalize") {
    const key = resultFinalizationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = resultFinalizationRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.finalize(db, { ...proof, raceId, request: parsed.data, idempotencyKey: key.data });
    if (result.status !== "finalized") return resultFailure(result.status);
    return json(parseResultFinalizationResponse(result.response, {
      requestId: key.data.slice("result-finalization:".length), request: parsed.data, label: ""
    }, raceId));
  }
  if (action.kind === "frozen-results") {
    const result = await dependencies.frozenResults(db, { sessionToken: proof.sessionToken, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = frozenRaceFinalizationListResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "frozen-result") {
    const result = await dependencies.frozenResult(db, { sessionToken: proof.sessionToken, raceId, finalizationId: action.finalizationId });
    if (result.status !== "ok") return resultFailure(result.status);
    const metadata = raceResultFinalizationMetadataSchema.parse(result.finalization);
    if (metadata.raceId !== raceId || metadata.id !== action.finalizationId) return failure(500, "INTERNAL_ERROR");
    const bytes = Uint8Array.from(result.bytes);
    return new Response(bytes, { headers: { ...privateEntryClassAdminHeaders,
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="otid-complete-result-list-${raceId}-r${metadata.scopeRevision}.xml"`,
      "content-length": String(bytes.byteLength), etag: `"sha256-${metadata.completeXmlSha256}"`,
      "x-otid-content-sha256": metadata.completeXmlSha256, "x-otid-race-id": raceId,
      "x-otid-finalization-id": metadata.id, "x-otid-finalization-revision": String(metadata.scopeRevision),
      "x-otid-snapshot-version": String(metadata.sourceSnapshotVersion),
      "x-otid-class-count": String(metadata.classCount), "x-otid-result-count": String(metadata.entryCount)
    } });
  }
  if (action.kind === "result-export") {
    const result = await dependencies.resultExport(db, { sessionToken: proof.sessionToken, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const metadata = iofResultListExportMetadataSchema.parse(result.metadata);
    if (metadata.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    const bytes = Uint8Array.from(result.bytes);
    return new Response(bytes, { headers: { ...privateEntryClassAdminHeaders,
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="otid-result-list-${raceId}.xml"`,
      "content-length": String(bytes.byteLength), etag: `"sha256-${metadata.sha256}"`,
      "x-otid-content-sha256": metadata.sha256, "x-otid-race-id": raceId,
      "x-otid-snapshot-version": String(metadata.snapshotVersion),
      "x-otid-class-count": String(metadata.classCount), "x-otid-result-count": String(metadata.resultCount),
      "x-otid-stale-result-count": String(metadata.staleResultCount),
      "x-otid-omitted-entry-count": String(metadata.omittedEntryCount)
    } });
  }
  if (action.kind === "approval-candidates") {
    const result = await dependencies.approvalCandidates(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = resultApprovalCandidateResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "approval-withdrawals") {
    const result = await dependencies.approvalWithdrawals(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = resultApprovalWithdrawalListResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "approval") {
    const key = resultApprovalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = resultApprovalRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.approval(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "approved") return resultFailure(result.status);
    return json(parseResultApprovalResponse(result.response, { request: parsed.data,
      requestId: key.data.slice("manual-result-approval:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "approval-withdrawal") {
    const key = resultApprovalWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = resultApprovalWithdrawalRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.approvalWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "withdrawn") return resultFailure(result.status);
    return json(parseResultApprovalWithdrawalResponse(result.response, { request: parsed.data,
      requestId: key.data.slice("manual-result-approval-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "disqualification-candidates") {
    const result = await dependencies.dsqCandidates(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = resultDisqualificationCandidateResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "disqualification-withdrawals") {
    const result = await dependencies.dsqWithdrawals(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = resultDisqualificationWithdrawalListResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "disqualification") {
    const key = resultDisqualificationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = resultDisqualificationRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.dsq(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "disqualified") return resultFailure(result.status);
    return json(parseResultDisqualificationResponse(result.response, { request: parsed.data,
      requestId: key.data.slice("manual-disqualification:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "disqualification-withdrawal") {
    const key = resultDisqualificationWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = resultDisqualificationWithdrawalRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.dsqWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "withdrawn") return resultFailure(result.status);
    return json(parseResultDisqualificationWithdrawalResponse(result.response, { request: parsed.data,
      requestId: key.data.slice("manual-disqualification-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "without-timing-candidates") {
    const result = await dependencies.ntCandidates(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = withoutTimingCandidateResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "without-timing-withdrawals") {
    const result = await dependencies.ntWithdrawals(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = withoutTimingWithdrawalListResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "without-timing") {
    const key = withoutTimingIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = withoutTimingRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.nt(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "without-timing") return resultFailure(result.status);
    return json(parseWithoutTimingResponse(result.response, { request: parsed.data,
      requestId: key.data.slice("without-timing:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "without-timing-withdrawal") {
    const key = withoutTimingWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = withoutTimingWithdrawalRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.ntWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "withdrawn") return resultFailure(result.status);
    return json(parseWithoutTimingWithdrawalResponse(result.response, { request: parsed.data,
      requestId: key.data.slice("without-timing-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "out-of-competition-candidates") {
    const result = await dependencies.oocCandidates(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = outOfCompetitionCandidateResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "out-of-competition-withdrawals") {
    const result = await dependencies.oocWithdrawals(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = outOfCompetitionWithdrawalListResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "out-of-competition") {
    const key = outOfCompetitionIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = outOfCompetitionRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.ooc(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "out-of-competition") return resultFailure(result.status);
    return json(parseOutOfCompetitionResponse(result.response, { request: parsed.data,
      requestId: key.data.slice("out-of-competition:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "out-of-competition-withdrawal") {
    const key = outOfCompetitionWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = outOfCompetitionWithdrawalRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.oocWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "withdrawn") return resultFailure(result.status);
    return json(parseOutOfCompetitionWithdrawalResponse(result.response, { request: parsed.data,
      requestId: key.data.slice("out-of-competition-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "did-not-finish-candidates") {
    const result = await dependencies.dnfCandidates(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = didNotFinishCandidateResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "did-not-finish-withdrawals") {
    const result = await dependencies.dnfWithdrawals(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = didNotFinishWithdrawalListResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "did-not-finish") {
    const key = didNotFinishIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = didNotFinishRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.dnf(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "did-not-finish") return resultFailure(result.status);
    return json(parseDidNotFinishResponse(result.response, { request: parsed.data,
      requestId: key.data.slice("did-not-finish:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "did-not-finish-withdrawal") {
    const key = didNotFinishWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = didNotFinishWithdrawalRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.dnfWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "withdrawn") return resultFailure(result.status);
    return json(parseDidNotFinishWithdrawalResponse(result.response, { request: parsed.data,
      requestId: key.data.slice("did-not-finish-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "did-not-start-candidates") {
    const result = await dependencies.dnsCandidates(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = didNotStartCandidateResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "did-not-start-withdrawals") {
    const result = await dependencies.dnsWithdrawals(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = didNotStartWithdrawalListResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "did-not-start") {
    const key = didNotStartIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = didNotStartRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.dns(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "decided") return resultFailure(result.status);
    return json(parseDidNotStartResponse(result.response, { ...parsed.data,
      requestId: key.data.slice("did-not-start:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "did-not-start-withdrawal") {
    const key = didNotStartWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = didNotStartWithdrawalRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.dnsWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "withdrawn") return resultFailure(result.status);
    return json(parseDidNotStartWithdrawalResponse(result.response, { request: parsed.data,
      requestId: key.data.slice("did-not-start-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
  }
  if (action.kind === "changes") {
    const result = await dependencies.changes(db, { ...proof, raceId, entryId: action.entryId,
      ...(beforeVersion === undefined ? {} : { beforeVersion }) });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = administratorEntryChangesResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId ||
      (beforeVersion !== undefined && response.items.some(item => item.entryVersionAfter >= beforeVersion))) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "effective-result") {
    const result = await dependencies.effectiveResult(db, { ...proof, raceId, entryId: action.entryId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = administratorEffectiveResultResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "recalculation-candidates") {
    const result = await dependencies.recalculationCandidates(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = resultRecalculationCandidateResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "class-result-recalculation" && request.method === "GET") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.classResultRecalculationCandidates(db, { ...proof, raceId, classId: action.classId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = classResultRecalculationCandidateResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "class-result-recalculation") {
    const key = classResultRecalculationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = classResultRecalculationRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.classId !== action.classId) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.classResultRecalculate(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "recalculated") return resultFailure(result.status);
    const response = classResultRecalculationResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== key.data.slice("class-result-recalculation:".length) ||
        response.manifestHash !== parsed.data.manifestHash || response.snapshotVersion !== parsed.data.snapshotVersion ||
        response.engineVersion !== parsed.data.engineVersion || response.items.length !== parsed.data.entryIds.length ||
        new Set(response.items.map((item) => item.entryId)).size !== response.items.length ||
        response.items.some((item) => !parsed.data.entryIds.includes(item.entryId))) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "recalculate") {
    const key = resultRecalculationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = resultRecalculationRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.recalculate(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "recalculated") return resultFailure(result.status);
    const response = resultRecalculationResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId || response.readoutId !== parsed.data.expectedReadoutId ||
      response.requestId !== key.data.slice("result-recalculation:".length) ||
      response.revision !== (parsed.data.expectedLatestResultRevision?.revision ?? 0) + 1 ||
      response.engineVersion !== parsed.data.expectedEngineVersion || response.snapshotVersion !== parsed.data.expectedSnapshotVersion) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
  }
  return undefined;
}
