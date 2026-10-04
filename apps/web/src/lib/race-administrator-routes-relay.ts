import { relayClassCreateRequestSchema, relayClassCreateResponseSchema, relayLegRunnerRequestSchema, relayLegRunnerResponseSchema,
  relayOverviewSchema, relayStartTimesRequestSchema, relayStartTimesResponseSchema, relayTeamCreateRequestSchema,
  relayTeamCreateResponseSchema } from "@o-tid/contracts";
import { entryClassAdminFailure as failure, entryClassAdminJson as json, readEntryClassAdminJson } from "./entry-class-admin-security";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

type Parser = { safeParse(value: unknown): { success: true; data: { requestId: string } } | { success: false } };
type Writer = (db: RaceAdministratorRouteContext["db"], input: RaceAdministratorRouteContext["proof"] & { raceId: string;
  idempotencyKey: string; request: unknown }) => Promise<{ status: string; response?: unknown }>;

/** Samma ram för stafettens fyra skrivningar: idempotensnyckel, kropp, tjänst och kontroll av kvittot. */
async function write(context: RaceAdministratorRouteContext, prefix: string, request: Parser, response: { parse(value: unknown): unknown },
  service: Writer): Promise<Response> {
  const { db, raceId, proof } = context;
  const key = context.request.headers.get("idempotency-key");
  let body: unknown;
  try { body = await readEntryClassAdminJson(context.request); } catch { return failure(400, "INVALID_REQUEST"); }
  const parsed = request.safeParse(body);
  if (!parsed.success || key !== `${prefix}:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
  const result = await service(db, { ...proof, raceId, idempotencyKey: key, request: parsed.data });
  if (result.status !== "saved") return resultFailure(result.status);
  const receipt = response.parse(result.response) as { raceId: string; requestId: string; request: unknown };
  if (receipt.raceId !== raceId || receipt.requestId !== parsed.data.requestId ||
      JSON.stringify(receipt.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
  return json(receipt);
}

/** Stafett (ADR-0169 beslut 3): lagvyn, ny stafettklass, nytt lag, byt sträcklöpare och starttider. Ger undefined för andra åtgärder. */
export async function handleRelayRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, raceId, action, dependencies, proof } = context;
  switch (action.kind) {
    case "relay": {
      const result = await dependencies.relayOverview(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = relayOverviewSchema.parse(result.response);
      return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
    }
    case "relay-class":
      return write(context, "relay-class", relayClassCreateRequestSchema, relayClassCreateResponseSchema, dependencies.relayClass);
    case "relay-team":
      return write(context, "relay-team", relayTeamCreateRequestSchema, relayTeamCreateResponseSchema, dependencies.relayTeam);
    case "relay-leg-runner":
      return write(context, "relay-leg-runner", relayLegRunnerRequestSchema, relayLegRunnerResponseSchema, dependencies.relayLegRunner);
    case "relay-start-times":
      return write(context, "relay-start-times", relayStartTimesRequestSchema, relayStartTimesResponseSchema, dependencies.relayStartTimes);
    default:
      return undefined;
  }
}
