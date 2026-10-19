import { resultFinalizationRequestSchema, resultFinalizationIdempotencyKeySchema,
  frozenRaceFinalizationListResponseSchema, raceResultFinalizationMetadataSchema, iofResultListExportMetadataSchema,
  resultRecalculationCandidateResponseSchema, resultRecalculationIdempotencyKeySchema,
  resultRecalculationRequestSchema, resultRecalculationResponseSchema, administratorEffectiveResultResponseSchema,
  classResultRecalculationCandidateResponseSchema, classResultRecalculationIdempotencyKeySchema,
  classResultRecalculationRequestSchema, classResultRecalculationResponseSchema,
  administratorEntryChangesResponseSchema, entryStatusConflictSchema, entryStatusReceiptSchema,
  entryStatusRequestSchema, entryStatusResponseSchema } from "@o-tid/contracts";
import {
  adminFailure as failure,
  hasNoRequestBody,
  privateJson as json,
  privateHeaders,
  readJsonBody
} from "./security-policy";
import { parseResultFinalizationCandidates, parseResultFinalizationResponse } from "./result-finalization-admin-client";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/** Resultat: löparens status (ett statusflöde, ADR-0173), omräkning, historik, fastställande och export. Ger undefined för åtgärder som inte hör till gruppen. */
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
    try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
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
    return new Response(bytes, { headers: { ...privateHeaders,
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
    return new Response(bytes, { headers: { ...privateHeaders,
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
  if (action.kind === "entry-status" && request.method === "GET") {
    const result = await dependencies.entryStatus(db, { ...proof, raceId, entryId: action.entryId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = entryStatusResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "entry-status") {
    let body: unknown;
    try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryStatusRequestSchema.safeParse(body);
    const key = request.headers.get("idempotency-key");
    if (!parsed.success || key !== `entry-status:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.setEntryStatus(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key,
      request: parsed.data });
    // Konflikt: beslutet gällde inte längre löparens senaste revision; svaret bär det nya läget.
    if (result.status === "conflict") return json(entryStatusConflictSchema.parse({ formatVersion: 1, error: "CONFLICT",
      headRevision: result.headRevision, readiness: result.readiness }), 409);
    if (result.status !== "decided") return resultFailure(result.status);
    const response = entryStatusReceiptSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId || response.requestId !== parsed.data.requestId) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
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
    if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
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
    try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = classResultRecalculationRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.classId !== action.classId) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.classResultRecalculate(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "recalculated") return resultFailure(result.status);
    const response = classResultRecalculationResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== key.data.slice("class-result-recalculation:".length) ||
        response.manifestHash !== parsed.data.manifestHash || response.engineVersion !== parsed.data.engineVersion || response.items.length !== parsed.data.entryIds.length ||
        new Set(response.items.map((item) => item.entryId)).size !== response.items.length ||
        response.items.some((item) => !parsed.data.entryIds.includes(item.entryId))) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "recalculate") {
    const key = resultRecalculationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = resultRecalculationRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.recalculate(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "recalculated") return resultFailure(result.status);
    const response = resultRecalculationResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId || response.readoutId !== parsed.data.expectedReadoutId ||
      response.requestId !== key.data.slice("result-recalculation:".length) ||
      response.revision !== (parsed.data.expectedLatestResultRevision?.revision ?? 0) + 1 ||
      response.engineVersion !== parsed.data.expectedEngineVersion) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
  }
  return undefined;
}
