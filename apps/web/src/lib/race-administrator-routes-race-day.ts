import { unknownReadoutResolutionCandidateResponseSchema,
  unknownReadoutResolutionIdempotencyKeySchema, unknownReadoutResolutionRequestSchema,
  unknownReadoutResolutionResponseSchema, speakerBoardResponseSchema, checkinHistoryResponseSchema, StartCheckinConflictReviewCandidateSchema,
  StartCheckinConflictReviewRequestSchema, StartCheckinConflictReviewResponseSchema,
  administratorForestWatchResponseSchema, administratorStartCorrectionRequestSchema,
  administratorStartCorrectionResponseSchema, canonicalAdministratorStartCorrectionRequest,
  administratorReturnRequestSchema, administratorReturnResponseSchema, canonicalAdministratorReturnRequest } from "@o-tid/contracts";
import {
  adminFailure as failure,
  hasNoRequestBody,
  privateJson as json,
  readJsonBody
} from "./security-policy";
import { ConflictReviewRequestError, readReviewJson } from "./checkin-conflict-review-body";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/** Tävlingsdagen: okända avläsningar, konfliktgranskning, kvar i skogen och speaker. Ger undefined för åtgärder som inte hör till gruppen. */
export async function handleRaceDayRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof, cursor } = context;
  if (action.kind === "unknown-readout-resolution" && request.method === "GET") {
    if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.unknownReadoutResolutionCandidates(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = unknownReadoutResolutionCandidateResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "unknown-readout-resolution") {
    const key = unknownReadoutResolutionIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = unknownReadoutResolutionRequestSchema.safeParse(body);
    if (!parsed.success || key.data.slice("unknown-readout-resolution:".length) !== parsed.data.requestId) {
      return failure(400, "INVALID_REQUEST");
    }
    const result = await dependencies.unknownReadoutResolution(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "resolved") return resultFailure(result.status);
    const response = unknownReadoutResolutionResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.requestId !== parsed.data.requestId ||
        response.readoutId !== parsed.data.readoutId || response.cardNumber !== parsed.data.cardNumber ||
        response.target !== parsed.data.target || response.engineVersion !== parsed.data.expectedEngineVersion) return failure(500, "INTERNAL_ERROR");
    if (parsed.data.target === "EXISTING_ENTRY" && (response.entryId !== parsed.data.entryId || response.classId !== parsed.data.expectedClassId)) {
      return failure(500, "INTERNAL_ERROR");
    }
    if (parsed.data.target === "NEW_ENTRY" && response.classId !== parsed.data.classId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "conflict-candidate") {
    if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.conflictCandidate(db, { ...proof, raceId, entryId: action.entryId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = StartCheckinConflictReviewCandidateSchema.parse(result.response);
    if (response.source.raceId !== raceId || response.source.entryId !== action.entryId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "review-conflicts") {
    let intent;
    try { intent = StartCheckinConflictReviewRequestSchema.parse(await readReviewJson(request)); }
    catch (error) { return error instanceof ConflictReviewRequestError && error.tooLarge
      ? resultFailure("too-large") : failure(400, "INVALID_REQUEST"); }
    const result = await dependencies.reviewConflicts(db, { ...proof, raceId, readBody: async () => intent });
    if (result.status !== "reviewed") return resultFailure(result.status);
    const response = StartCheckinConflictReviewResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== intent.entryId || response.requestId !== intent.requestId ||
      response.sourceHash !== intent.sourceHash || response.decision !== intent.decision ||
      response.conflictRequestIds.length !== intent.conflictRequestIds.length ||
      response.conflictRequestIds.some((id, index) => id !== intent.conflictRequestIds[index])) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "checkin-history") {
    const result = await dependencies.checkinHistory(db, { ...proof, raceId, entryId: action.entryId, limit: 25,
      ...(cursor === null ? {} : { cursor }) });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = checkinHistoryResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "start-correction") {
    let body: unknown;
    try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = administratorStartCorrectionRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.correctStart(db, { ...proof, raceId, request: parsed.data });
    if (result.status !== "stored") return resultFailure(result.status);
    const response = administratorStartCorrectionResponseSchema.parse(result.response);
    if (response.receipt.raceId !== raceId || canonicalAdministratorStartCorrectionRequest(response.request).toString() !== canonicalAdministratorStartCorrectionRequest(parsed.data).toString()) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "manual-return" || action.kind === "manual-return-withdrawal") {
    let body: unknown;
    try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = administratorReturnRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const service = action.kind === "manual-return" ? dependencies.manualReturn : dependencies.withdrawReturn;
    const result = await service(db, { ...proof, raceId, request: parsed.data });
    if (result.status !== "stored") return resultFailure(result.status);
    const response = administratorReturnResponseSchema.parse(result.response);
    if (response.receipt.raceId !== raceId || canonicalAdministratorReturnRequest(response.request).toString() !== canonicalAdministratorReturnRequest(parsed.data).toString()) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "forest-watch") {
    const result = await dependencies.forestWatch(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = administratorForestWatchResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "speaker-board") {
    if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.speakerBoard(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = speakerBoardResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  return undefined;
}
