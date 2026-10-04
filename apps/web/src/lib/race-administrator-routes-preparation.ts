import { classCapacityKeySchema, classCapacityRequestSchema, classCapacityResponseSchema,
  manualCourseClassCreateIdempotencyKeySchema, manualCourseClassCreateRequestSchema,
  manualCourseClassCreateResponseSchema, manualClassCreateIdempotencyKeySchema, manualClassCreateRequestSchema,
  manualClassCreateResponseSchema, courseEditListResponseSchema,
  courseEditPreviewRequestSchema, courseEditPreviewResponseSchema, courseEditIdempotencyKeySchema, courseEditRequestSchema,
  courseEditResponseSchema, classEditPreviewRequestSchema, classEditPreviewResponseSchema, classEditIdempotencyKeySchema,
  classEditRequestSchema, classEditResponseSchema,
  shortenedCourseClassTransferCandidateSchema, shortenedCourseClassTransferIdempotencyKeySchema,
  shortenedCourseClassTransferRequestSchema, shortenedCourseClassTransferReceiptSchema, startDrawSetupResponseSchema,
  startDrawPreviewRequestSchema, startDrawPreviewResponseSchema, startDrawRequestSchema,
  startDrawIdempotencyKeySchema, startDrawResponseSchema, startListPublicationPreviewResponseSchema,
  startListPublicationRequestSchema, startListPublicationIdempotencyKeySchema } from "@o-tid/contracts";
import { entryClassAdminFailure as failure, entryClassAdminJson as json, hasNoEntryClassAdminRequestBody,
  readEntryClassAdminJson } from "./entry-class-admin-security";
import { parseAdministratorPublicationReceipt } from "./administrator-publication-client";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/** Förberedelse: banor (Redigera bana), klasser (Redigera klass), maxantal, lottning och publicering av startlista. Ger undefined för åtgärder som inte hör till gruppen. */
export async function handlePreparationRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind === "courses") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.courses(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = courseEditListResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "course-edit-preview") {
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = courseEditPreviewRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.courseEditPreview(db, { ...proof, raceId, courseId: action.courseId, request: parsed.data });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = courseEditPreviewResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.courseId !== action.courseId ||
        response.snapshotVersion !== parsed.data.expectedSnapshotVersion ||
        JSON.stringify(response.controlCodes) !== JSON.stringify(parsed.data.controlCodes)) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "course-edit") {
    const key = courseEditIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = courseEditRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.courseId !== action.courseId || key.data !== `course-edit:${parsed.data.requestId}`) {
      return failure(400, "INVALID_REQUEST");
    }
    const result = await dependencies.courseEdit(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    // Någon löpares status ändras sedan beskedet visades: klienten hämtar nytt besked och frågar igen.
    if (result.status === "confirmation-required") return failure(409, "CONFLICT");
    if (result.status !== "edited") return resultFailure(result.status);
    const response = courseEditResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.courseId !== action.courseId || response.requestId !== parsed.data.requestId ||
        JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "class-edit-preview") {
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = classEditPreviewRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.classEditPreview(db, { ...proof, raceId, classId: action.classId, request: parsed.data });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = classEditPreviewResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId || response.courseId !== parsed.data.courseId ||
        response.startRule !== parsed.data.startRule || response.snapshotVersion !== parsed.data.expectedSnapshotVersion) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
  }
  if (action.kind === "class-edit") {
    const key = classEditIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = classEditRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.classId !== action.classId || key.data !== `class-edit:${parsed.data.requestId}`) {
      return failure(400, "INVALID_REQUEST");
    }
    const result = await dependencies.classEdit(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    // Någon löpares status ändras sedan beskedet visades: klienten hämtar nytt besked och frågar igen.
    if (result.status === "confirmation-required") return failure(409, "CONFLICT");
    if (result.status !== "edited") return resultFailure(result.status);
    const response = classEditResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== parsed.data.requestId ||
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
  if (action.kind === "draw" && request.method === "GET") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.drawSetup(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = startDrawSetupResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "draw-preview") {
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = startDrawPreviewRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.drawPreview(db, { ...proof, raceId, request: parsed.data });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = startDrawPreviewResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.snapshotVersion !== parsed.data.expectedSnapshotVersion ||
        response.classes.length !== parsed.data.classes.length) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "draw") {
    const key = startDrawIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = startDrawRequestSchema.safeParse(body);
    if (!parsed.success || key.data !== `start-draw:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.draw(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    // Starttider eller resultat ändras sedan beskedet visades: klienten hämtar nytt besked och frågar igen.
    if (result.status === "confirmation-required") return failure(409, "CONFLICT");
    if (result.status !== "drawn") return resultFailure(result.status);
    const response = startDrawResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.requestId !== parsed.data.requestId ||
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
