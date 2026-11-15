import { bingoAdminViewSchema } from "@o-tid/contracts";
import { adminFailure as failure, privateJson as json, readJsonBody } from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * Bingoorientering med telefonen (ADR-0225): GET `bingo` är ledarens vy (grupperna, löparna och spåren), PUT slår på eller
 * av telefonen. Bara administratören (`race-roles.ts`). Ger undefined för andra åtgärder.
 */
export async function handleBingoRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind !== "bingo") return undefined;
  const input = { ...proof, raceId };
  if (request.method === "GET") {
    const result = await dependencies.bingo(db, input);
    return result.status === "ok" ? json(bingoAdminViewSchema.parse(result.response)) : resultFailure(result.status);
  }
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
  const result = await dependencies.bingoSetting(db, { ...input, request: body });
  return result.status === "ok" ? json(bingoAdminViewSchema.parse(result.response)) : resultFailure(result.status);
}
