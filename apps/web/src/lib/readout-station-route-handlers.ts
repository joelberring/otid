import { ingestReadoutsAsAdmin, readReadoutPackageAsAdmin, requireRaceRole } from "@o-tid/application";
import { deviceBatchAcknowledgementSchema, deviceBatchSchema, readoutPackageSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { DeviceBatchRequestError, readBoundedDeviceBatchJson } from "./readout-batch-body";
import {
  adminFailure as failure,
  hasExpectedOrigin,
  privateJson as json,
  securityPolicy,
  sessionProof
} from "./security-policy";
import { principalAllows, raceRoleFor } from "./race-roles";
import { UUID_PATTERN as uuid } from "@o-tid/contracts";

/**
 * Webbläsarens avläsningsstation (steg 4, ADR-0168): hämtar avläsningspaket och
 * tar emot avläsningar med kontots session och rollen administratör eller funktionär (ADR-0172, ADR-0173).
 */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
const services = { authenticate: requireRaceRole, readPackage: readReadoutPackageAsAdmin,
  ingest: ingestReadoutsAsAdmin };

function policy(environment: Environment) {
  return securityPolicy(environment);
}

function authFailure(status: "unauthorized" | "forbidden"): Response {
  return status === "unauthorized" ? failure(401, "UNAUTHORIZED") : failure(403, "FORBIDDEN");
}

export async function readoutPackageRoute(db: Database, request: Request, raceId: string,
  overrides: Partial<typeof services> = {}, environment: Environment = process.env): Promise<Response> {
  const dependencies = { ...services, ...overrides };
  if (!uuid.test(raceId)) return failure(400, "INVALID_REQUEST");
  let configured;
  try { configured = policy(environment); } catch { return failure(500, "INTERNAL_ERROR"); }
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
    console.error("Avläsningspaketet kunde inte skapas", error);
    return failure(500, "INTERNAL_ERROR");
  }
}

export async function readoutIngestRoute(db: Database, request: Request, raceId: string,
  overrides: Partial<typeof services> = {}, environment: Environment = process.env): Promise<Response> {
  const dependencies = { ...services, ...overrides };
  if (!uuid.test(raceId)) return failure(400, "INVALID_REQUEST");
  let configured;
  try { configured = policy(environment); } catch { return failure(500, "INTERNAL_ERROR"); }
  if (!hasExpectedOrigin(request, configured)) return failure(403, "FORBIDDEN");
  const proof = sessionProof(request, configured, true);
  try {
    const role = raceRoleFor("readouts", request.method);
    const auth = await dependencies.authenticate(db, { ...proof, raceId, role, requireCsrf: true });
    if (auth.status !== "authenticated") return authFailure(auth.status);
    if (!principalAllows(auth.principal, raceId, role)) return authFailure("forbidden");
  } catch (error) {
    console.error("Avläsningens behörighet kunde inte kontrolleras", error);
    return failure(500, "INTERNAL_ERROR");
  }
  let body: unknown;
  try { body = await readBoundedDeviceBatchJson(request); }
  catch (error) { return error instanceof DeviceBatchRequestError ? failure(400, "INVALID_REQUEST") : failure(500, "INTERNAL_ERROR"); }
  const parsed = deviceBatchSchema.safeParse(body);
  if (!parsed.success) return failure(400, "INVALID_REQUEST");
  try {
    const result = await dependencies.ingest(db, { ...proof, raceId, batch: parsed.data });
    if (result.status !== "ok") return authFailure(result.status);
    return json(deviceBatchAcknowledgementSchema.parse(result.response));
  } catch (error) {
    console.error("Avläsningar kunde inte tas emot", error);
    return failure(500, "INTERNAL_ERROR");
  }
}
