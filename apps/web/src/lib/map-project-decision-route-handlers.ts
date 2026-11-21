import { listMapProjectDecisions, recordMapProjectDecision } from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, readProof, type ClubEnvironment } from "./club-route-handlers";
import { privateJson } from "./security-policy";

/** Utkastets beslut (0132) kan ha 20 000 nycklar à ca 40 tecken. */
const DECISION_MAX_BYTES = 1_200_000;

/**
 * Kartritarens beslut om grundkartans förslag (ägaren 2026-11-21): POST när ett utkast läggs in (föreslå eller mer), GET
 * projektets beslut (ägarna). Samma skydd som projektets övriga anrop.
 */
export async function mapProjectDecisionsRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMapProjectDecisions(db, { ...input.proof, projectId });
      return result.status === "ok" ? privateJson({ formatVersion: 1, decisions: result.list }) : failure(result.status);
    });
  }
  const input = await mutation(request, environment, "json", DECISION_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await recordMapProjectDecision(db, { ...input.proof, projectId, request: input.body });
    if (result.status === "full") return privateJson({ formatVersion: 1, status: "full" }, 200);
    return result.status === "recorded" ? privateJson({ formatVersion: 1, status: "recorded" }, result.replayed ? 200 : 201) : failure(result.status);
  });
}
