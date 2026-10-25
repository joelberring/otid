import {
  raceCorrectionCommitResponseSchema, raceCorrectionListResponseSchema, raceCorrectionPreviewResponseSchema,
  readoutRereadCommitResponseSchema, readoutRereadPreviewResponseSchema, uninterpretedReadoutListResponseSchema,
  uninterpretedReadoutReceiptSchema, uninterpretedReadoutRereadResponseSchema
} from "@o-tid/contracts";
import { adminFailure as failure, privateJson as json, readJsonBody } from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * PLAN.md steg 31: rättningar för hela tävlingen (tidsjustering per station, kontroll ur funktion, flytta starttider,
 * räkna om hela tävlingen) och (steg 36) läs om avläsningar från rådata. Bara administratören (`race-roles.ts`). Ger undefined
 * för åtgärder som inte hör till gruppen.
 */
export async function handleCorrectionRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind === "readout-reread" || action.kind === "readout-reread-preview") return handleRereadRoute(context);
  if (action.kind === "uninterpreted-readouts" || action.kind === "uninterpreted-readouts-reread") return handleUninterpretedRoute(context);
  if (action.kind !== "race-corrections" && action.kind !== "race-corrections-preview") return undefined;
  if (action.kind === "race-corrections" && request.method === "GET") {
    const result = await dependencies.raceCorrections(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = raceCorrectionListResponseSchema.parse(result.response);
    return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
  }
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
  if (action.kind === "race-corrections-preview") {
    const result = await dependencies.raceCorrectionPreview(db, { ...proof, raceId, request: body });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = raceCorrectionPreviewResponseSchema.parse(result.response);
    return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
  }
  const result = await dependencies.raceCorrectionApply(db, { ...proof, raceId, request: body });
  if (result.status !== "applied") return resultFailure(result.status);
  const response = raceCorrectionCommitResponseSchema.parse(result.response);
  return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
}

async function handleRereadRoute(context: RaceAdministratorRouteContext): Promise<Response> {
  const { db, request, raceId, action, dependencies, proof } = context;
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
  if (action.kind === "readout-reread-preview") {
    const result = await dependencies.readoutRereadPreview(db, { ...proof, raceId, request: body });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = readoutRereadPreviewResponseSchema.parse(result.response);
    return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
  }
  const result = await dependencies.readoutReread(db, { ...proof, raceId, request: body });
  if (result.status !== "applied") return resultFailure(result.status);
  const response = readoutRereadCommitResponseSchema.parse(result.response);
  return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
}

/** Steg 45: otolkade avläsningar. Råramarna (högst tolv ramar) får plats i 32 KiB. */
const UNINTERPRETED_MAX_BODY_BYTES = 32 * 1024;

async function handleUninterpretedRoute(context: RaceAdministratorRouteContext): Promise<Response> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind === "uninterpreted-readouts" && request.method === "GET") {
    const result = await dependencies.uninterpretedList(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = uninterpretedReadoutListResponseSchema.parse(result.response);
    return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
  }
  let body: unknown;
  try { body = await readJsonBody(request, UNINTERPRETED_MAX_BODY_BYTES); } catch { return failure(400, "INVALID_REQUEST"); }
  if (action.kind === "uninterpreted-readouts") {
    const result = await dependencies.uninterpretedReceive(db, { ...proof, raceId, request: body });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = uninterpretedReadoutReceiptSchema.parse(result.response);
    return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
  }
  const result = await dependencies.uninterpretedReread(db, { ...proof, raceId, request: body });
  if (result.status !== "ok") return resultFailure(result.status);
  const response = uninterpretedReadoutRereadResponseSchema.parse(result.response);
  return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
}
