import { entryClassAdminListResponseSchema, entryClassChangeIdempotencyKeySchema, entryClassChangeRequestSchema,
  entryClassChangeResponseSchema, entryTransferCandidatesSchema, entryTransferStartSlotCandidatesSchema,
  entryTransferRequestSchema, entryTransferIdempotencyKeySchema, entryTransferResponseSchema,
  entryCardChangeIdempotencyKeySchema, entryCardChangeRequestSchema, entryCardChangeResponseSchema,
  entryCardRentalChangeIdempotencyKeySchema, entryCardRentalChangeRequestSchema, entryCardRentalChangeResponseSchema,
  entryCardRentalReturnChangeIdempotencyKeySchema, entryCardRentalReturnChangeRequestSchema,
  entryCardRentalReturnChangeResponseSchema, entryCardRentalReuseIdempotencyKeySchema,
  entryCardRentalReuseRequestSchema, entryCardRentalReuseResponseSchema, entryPaymentStatusChangeIdempotencyKeySchema,
  entryPaymentStatusChangeRequestSchema, entryPaymentStatusChangeResponseSchema,
  entryStartTimeChangeIdempotencyKeySchema, entryStartTimeChangeRequestSchema, entryStartTimeChangeResponseSchema,
  entryIdentityAdminListResponseSchema, entryIdentityChangeIdempotencyKeySchema, entryIdentityChangeRequestSchema,
  entryRegistrationIdempotencyKeySchema, entryRegistrationRequestSchema, entryRegistrationCandidatesRequestSchema,
  entryRegistrationCandidatesResponseSchema, entryRegistrationStartSlotCandidatesSchema } from "@o-tid/contracts";
