import { classCapacityKeySchema, classCapacityRequestSchema, classCapacityResponseSchema,
  manualCourseClassCreateIdempotencyKeySchema, manualCourseClassCreateRequestSchema,
  manualCourseClassCreateResponseSchema, manualClassCreateIdempotencyKeySchema, manualClassCreateRequestSchema,
  manualClassCreateResponseSchema, manualClassNameCandidateSchema, manualClassNameChangeIdempotencyKeySchema,
  manualClassNameChangeRequestSchema, manualClassNameChangeResponseSchema, manualCourseVersionClassRelinkPreviewSchema,
  manualCourseVersionClassRelinkIdempotencyKeySchema, manualCourseVersionClassRelinkRequestSchema,
  manualCourseVersionClassRelinkResponseSchema, manualCourseResultImpactResponseSchema,
  manualCourseResultBearingRelinkCandidateSchema, manualCourseResultBearingRelinkIdempotencyKeySchema,
  manualCourseResultBearingRelinkRequestSchema, manualCourseResultBearingRelinkResponseSchema,
  shortenedCourseClassTransferCandidateSchema, shortenedCourseClassTransferIdempotencyKeySchema,
  shortenedCourseClassTransferRequestSchema, shortenedCourseClassTransferReceiptSchema, classStartRulePreviewSchema,
  classStartRuleChangeRequestSchema, classStartRuleChangeResponseSchema, classStartDrawClassesResponseSchema,
  classStartDrawPreviewRequestSchema, classStartDrawPreviewResponseSchema, classStartDrawRequestSchema,
  classStartDrawIdempotencyKeySchema, fixedStartSlotPlanResponseSchema, startListPublicationPreviewResponseSchema,
  startListPublicationRequestSchema, startListPublicationIdempotencyKeySchema } from "@o-tid/contracts";
import { entryClassAdminFailure as failure, entryClassAdminJson as json, hasNoEntryClassAdminRequestBody,
  readEntryClassAdminJson } from "./entry-class-admin-security";
