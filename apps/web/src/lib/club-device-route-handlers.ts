import { changeClubDevice, listClubDevices, recordClubDevice } from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, problem, readProof, type ClubEnvironment } from "./club-route-handlers";
import { privateJson } from "./security-policy";

/**
 * Ägaren 2026-11-08: klubbens enhetsregister under /api/organizer/clubs/[clubId]/devices. GET listan (medlemmar), POST spara
 * efter en utläsning (Ledare eller mer), PUT anteckningen (Ledare eller mer), DELETE ta bort (Administratör).
 */
export async function clubDevicesRoute(db: Database, request: Request, clubId: string, environment: ClubEnvironment = process.env): Promise<Response> {
  if (!UUID_PATTERN.test(clubId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listClubDevices(db, { ...input.proof, clubId });
      return result.status === "ok" ? privateJson(result.list) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    if (request.method === "POST") {
      const result = await recordClubDevice(db, { ...input.proof, clubId, request: input.body });
      if (result.status === "ok") return privateJson({ formatVersion: 1, device: result.device });
      return result.status === "too-many" ? problem("TOO_MANY_DEVICES") : failure(result.status);
    }
    const result = await changeClubDevice(db, { ...input.proof, clubId, request: input.body, remove: request.method === "DELETE" });
    return result.status === "ok" ? privateJson({ formatVersion: 1 }) : failure(result.status);
  });
}
