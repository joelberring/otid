import { readSelfRegistrationInfo, selfRegisterCard } from "@o-tid/application";
import { selfRegistrationErrorResponseSchema, type SelfRegistrationErrorCode } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  SecurityConfigurationError, clientAddress, hasExpectedOrigin, privateHeaders, readJsonBody, securityPolicy
} from "./security-policy";

/**
 * Självregistrering på tävlingsdagen (PLAN.md steg 41), utan inloggning. Läsningen säger om formuläret är öppet; skrivningen
 * kräver exakt Origin, en liten JSON-body och går genom spärren per IP och tävling i tjänsten. Svaren cachas aldrig.
 */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;

function failure(status: 400 | 403 | 404 | 409 | 429 | 500, error: SelfRegistrationErrorCode, fields?: readonly string[]): Response {
  return Response.json(selfRegistrationErrorResponseSchema.parse({ formatVersion: 1, error, ...(fields?.length ? { fields } : {}) }),
    { status, headers: privateHeaders });
}

export async function selfRegistrationInfoRoute(db: Database, raceId: string, now = new Date()): Promise<Response> {
  const info = await readSelfRegistrationInfo(db, raceId, now);
  if (!info) return failure(404, "NOT_FOUND");
  return Response.json(info, { headers: { "cache-control": "no-store" } });
}

export async function selfRegistrationRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env,
  now = new Date()): Promise<Response> {
  let policy;
  try { policy = securityPolicy(environment); }
  catch (error) { if (error instanceof SecurityConfigurationError) return failure(500, "INTERNAL_ERROR"); throw error; }
  if (!hasExpectedOrigin(request, policy)) return failure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
  try {
    const result = await selfRegisterCard(db, { raceId, clientKey: clientAddress(request), request: body }, now);
    switch (result.status) {
      case "ok": return Response.json(result.response, { status: 201, headers: privateHeaders });
      case "invalid-request": return failure(400, "INVALID_REQUEST", result.fields);
      case "not-found": return failure(404, "NOT_FOUND");
      case "closed": return failure(403, "CLOSED");
      case "card-taken": return failure(409, "CARD_TAKEN");
      case "card-has-purchases": return failure(409, "CARD_HAS_PURCHASES");
      case "class-full": return failure(409, "CLASS_FULL");
      case "rate-limited": return failure(429, "RATE_LIMITED");
    }
  } catch { return failure(500, "INTERNAL_ERROR"); }
}
