import { relayClassCreateRequestSchema, relayClassCreateResponseSchema, relayClassEditRequestSchema, relayClassEditResponseSchema,
  relayEditRefusalSchema, relayLegRunnerRequestSchema, relayLegRunnerResponseSchema, relayLegVariantRequestSchema,
  relayLegVariantResponseSchema, relayOverviewSchema, relayStartTimesRequestSchema, relayStartTimesResponseSchema,
  relayTeamCreateRequestSchema, relayTeamCreateResponseSchema, relayTeamDidNotStartRequestSchema, relayTeamDidNotStartResponseSchema,
  relayTeamEditRequestSchema, relayTeamEditResponseSchema, relayTeamRemovalRequestSchema, relayTeamRemovalResponseSchema,
  type RelayClassEditPreview } from "@o-tid/contracts";
import {
  adminFailure as failure,
  privateJson as json,
  readJsonBody
} from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

type Parser = { safeParse(value: unknown): { success: true; data: { requestId: string } } | { success: false } };
type Writer = (db: RaceAdministratorRouteContext["db"], input: RaceAdministratorRouteContext["proof"] & { raceId: string;
  idempotencyKey: string; request: unknown }) => Promise<{ status: string; response?: unknown; preview?: RelayClassEditPreview }>;

/** Samma ram för skrivningar med request-id: idempotensnyckel, kropp, tjänst och kontroll av kvittot. */
/**
 * Stafettens skrivningar kan vara stora: en klass med 30 sträckor och ett lag med upp till 30 × 4 löpare (namn, klubb och
 * bricka per löpare). Den allmänna gränsen (4 KiB) räcker inte.
 */
export const RELAY_MAX_BODY_BYTES = 64 * 1024;

export async function write(context: RaceAdministratorRouteContext, prefix: string, request: Parser, response: { parse(value: unknown): unknown },
  service: Writer, maxBytes?: number): Promise<Response> {
  const { db, raceId, proof } = context;
  const key = context.request.headers.get("idempotency-key");
  let body: unknown;
  try { body = await readJsonBody(context.request, maxBytes); } catch { return failure(400, "INVALID_REQUEST"); }
  const parsed = request.safeParse(body);
  if (!parsed.success || key !== `${prefix}:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
  const result = await service(db, { ...proof, raceId, idempotencyKey: key, request: parsed.data });
  // Steg 47: ändringen kräver bekräftelse (beskedet följer med) eller tar bort en sträcka med resultat.
  if (result.status === "confirmation-required" && result.preview) {
    return json(relayEditRefusalSchema.parse({ formatVersion: 1, error: "CONFIRMATION_REQUIRED", preview: result.preview }), 409);
  }
  if (result.status === "leg-has-result") return json(relayEditRefusalSchema.parse({ formatVersion: 1, error: "LEG_HAS_RESULT" }), 409);
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
      return write(context, "relay-class", relayClassCreateRequestSchema, relayClassCreateResponseSchema, dependencies.relayClass, RELAY_MAX_BODY_BYTES);
    case "relay-team":
      return write(context, "relay-team", relayTeamCreateRequestSchema, relayTeamCreateResponseSchema, dependencies.relayTeam, RELAY_MAX_BODY_BYTES);
    case "relay-leg-runner":
      return write(context, "relay-leg-runner", relayLegRunnerRequestSchema, relayLegRunnerResponseSchema, dependencies.relayLegRunner, RELAY_MAX_BODY_BYTES);
    case "relay-start-times":
      return write(context, "relay-start-times", relayStartTimesRequestSchema, relayStartTimesResponseSchema, dependencies.relayStartTimes, RELAY_MAX_BODY_BYTES);
    case "relay-class-edit":
      return write(context, "relay-class-edit", relayClassEditRequestSchema, relayClassEditResponseSchema, dependencies.relayClassEdit, RELAY_MAX_BODY_BYTES);
    case "relay-team-edit":
      return write(context, "relay-team-edit", relayTeamEditRequestSchema, relayTeamEditResponseSchema, dependencies.relayTeamEdit, RELAY_MAX_BODY_BYTES);
    case "relay-team-removal":
      return write(context, "relay-team-removal", relayTeamRemovalRequestSchema, relayTeamRemovalResponseSchema, dependencies.relayTeamRemoval, RELAY_MAX_BODY_BYTES);
    case "relay-team-dns":
      return write(context, "relay-team-dns", relayTeamDidNotStartRequestSchema, relayTeamDidNotStartResponseSchema, dependencies.relayTeamDns, RELAY_MAX_BODY_BYTES);
    case "relay-leg-variant":
      return write(context, "relay-leg-variant", relayLegVariantRequestSchema, relayLegVariantResponseSchema, dependencies.relayLegVariant, RELAY_MAX_BODY_BYTES);
    default:
      return undefined;
  }
}