import { parseAdministratorDrawReceipt } from "./administrator-start-draw-client";
import { parseAdministratorPublicationReceipt } from "./administrator-publication-client";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/** Förberedelse: banor, klasser, startregel, maxantal, lottning och publicering av startlista. Ger undefined för åtgärder som inte hör till gruppen. */
export async function handlePreparationRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind === "start-rule" && request.method === "GET") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.startRulePreview(db, { ...proof, raceId, classId: action.classId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = classStartRulePreviewSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "start-rule") {
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = classStartRuleChangeRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.startRule(db, { ...proof, raceId, classId: action.classId, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = classStartRuleChangeResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== parsed.data.requestId ||
      response.previousStartRule !== parsed.data.expectedStartRule || response.startRule !== parsed.data.startRule ||
      response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "manual-course-version-link" && request.method === "GET") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.manualCourseVersionRelinkPreview(db, { ...proof, raceId, classId: action.classId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = manualCourseVersionClassRelinkPreviewSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "manual-course-result-impact") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.manualCourseResultImpact(db, { ...proof, raceId, classId: action.classId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = manualCourseResultImpactResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "manual-course-result-bearing-link" && request.method === "GET") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.manualCourseResultBearingRelinkCandidate(db, { ...proof, raceId, classId: action.classId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = manualCourseResultBearingRelinkCandidateSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "manual-course-result-bearing-link") {
    const key = manualCourseResultBearingRelinkIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = manualCourseResultBearingRelinkRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.classId !== action.classId ||
        key.data.slice("manual-course-result-bearing-link:".length) !== parsed.data.requestId) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.manualCourseResultBearingRelink(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = manualCourseResultBearingRelinkResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== parsed.data.requestId ||
        response.courseId !== parsed.data.courseId || response.sourceSnapshotVersion !== parsed.data.expectedSnapshotVersion ||
        response.sourceBasisHash !== parsed.data.expectedBasisHash || response.previousCourseVersionId !== parsed.data.expectedClassCourseVersionId ||
        JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "shortened-course-class-transfer" && request.method === "GET") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.shortenedCourseClassTransferPreview(db, { ...proof, raceId,
      request: { formatVersion: 1, sourceClassId: action.classId } });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = shortenedCourseClassTransferCandidateSchema.parse(result.response);
    if (response.raceId !== raceId || response.sourceClassId !== action.classId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "shortened-course-class-transfer") {
    const key = shortenedCourseClassTransferIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = shortenedCourseClassTransferRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.sourceClassId !== action.classId ||
        key.data !== `shortened-course-class-transfer:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.shortenedCourseClassTransfer(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "transferred") return resultFailure(result.status);
    const response = shortenedCourseClassTransferReceiptSchema.parse(result.response);
    if (response.raceId !== raceId || response.requestId !== parsed.data.requestId ||
        response.sourceClassId !== action.classId || response.sourceCourseVersionId !== parsed.data.expectedSourceCourseVersionId ||
        response.sourceSnapshotVersion !== parsed.data.expectedSnapshotVersion || response.sourceBasisHash !== parsed.data.expectedBasisHash ||
        JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "manual-course-version-link") {
    const key = manualCourseVersionClassRelinkIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = manualCourseVersionClassRelinkRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.classId !== action.classId ||
        key.data.slice("manual-course-version-link:".length) !== parsed.data.requestId) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.manualCourseVersionRelink(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status === "results-exist") return failure(409, "CONFLICT");
    if (result.status !== "changed") return resultFailure(result.status);
    const response = manualCourseVersionClassRelinkResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== parsed.data.requestId ||
        response.courseId !== parsed.data.courseId || response.previousCourseVersionId !== parsed.data.expectedClassCourseVersionId ||
        response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion ||
        JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "publication-preview") {
    const result = await dependencies.publicationPreview(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = startListPublicationPreviewResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "publication") {
    const key = startListPublicationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = startListPublicationRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.publication(db, { ...proof, raceId, request: parsed.data, idempotencyKey: key.data });
    if (result.status !== "decided") return resultFailure(result.status);
    return json(parseAdministratorPublicationReceipt(result.response, raceId, {
      id: key.data.slice("start-list-publication:".length), request: parsed.data
    }));
  }
  if (action.kind === "draw-classes") {
    const result = await dependencies.drawClasses(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = classStartDrawClassesResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "fixed-start-slot-plans") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.fixedStartSlotPlans(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = fixedStartSlotPlanResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "draw-preview" || action.kind === "draw") {
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    if (action.kind === "draw-preview") {
      const parsed = classStartDrawPreviewRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.drawPreview(db, { ...proof, raceId, request: parsed.data });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = classStartDrawPreviewResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== parsed.data.classId ||
        JSON.stringify(response.parameters) !== JSON.stringify(parsed.data.parameters)) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    const parsed = classStartDrawRequestSchema.safeParse(body);
    const key = classStartDrawIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!parsed.success || !key.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.draw(db, { ...proof, raceId, request: parsed.data, idempotencyKey: key.data });
    if (result.status !== "changed") return resultFailure(result.status);
    return json(parseAdministratorDrawReceipt(result.response, raceId, {
      id: key.data.slice("class-start-draw:".length), request: parsed.data
    }));
  }
  if (action.kind === "manual-class-name" && request.method === "GET") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.manualClassNameCandidate(db, { ...proof, raceId, classId: action.classId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = manualClassNameCandidateSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "manual-class-name") {
    const key = manualClassNameChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = manualClassNameChangeRequestSchema.safeParse(body);
    if (!parsed.success || key.data !== `manual-class-name:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.manualClassName(db, { ...proof, raceId, classId: action.classId,
      idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = manualClassNameChangeResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== parsed.data.requestId ||
      JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "manual-class") {
    const key = manualClassCreateIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = manualClassCreateRequestSchema.safeParse(body);
    if (!parsed.success || key.data !== `manual-class-create:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.manualClass(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "created") return resultFailure(result.status);
    const response = manualClassCreateResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.requestId !== parsed.data.requestId ||
      JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "manual-course-class") {
    const key = manualCourseClassCreateIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = manualCourseClassCreateRequestSchema.safeParse(body);
    if (!parsed.success || key.data.slice("manual-course-class-create:".length) !== parsed.data.requestId) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.manualCourseClass(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "created") return resultFailure(result.status);
    const response = manualCourseClassCreateResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.requestId !== parsed.data.requestId ||
      JSON.stringify(response.request) !== JSON.stringify(parsed.data) || response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
  }
  if (action.kind === "capacity") {
    const key = classCapacityKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = classCapacityRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.capacity(db, { ...proof, raceId, classId: action.classId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = classCapacityResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== key.data.slice("class-capacity:".length) ||
      response.versionBefore !== parsed.data.expectedCapacityVersion || response.previousMaxEntries !== parsed.data.expectedMaxEntries || response.maxEntries !== parsed.data.maxEntries) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
  }
  return undefined;
}
