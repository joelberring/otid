import {
  acknowledgeRaceMapPublicUse, addGroupMember, createGroupSessions, createTrainingGroup, deleteLibraryMap, listMyGroups, readGroupAsLeader,
  readRaceMapAgreementAsAdmin, removeGroupMember, removeGroupSession, saveRaceMapToLibrary, setRaceGroup, undoGroupSeries, updateGroupSettings,
  updateLibraryMap
} from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  SecurityConfigurationError, accountFailure, hasExpectedOrigin, hasNoRequestBody, privateJson, readJsonBody, securityPolicy, sessionProof,
  type SecurityPolicy
} from "./security-policy";
import { logServerError } from "./server-error-log";

/**
 * Steg 68 (ADR-0182): träningsgruppernas anrop under /api/organizer/groups och tävlingens grupp och kartavtal. Samma skydd
 * som kontots andra anrop: exakt Origin och CSRF på skrivningar, privata svar utan cache. Behörigheten avgörs i tjänsterna.
 */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
/** Avtalet är fri text (högst 2000 tecken), så skrivningarna får större kropp än kontots övriga. */
const BODY_MAX = 16 * 1024;

function policy(environment: Environment): { value: SecurityPolicy } | { response: Response } {
  try { return { value: securityPolicy(environment) }; }
  catch (error) {
    if (error instanceof SecurityConfigurationError) return { response: accountFailure(500, "INTERNAL_ERROR") };
    throw error;
  }
}

function failure(status: string): Response {
  switch (status) {
    case "unauthorized": return accountFailure(401, "UNAUTHORIZED");
    case "forbidden": return accountFailure(403, "FORBIDDEN");
    case "invalid-request": return accountFailure(400, "INVALID_REQUEST");
    case "not-found": return accountFailure(404, "NOT_FOUND");
    case "conflict": return accountFailure(409, "CONFLICT");
    default: return accountFailure(500, "INTERNAL_ERROR");
  }
}

type Proof = ReturnType<typeof sessionProof>;

async function mutation(request: Request, environment: Environment, withBody = true)
  : Promise<{ response: Response } | { body: unknown; proof: Proof }> {
  const configured = policy(environment);
  if ("response" in configured) return configured;
  if (!hasExpectedOrigin(request, configured.value)) return { response: accountFailure(403, "FORBIDDEN") };
  let body: unknown = undefined;
  if (withBody) {
    try { body = await readJsonBody(request, BODY_MAX); } catch { return { response: accountFailure(400, "INVALID_REQUEST") }; }
  } else if (!await hasNoRequestBody(request)) return { response: accountFailure(400, "INVALID_REQUEST") };
  return { body, proof: sessionProof(request, configured.value, true) };
}

async function readProof(request: Request, environment: Environment): Promise<{ response: Response } | { proof: Proof }> {
  const configured = policy(environment);
  if ("response" in configured) return configured;
  if (!await hasNoRequestBody(request)) return { response: accountFailure(400, "INVALID_REQUEST") };
  return { proof: sessionProof(request, configured.value, false) };
}

async function guarded(run: () => Promise<Response>): Promise<Response> {
  try { return await run(); }
  catch (error) {
    logServerError("training-group", "route", error);
    return accountFailure(500, "INTERNAL_ERROR");
  }
}

const validId = (id: string) => UUID_PATTERN.test(id);

export async function groupsListRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await listMyGroups(db, input.proof);
    return result.status === "ok" ? privateJson({ formatVersion: 1, groups: result.groups }) : failure(result.status);
  });
}

export async function groupCreateRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createTrainingGroup(db, { ...input.proof, request: input.body });
    return result.status === "created" ? privateJson({ formatVersion: 1, group: result.group }, result.replayed ? 200 : 201) : failure(result.status);
  });
}

export async function groupReadRoute(db: Database, request: Request, groupId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(groupId)) return failure("not-found");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await readGroupAsLeader(db, { ...input.proof, groupId });
    return result.status === "ok" ? privateJson(result.view) : failure(result.status);
  });
}

export async function groupSettingsRoute(db: Database, request: Request, groupId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(groupId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await updateGroupSettings(db, { ...input.proof, groupId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, settingsVersion: result.settingsVersion }) : failure(result.status);
  });
}

