import { authenticatePairingAdminSession, listSpeakerBoardAsAdmin, loginPairingAdmin, logoutPairingAdminSession } from "@o-tid/application";
import { speakerBoardLoginRequestSchema, speakerBoardLoginResponseSchema, speakerBoardResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  SpeakerBoardConfigurationError, clearSpeakerBoardCookies, hasExpectedSpeakerBoardOrigin, hasNoSpeakerBoardRequestBody,
  privateSpeakerBoardHeaders, readSpeakerBoardJson, setSpeakerBoardCookies, speakerBoardFailure, speakerBoardJson,
  speakerBoardSecurityPolicy, speakerBoardSessionProof
} from "./speaker-board-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type GetBoard = typeof listSpeakerBoardAsAdmin;

function validRaceId(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function policyOrFailure(environment: Environment) {
  try { return { policy: speakerBoardSecurityPolicy(environment) } as const; }
  catch (error) { if (error instanceof SpeakerBoardConfigurationError) return { response: speakerBoardFailure(500, "INTERNAL_ERROR") } as const; throw error; }
}
function invalidLoginStatus(value: unknown): 400 | 401 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return 400;
  const record = value as Record<string, unknown>, keys = Object.keys(record).sort();
  return keys.length === 2 && keys[0] === "accessCredential" && keys[1] === "formatVersion" && record.formatVersion === 1 && typeof record.accessCredential === "string" ? 401 : 400;
}

export async function speakerBoardLoginRoute(db: Database, request: Request, raceId: string, login: Login = loginPairingAdmin, environment: Environment = process.env): Promise<Response> {
  if (!validRaceId(raceId)) return speakerBoardFailure(404, "NOT_FOUND");
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedSpeakerBoardOrigin(request, configured.policy)) return speakerBoardFailure(403, "FORBIDDEN");
  let body: unknown; try { body = await readSpeakerBoardJson(request); } catch { return speakerBoardFailure(400, "INVALID_REQUEST"); }
  const parsed = speakerBoardLoginRequestSchema.safeParse(body);
  if (!parsed.success) { const status = invalidLoginStatus(body); return speakerBoardFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST"); }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "VIEW_SPEAKER_BOARD" });
    if (result.status === "unauthorized") return speakerBoardFailure(401, "UNAUTHORIZED");
    const response = speakerBoardLoginResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.capability !== "VIEW_SPEAKER_BOARD") return speakerBoardFailure(500, "INTERNAL_ERROR");
    return setSpeakerBoardCookies(speakerBoardJson(response), configured.policy, { sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt });
  } catch { return speakerBoardFailure(500, "INTERNAL_ERROR"); }
}
export async function speakerBoardSessionStatusRoute(db: Database, request: Request, raceId: string, authenticate: Authenticate = authenticatePairingAdminSession, environment: Environment = process.env): Promise<Response> {
  if (!validRaceId(raceId)) return speakerBoardFailure(404, "NOT_FOUND");
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  const proof = speakerBoardSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "VIEW_SPEAKER_BOARD" });
    if (result.status === "unauthorized") return speakerBoardFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return speakerBoardFailure(403, "FORBIDDEN");
    const response = speakerBoardLoginResponseSchema.parse({ formatVersion: 1, raceId: result.principal.raceId, capability: result.principal.capability, expiresAt: result.principal.expiresAt });
    return response.raceId === raceId && response.capability === "VIEW_SPEAKER_BOARD" ? speakerBoardJson(response) : speakerBoardFailure(500, "INTERNAL_ERROR");
  } catch { return speakerBoardFailure(500, "INTERNAL_ERROR"); }
}
export async function speakerBoardLogoutRoute(db: Database, request: Request, raceId: string, logout: Logout = logoutPairingAdminSession, environment: Environment = process.env): Promise<Response> {
  if (!validRaceId(raceId)) return speakerBoardFailure(404, "NOT_FOUND");
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedSpeakerBoardOrigin(request, configured.policy)) return speakerBoardFailure(403, "FORBIDDEN");
  const proof = speakerBoardSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, { ...proof, raceId, capability: "VIEW_SPEAKER_BOARD", readBodyIsEmpty: () => hasNoSpeakerBoardRequestBody(request) });
    if (result.status === "unauthorized") return clearSpeakerBoardCookies(speakerBoardFailure(401, "UNAUTHORIZED"), configured.policy);
    if (result.status === "forbidden") return speakerBoardFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return speakerBoardFailure(400, "INVALID_REQUEST");
    return clearSpeakerBoardCookies(new Response(null, { status: 204, headers: privateSpeakerBoardHeaders }), configured.policy);
  } catch { return speakerBoardFailure(500, "INTERNAL_ERROR"); }
}
export async function speakerBoardDataRoute(db: Database, request: Request, raceId: string, getBoard: GetBoard = listSpeakerBoardAsAdmin, environment: Environment = process.env): Promise<Response> {
  if (!validRaceId(raceId)) return speakerBoardFailure(404, "NOT_FOUND");
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  const proof = speakerBoardSessionProof(request, configured.policy, false);
  try {
    const result = await getBoard(db, { sessionToken: proof.sessionToken, raceId });
    if (result.status === "unauthorized") return speakerBoardFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return speakerBoardFailure(403, "FORBIDDEN");
    if (result.status === "not-found") return speakerBoardFailure(404, "NOT_FOUND");
    if (!("response" in result)) return speakerBoardFailure(500, "INTERNAL_ERROR");
    const response = speakerBoardResponseSchema.parse(result.response);
    return response.raceId === raceId ? speakerBoardJson(response) : speakerBoardFailure(500, "INTERNAL_ERROR");
  } catch { return speakerBoardFailure(500, "INTERNAL_ERROR"); }
}
