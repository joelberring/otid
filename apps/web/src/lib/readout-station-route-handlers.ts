import { ingestReadoutsAsAdmin, readReadoutPackageAsAdmin, requireRaceRole } from "@o-tid/application";
import { deviceBatchAcknowledgementSchema, deviceBatchSchema, readoutPackageSchema, type DeviceBatchAcknowledgement } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { DeviceBatchRequestError, readBoundedDeviceBatchJson } from "./readout-batch-body";
import { withPlacements } from "./readout-placement";
import {
  adminFailure as failure,
  hasExpectedOrigin,
  privateJson as json,
  securityPolicy,
  sessionProof
} from "./security-policy";
import { principalAllows, raceRoleFor } from "./race-roles";
import { UUID_PATTERN as uuid } from "@o-tid/contracts";
import { retryTransactionConflicts } from "./read-conflict";
import { isDatabaseUnavailable, logServerError } from "./server-error-log";

/**
 * Webbläsarens avläsningsstation (steg 4, ADR-0168): hämtar avläsningspaket och
 * tar emot avläsningar med kontots session och rollen administratör eller funktionär (ADR-0172, ADR-0173).
 */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
/** Steg 57: placeringen till kvittot ur de cachade listorna (inläst först här, så att testerna inte behöver cachen). */
async function placeReadouts(db: Database, raceId: string, acknowledgement: DeviceBatchAcknowledgement): Promise<DeviceBatchAcknowledgement> {
  const { latestStaffResults, latestRelayResults } = await import("./public-race-data");
  return withPlacements(db, raceId, acknowledgement, { results: latestStaffResults, relay: latestRelayResults });
}

const services = { authenticate: requireRaceRole, readPackage: readReadoutPackageAsAdmin,
  ingest: ingestReadoutsAsAdmin, place: placeReadouts };

function policy(environment: Environment) {
  return securityPolicy(environment);
}

/** Databasen går inte att nå: 503, så att avläsningen väntar och skickar om. Annars 500. */
function unavailableOrFailure(error: unknown): Response {
  if (!isDatabaseUnavailable(error)) return failure(500, "INTERNAL_ERROR");
  const response = failure(503, "SERVICE_UNAVAILABLE");
  response.headers.set("retry-after", "5");
  return response;
}

function authFailure(status: "unauthorized" | "forbidden"): Response {
  return status === "unauthorized" ? failure(401, "UNAUTHORIZED") : failure(403, "FORBIDDEN");
}

export async function readoutPackageRoute(db: Database, request: Request, raceId: string,
  overrides: Partial<typeof services> = {}, environment: Environment = process.env): Promise<Response> {
  const dependencies = { ...services, ...overrides };
  if (!uuid.test(raceId)) return failure(400, "INVALID_REQUEST");
  let configured;
  try { configured = policy(environment); } catch (error) { logServerError("readout", "security-policy", error); return failure(500, "INTERNAL_ERROR"); }
  try {
    const proof = sessionProof(request, configured, false);
    const role = raceRoleFor("readout-package", request.method);
    const auth = await dependencies.authenticate(db, { ...proof, raceId, role });
    if (auth.status !== "authenticated") return authFailure(auth.status);
    if (!principalAllows(auth.principal, raceId, role)) return authFailure("forbidden");
    const result = await dependencies.readPackage(db, { ...proof, raceId });
    if (result.status !== "ok") return authFailure(result.status);
    return json(readoutPackageSchema.parse(result.response));
  } catch (error) {
    logServerError("readout", "package", error);
    return unavailableOrFailure(error);
  }
}

export async function readoutIngestRoute(db: Database, request: Request, raceId: string,
  overrides: Partial<typeof services> = {}, environment: Environment = process.env): Promise<Response> {
  const dependencies = { ...services, ...overrides };
  if (!uuid.test(raceId)) return failure(400, "INVALID_REQUEST");
  let configured;
  try { configured = policy(environment); } catch (error) { logServerError("readout", "security-policy", error); return failure(500, "INTERNAL_ERROR"); }
  if (!hasExpectedOrigin(request, configured)) return failure(403, "FORBIDDEN");
  const proof = sessionProof(request, configured, true);
  try {
    const role = raceRoleFor("readouts", request.method);
    const auth = await dependencies.authenticate(db, { ...proof, raceId, role, requireCsrf: true });
    if (auth.status !== "authenticated") return authFailure(auth.status);
    if (!principalAllows(auth.principal, raceId, role)) return authFailure("forbidden");
  } catch (error) {
    logServerError("readout", "authenticate", error);
    return unavailableOrFailure(error);
  }
  let body: unknown;
  try { body = await readBoundedDeviceBatchJson(request); }
  catch (error) {
    if (error instanceof DeviceBatchRequestError) return failure(400, "INVALID_REQUEST");
    logServerError("readout", "read-body", error);
    return failure(500, "INTERNAL_ERROR");
  }
  const parsed = deviceBatchSchema.safeParse(body);
  if (!parsed.success) return failure(400, "INVALID_REQUEST");
  try {
    // Översynen 2026-11-02: mottagningen är idempotent (enhet, löpnummer, hash). En transaktion som PostgreSQL avbröt
    // (40001, 40P01) görs om i databaspoolen (`createDatabase`); kvarstår felet görs hela mottagningen om en gång till här.
    const result = await retryTransactionConflicts(() => dependencies.ingest(db, { ...proof, raceId, batch: parsed.data }));
    if (result.status !== "ok") return authFailure(result.status);
    return json(deviceBatchAcknowledgementSchema.parse(await dependencies.place(db, raceId, result.response)));
  } catch (error) {
    logServerError("readout", "ingest", error);
    return unavailableOrFailure(error);
  }
}
