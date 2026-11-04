import {
  copyClubMapVersionFields, dismissClubMapDuplicates, listUsableClubMaps, mergeClubMaps, readClubMapDuplicates, undoClubMapMerge
} from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, readProof, type ClubEnvironment } from "./club-route-handlers";
import { privateJson } from "./security-policy";

/**
 * ADR-0210: dubbletter och versioner av klubbarkivets kartor och kartorna att välja i en ny tävling. Samma skydd som
 * arkivets övriga anrop (club-route-handlers.ts): Origin och CSRF på skrivningar, sessionen på läsningar.
 */
const validId = (id: string) => UUID_PATTERN.test(id);

/** GET "Möjliga dubbletter" (ägare och administratörer). */
export async function clubMapDuplicatesRoute(db: Database, request: Request, clubId: string, environment: ClubEnvironment = process.env): Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await readClubMapDuplicates(db, { ...input.proof, clubId });
    return result.status === "ok" ? privateJson(result.response) : failure(result.status);
  });
}

/** POST "Inte samma karta". */
export async function clubMapDismissRoute(db: Database, request: Request, clubId: string, environment: ClubEnvironment = process.env): Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await dismissClubMapDuplicates(db, { ...input.proof, clubId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, pairs: result.pairs }) : failure(result.status);
  });
}

/** POST "Slå ihop till en karta" (och "Slå ihop markerade"). */
export async function clubMapMergesRoute(db: Database, request: Request, clubId: string, environment: ClubEnvironment = process.env): Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await mergeClubMaps(db, { ...input.proof, clubId, request: input.body });
    return result.status === "ok" ? privateJson(result.response) : failure(result.status);
  });
}

/** POST "Ångra sammanslagning"; 409 när något annat har ändrat kartan sedan dess. */
export async function clubMapMergeUndoRoute(db: Database, request: Request, clubId: string, mergeId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!validId(clubId) || !validId(mergeId)) return failure("not-found");
  const input = await mutation(request, environment, "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await undoClubMapMerge(db, { ...input.proof, clubId, mergeId });
    return result.status === "ok" ? privateJson({ formatVersion: 1, mapIds: result.mapIds }) : failure(result.status);
  });
}

/** POST "Kopiera till alla versioner" och "Från kartan". */
export async function clubMapVersionsCopyRoute(db: Database, request: Request, clubId: string, mapId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!validId(clubId) || !validId(mapId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await copyClubMapVersionFields(db, { ...input.proof, clubId, mapId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, updated: result.updated }) : failure(result.status);
  });
}

/** GET kartorna kontot får använda i en ny tävling ("Välj karta från klubbarkivet"). */
export async function usableClubMapsRoute(db: Database, request: Request, environment: ClubEnvironment = process.env): Promise<Response> {
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await listUsableClubMaps(db, input.proof);
    return result.status === "ok" ? privateJson(result.response) : failure(result.status);
  });
}
