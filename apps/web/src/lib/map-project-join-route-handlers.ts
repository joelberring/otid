import {
  acceptMapProjectJoinLink, addMapProjectClubMember, createMapProjectJoinLink, listMapProjectClubMembers, readMapProjectJoinLink,
  revokeMapProjectJoinLink
} from "@o-tid/application";
import { UUID_PATTERN, mapProjectJoinLinkViewSchema, mapProjectJoinTokenRequestSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, readProof, type ClubEnvironment } from "./club-route-handlers";
import { SecurityConfigurationError, accountFailure, hasExpectedOrigin, privateJson, readJsonBody, securityPolicy } from "./security-policy";
import { logServerError } from "./server-error-log";

/**
 * Kartprojekt utan e-post (ägaren 2026-11-13): klubbmedlemmar att välja ur, och länkar för att gå med. Samma skydd som
 * kartprojektets övriga anrop (exakt Origin och CSRF på skrivningar, privata svar); behörigheten avgörs i tjänsterna.
 */
type Environment = ClubEnvironment;
const validId = (id: string) => UUID_PATTERN.test(id);

/** GET klubbmedlemmarna ägaren kan lägga till (`?q=` söker på namn), POST lägg till en (som en medlem i projektet). */
export async function mapProjectClubMembersRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return guarded(async () => {
      const result = await listMapProjectClubMembers(db, { ...input.proof, projectId, query });
      return result.status === "ok" ? privateJson(result.response) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await addMapProjectClubMember(db, { ...input.proof, projectId, request: input.body });
    return result.status === "added" ? privateJson({ formatVersion: 1, status: "added" }, 201) : failure(result.status);
  });
}

/** POST skapa en länk (nyckeln står bara i det här svaret), DELETE ta bort en länk. */
export async function mapProjectJoinLinksRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const args = { ...input.proof, projectId, request: input.body };
    if (request.method === "POST") {
      const result = await createMapProjectJoinLink(db, args);
      return result.status === "created" ? privateJson({ formatVersion: 1, linkId: result.linkId, token: result.token,
        expiresAt: result.expiresAt.toISOString() }, 201) : failure(result.status);
    }
    const result = await revokeMapProjectJoinLink(db, args);
    return result.status === "removed" ? privateJson({ formatVersion: 1, status: "removed" }) : failure(result.status);
  });
}

/** POST gå med med en länk (inloggad). */
export async function mapProjectJoinRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await acceptMapProjectJoinLink(db, { ...input.proof, request: input.body });
    return result.status === "joined" ? privateJson({ formatVersion: 1, status: "joined", projectId: result.projectId, role: result.role,
      alreadyMember: result.alreadyMember }) : failure(result.status);
  });
}

/** Länksidan (utan inloggning): vad länken gäller. Samma svar för okänd, borttagen och gammal länk. */
export async function mapProjectJoinLinkInfoRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  let configured;
  try { configured = securityPolicy(environment); }
  catch (error) {
    if (error instanceof SecurityConfigurationError) return accountFailure(500, "INTERNAL_ERROR");
    throw error;
  }
  if (!hasExpectedOrigin(request, configured)) return accountFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request, 2 * 1024); } catch { return accountFailure(400, "INVALID_REQUEST"); }
  const parsed = mapProjectJoinTokenRequestSchema.safeParse(body);
  if (!parsed.success) return privateJson(mapProjectJoinLinkViewSchema.parse({ formatVersion: 1, status: "invalid" }));
  try {
    return privateJson(mapProjectJoinLinkViewSchema.parse(await readMapProjectJoinLink(db, parsed.data.token)));
  } catch (error) {
    logServerError("map-project", "join-link", error);
    return accountFailure(500, "INTERNAL_ERROR");
  }
}
