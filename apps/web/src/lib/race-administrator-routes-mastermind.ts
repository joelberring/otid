import { mastermindSyncResponseSchema } from "@o-tid/contracts";
import { adminFailure as failure, privateJson as json, readJsonBody } from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/** Hela läget för en träning med många spel (ADR-0228: högst 1 000 spel, ett spel är högst några kB). */
const MASTERMIND_MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Mastermind med kontroller (ADR-0228): GET `mastermind` är serverns läge för träningen, POST skickar datorns läge och får
 * tillbaka det sammanslagna (arrangören och funktionären, `race-roles.ts`). PUT slår på eller av "Spela på egen dator"
 * (bara administratören). Ger undefined för andra åtgärder.
 */
export async function handleMastermindRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind !== "mastermind") return undefined;
  const input = { ...proof, raceId };
  if (request.method === "GET") {
    const result = await dependencies.mastermind(db, input);
    return result.status === "ok" ? json(mastermindSyncResponseSchema.parse(result.response)) : resultFailure(result.status);
  }
  let body: unknown;
  try { body = await readJsonBody(request, MASTERMIND_MAX_BODY_BYTES); } catch { return failure(400, "INVALID_REQUEST"); }
  const result = request.method === "PUT" ? await dependencies.mastermindStations(db, { ...input, request: body })
    : await dependencies.mastermindSync(db, { ...input, request: body });
  return result.status === "ok" ? json(mastermindSyncResponseSchema.parse(result.response)) : resultFailure(result.status);
}