import { entryClassAdminFailure as failure, entryClassAdminJson as json, readEntryClassAdminJson } from "./entry-class-admin-security";
import { readEntryIdentityAdminJson } from "./entry-identity-admin-security";
import { parseIdentityReceipt } from "./entry-identity-client";
import { parseRegistrationReceipt } from "./entry-registration-client";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/** Deltagare: lista, anmälan, identitet, klass, bricka, hyrbricka, betalning och starttid. Ger undefined för åtgärder som inte hör till gruppen. */
export async function handleEntryRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind === "participants") {
    const result = await dependencies.participants(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = entryClassAdminListResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "transfer-candidates") {
    const result = await dependencies.transferCandidates(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = entryTransferCandidatesSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "transfer-start-slot-candidates") {
    const result = await dependencies.transferStartSlotCandidates(db, { ...proof, raceId, entryId: action.entryId,
      targetClassId: action.targetClassId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = entryTransferStartSlotCandidatesSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId || response.targetClassId !== action.targetClassId) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
  }
  if (action.kind === "registration-start-slot-candidates") {
    const result = await dependencies.registrationStartSlotCandidates(db, { ...proof, raceId, targetClassId: action.targetClassId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = entryRegistrationStartSlotCandidatesSchema.parse(result.response);
    if (response.raceId !== raceId || response.targetClassId !== action.targetClassId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "registration-candidates") {
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryRegistrationCandidatesRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.registrationCandidates(db, { ...proof, raceId, request: parsed.data });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = entryRegistrationCandidatesResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.snapshotVersion !== parsed.data.expectedSnapshotVersion) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "registration") {
    const key = entryRegistrationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryRegistrationRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.registration(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "registered") return resultFailure(result.status);
    return json(parseRegistrationReceipt(result.response, raceId, {
      id: key.data.slice("entry-registration:".length), request: parsed.data
    }));
  }
  if (action.kind === "identity-candidates") {
    const result = await dependencies.identityCandidates(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = entryIdentityAdminListResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "identity") {
    const key = entryIdentityChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryIdentityAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryIdentityChangeRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.identity(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    return json(parseIdentityReceipt(result.response, raceId, {
      id: key.data.slice("entry-identity-change:".length), entryId: action.entryId, request: parsed.data
    }));
  }
  if (action.kind === "start-time") {
    const key = entryStartTimeChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryStartTimeChangeRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.startTime(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = entryStartTimeChangeResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId || response.classId !== parsed.data.expectedClassId ||
      response.requestId !== key.data.slice("entry-start-time-change:".length) || response.entryVersionBefore !== parsed.data.expectedEntryVersion ||
      response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion || response.previousFixedStartTime !== parsed.data.expectedFixedStartTime ||
      response.fixedStartTime !== parsed.data.fixedStartTime) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "card") {
    const key = entryCardChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryCardChangeRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.card(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = entryCardChangeResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId || response.classId !== parsed.data.expectedClassId ||
      response.requestId !== key.data.slice("entry-card-change:".length) || response.entryVersionBefore !== parsed.data.expectedEntryVersion ||
      response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion || response.activeAssignment.cardNumber !== parsed.data.cardNumber ||
      (response.previousAssignment?.id ?? null) !== (parsed.data.expectedAssignment?.id ?? null) ||
      (response.previousAssignment?.cardNumber ?? null) !== (parsed.data.expectedAssignment?.cardNumber ?? null)) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
  }
  if (action.kind === "card-rental") {
    const key = entryCardRentalChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryCardRentalChangeRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.cardRental(db, { ...proof, raceId, entryId: action.entryId,
      idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = entryCardRentalChangeResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId ||
      response.classId !== parsed.data.expectedClassId ||
      response.requestId !== key.data.slice("entry-card-rental-change:".length) ||
      response.assignment.id !== parsed.data.expectedAssignment.id ||
      response.assignment.cardNumber !== parsed.data.expectedAssignment.cardNumber ||
      response.previousIsRental !== parsed.data.expectedAssignment.isRental || response.isRental !== parsed.data.isRental ||
      response.entryVersionBefore !== parsed.data.expectedEntryVersion ||
      response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "card-rental-return") {
    const key = entryCardRentalReturnChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryCardRentalReturnChangeRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.cardRentalReturn(db, { ...proof, raceId, entryId: action.entryId,
      idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = entryCardRentalReturnChangeResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId ||
      response.classId !== parsed.data.expectedClassId ||
      response.requestId !== key.data.slice("entry-card-rental-return-change:".length) ||
      response.assignment.id !== parsed.data.expectedAssignment.id ||
      response.assignment.cardNumber !== parsed.data.expectedAssignment.cardNumber ||
      response.previousRentalReturned !== parsed.data.expectedAssignment.rentalReturned ||
      response.rentalReturned !== parsed.data.rentalReturned ||
      response.entryVersionBefore !== parsed.data.expectedEntryVersion ||
      response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "card-rental-reuse") {
    const key = entryCardRentalReuseIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryCardRentalReuseRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.cardRentalReuse(db, { ...proof, raceId, entryId: action.entryId,
      idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = entryCardRentalReuseResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.target.entryId !== action.entryId ||
      response.target.classId !== parsed.data.expectedTargetClassId ||
      response.requestId !== key.data.slice("entry-card-rental-reuse:".length) ||
      response.source.entryId !== parsed.data.source.entryId || response.source.classId !== parsed.data.source.classId ||
      response.source.assignment.id !== parsed.data.source.assignment.id ||
      response.source.assignment.cardNumber !== parsed.data.source.assignment.cardNumber ||
      response.sourceEntryVersionBefore !== parsed.data.source.entryVersion ||
      response.targetEntryVersionBefore !== parsed.data.expectedTargetEntryVersion ||
      response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "payment-status") {
    const key = entryPaymentStatusChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryPaymentStatusChangeRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.paymentStatus(db, { ...proof, raceId, entryId: action.entryId,
      idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = entryPaymentStatusChangeResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId ||
      response.classId !== parsed.data.expectedClassId ||
      response.requestId !== key.data.slice("entry-payment-status-change:".length) ||
      response.entryVersionAtChange !== parsed.data.expectedEntryVersion ||
      response.previousPaymentStatus !== parsed.data.expectedPaymentStatus ||
      response.paymentStatusVersionBefore !== parsed.data.expectedPaymentStatusVersion ||
      response.paymentStatus !== parsed.data.paymentStatus) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "transfer") {
    const key = entryTransferIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryTransferRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.transfer(db, { ...proof, raceId, entryId: action.entryId,
      idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "transferred") return resultFailure(result.status);
    const response = entryTransferResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId ||
      response.requestId !== key.data.slice("entry-transfer:".length) || JSON.stringify(response.request) !== JSON.stringify(parsed.data)) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
  }
  if (action.kind === "class") {
    const key = entryClassChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryClassChangeRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.changeClass(db, { ...proof, raceId, entryId: action.entryId,
      idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = entryClassChangeResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId || response.classId !== parsed.data.classId ||
      response.entryVersionBefore !== parsed.data.expectedEntryVersion || response.requestId !== key.data.slice("entry-class-change:".length)) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
  }
  return undefined;
}