export async function groupMemberAddRoute(db: Database, request: Request, groupId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(groupId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await addGroupMember(db, { ...input.proof, groupId, request: input.body });
    return result.status === "added" ? privateJson({ formatVersion: 1, member: result.member }, result.replayed ? 200 : 201) : failure(result.status);
  });
}

export async function groupMemberRemoveRoute(db: Database, request: Request, groupId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(groupId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await removeGroupMember(db, { ...input.proof, groupId, request: input.body });
    return result.status === "removed" ? privateJson({ formatVersion: 1, status: "removed" }) : failure(result.status);
  });
}

export async function groupSessionsCreateRoute(db: Database, request: Request, groupId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(groupId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createGroupSessions(db, { ...input.proof, groupId, request: input.body });
    if (result.status === "agreement") return privateJson({ formatVersion: 1, error: "MAP_AGREEMENT", issues: result.issues }, 409);
    return result.status === "created" ? privateJson({ formatVersion: 1, raceIds: result.raceIds, seriesId: result.seriesId },
      result.replayed ? 200 : 201) : failure(result.status);
  });
}

export async function groupSeriesUndoRoute(db: Database, request: Request, groupId: string, seriesId: string,
  environment: Environment = process.env): Promise<Response> {
  if (!validId(groupId) || !validId(seriesId)) return failure("not-found");
  const input = await mutation(request, environment, false);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await undoGroupSeries(db, { ...input.proof, groupId, seriesId });
    return result.status === "undone" ? privateJson({ formatVersion: 1, removed: result.removed, kept: result.kept }) : failure(result.status);
  });
}

export async function groupSessionRemoveRoute(db: Database, request: Request, groupId: string, raceId: string,
  environment: Environment = process.env): Promise<Response> {
  if (!validId(groupId) || !validId(raceId)) return failure("not-found");
  const input = await mutation(request, environment, false);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await removeGroupSession(db, { ...input.proof, groupId, raceId });
    return result.status === "removed" ? privateJson({ formatVersion: 1, status: "removed" }) : failure(result.status);
  });
}

export async function groupMapSaveRoute(db: Database, request: Request, groupId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(groupId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await saveRaceMapToLibrary(db, { ...input.proof, groupId, request: input.body });
    return result.status === "saved" ? privateJson({ formatVersion: 1, mapId: result.mapId }, result.replayed ? 200 : 201) : failure(result.status);
  });
}

export async function groupMapUpdateRoute(db: Database, request: Request, groupId: string, mapId: string,
  environment: Environment = process.env): Promise<Response> {
  if (!validId(groupId) || !validId(mapId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await updateLibraryMap(db, { ...input.proof, groupId, mapId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, races: result.races }) : failure(result.status);
  });
}

export async function groupMapDeleteRoute(db: Database, request: Request, groupId: string, mapId: string,
  environment: Environment = process.env): Promise<Response> {
  if (!validId(groupId) || !validId(mapId)) return failure("not-found");
  const input = await mutation(request, environment, false);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await deleteLibraryMap(db, { ...input.proof, groupId, mapId });
    return result.status === "deleted" ? privateJson({ formatVersion: 1, status: "deleted" }) : failure(result.status);
  });
}

/** Tävlingen (hela evenemanget) läggs till i eller tas ur en grupp. */
export async function raceGroupRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(raceId)) return failure("invalid-request");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await setRaceGroup(db, { ...input.proof, raceId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, groupId: result.groupId }) : failure(result.status);
  });
}

/** Kartans avtal på tävlingen (GET) och "Visa kartan publikt ändå" (PUT). */
export async function raceMapAgreementReadRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(raceId)) return failure("invalid-request");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await readRaceMapAgreementAsAdmin(db, { raceId, sessionToken: input.proof.sessionToken });
    return result.status === "ok" ? privateJson({ formatVersion: 1, agreement: result.agreement }) : failure(result.status);
  });
}

export async function raceMapAgreementAcknowledgeRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(raceId)) return failure("invalid-request");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await acknowledgeRaceMapPublicUse(db, { raceId, sessionToken: input.proof.sessionToken, csrfCookie: input.proof.csrfCookie,
      csrfHeader: input.proof.csrfHeader, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, agreement: result.agreement }) : failure(result.status);
  });
}
