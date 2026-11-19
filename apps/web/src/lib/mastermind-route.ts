import { receiveMastermindStation } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { SecurityConfigurationError, clientAddress, hasExpectedOrigin, privateHeaders, readJsonBody, securityPolicy } from "./security-policy";
import { logServerError } from "./server-error-log";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
/** Datorns egna spel för en träning (högst 1 000 spel, ADR-0228). */
const MASTERMIND_STATION_MAX_BODY_BYTES = 2 * 1024 * 1024;

function failure(status: 400 | 403 | 404 | 429 | 500, error: string): Response {
  return Response.json({ formatVersion: 1, error }, { status, headers: privateHeaders });
}

/**
 * "Spela på egen dator" (ADR-0228), utan inloggning: exakt Origin, en begränsad JSON-body och tjänstens spärrar. Svaret är
 * datorns egna spel och träningens inställningar. Cachas aldrig.
 */
export async function mastermindStationRoute(db: Database, request: Request, raceId: string, staff: boolean, environment: Environment = process.env,
  now = new Date()): Promise<Response> {
  let policy;
  try { policy = securityPolicy(environment); }
  catch (error) { if (error instanceof SecurityConfigurationError) return failure(500, "INTERNAL_ERROR"); throw error; }
  if (!hasExpectedOrigin(request, policy)) return failure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request, MASTERMIND_STATION_MAX_BODY_BYTES); } catch { return failure(400, "INVALID_REQUEST"); }
  try {
    const result = await receiveMastermindStation(db, { raceId, clientKey: clientAddress(request), request: body, staff }, now);
    switch (result.status) {
      case "ok": return Response.json(result.response, { headers: privateHeaders });
      case "invalid-request": return failure(400, "INVALID_REQUEST");
      case "not-found": return failure(404, "NOT_FOUND");
      case "closed": return failure(403, "CLOSED");
      case "rate-limited": return failure(429, "RATE_LIMITED");
    }
  } catch (error) { logServerError("mastermind", "mastermindStationRoute", error); return failure(500, "INTERNAL_ERROR"); }
}
