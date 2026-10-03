import { ingestReadoutsAsAdministrator, readReadoutPackageAsAdministrator } from "@o-tid/application";
import { deviceBatchAcknowledgementSchema, deviceBatchSchema, readoutPackageSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { DeviceBatchRequestError, readBoundedDeviceBatchJson } from "./device-batch-route-handler";
import {
  entryClassAdminFailure as failure,
  entryClassAdminJson as json,
  entryClassAdminSecurityPolicy,
  entryClassAdminSessionProof,
  hasExpectedEntryClassAdminOrigin
} from "./entry-class-admin-security";
import { RACE_ADMINISTRATOR_LOOPBACK_COOKIES, RACE_ADMINISTRATOR_PRODUCTION_COOKIES } from "./race-administrator-cookies";

/**
 * Webbläsarens avläsningsstation (steg 4, ADR-0168): hämtar avläsningspaket och
 * tar emot avläsningar med administratörens session (samma kakor som /manage).
 */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const services = { readPackage: readReadoutPackageAsAdministrator, ingest: ingestReadoutsAsAdministrator };

function policy(environment: Environment) {
  const base = entryClassAdminSecurityPolicy(environment);
  return { ...base, cookieNames: base.secureCookies ? RACE_ADMINISTRATOR_PRODUCTION_COOKIES : RACE_ADMINISTRATOR_LOOPBACK_COOKIES };
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
    const result = await dependencies.readPackage(db, { ...entryClassAdminSessionProof(request, configured, false), raceId });
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
  if (!hasExpectedEntryClassAdminOrigin(request, configured)) return failure(403, "FORBIDDEN");
  const proof = entryClassAdminSessionProof(request, configured, true);
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
