import {
  authenticatePairingAdminSession,
  exportFrozenIofResultListAsAdmin,
  exportIofResultListAsAdmin,
  listFrozenRaceFinalizationsAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  iofResultListExportAdminLoginRequestSchema,
  iofResultListExportAdminLoginResponseSchema,
  iofResultListExportMetadataSchema,
  frozenRaceFinalizationListResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  IofResultListExportAdminConfigurationError,
  clearIofResultListExportAdminCookies,
  hasExpectedIofResultListExportAdminOrigin,
  hasNoIofResultListExportAdminRequestBody,
  iofResultListExportAdminFailure,
  iofResultListExportAdminJson,
  iofResultListExportAdminSecurityPolicy,
  iofResultListExportAdminSessionProof,
  privateIofResultListExportAdminHeaders,
  readIofResultListExportAdminJson,
  setIofResultListExportAdminCookies
} from "./iof-result-list-export-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;

function policyOrFailure(environment: Environment) {
  try { return { policy: iofResultListExportAdminSecurityPolicy(environment) } as const; } catch (error) {
    if (error instanceof IofResultListExportAdminConfigurationError) {
      return { response: iofResultListExportAdminFailure(500, "INTERNAL_ERROR") } as const;
    }
    throw error;
  }
}

function invalidLoginStatus(value: unknown): 400 | 401 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return 400;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === 2 && keys[0] === "accessCredential" && keys[1] === "formatVersion" &&
    record.formatVersion === 1 && typeof record.accessCredential === "string" ? 401 : 400;
}

export async function iofResultListExportAdminLoginRoute(
  db: Database, request: Request, raceId: string,
  login = loginPairingAdmin, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedIofResultListExportAdminOrigin(request, configured.policy)) {
    return iofResultListExportAdminFailure(403, "FORBIDDEN");
  }
  let body: unknown;
  try { body = await readIofResultListExportAdminJson(request); } catch {
    return iofResultListExportAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = iofResultListExportAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return iofResultListExportAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, {
      expectedRaceId: raceId,
      expectedCapability: "EXPORT_IOF_RESULT_LIST"
    });
    if (result.status === "unauthorized") return iofResultListExportAdminFailure(401, "UNAUTHORIZED");
    const response = iofResultListExportAdminLoginResponseSchema.parse(result.response);
    return setIofResultListExportAdminCookies(iofResultListExportAdminJson(response), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: response.expiresAt
    });
  } catch { return iofResultListExportAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function iofResultListExportAdminSessionStatusRoute(
  db: Database, request: Request, raceId: string,
  authenticate = authenticatePairingAdminSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = iofResultListExportAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "EXPORT_IOF_RESULT_LIST" });
    if (result.status === "unauthorized") return iofResultListExportAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return iofResultListExportAdminFailure(403, "FORBIDDEN");
    return iofResultListExportAdminJson(iofResultListExportAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch { return iofResultListExportAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function iofResultListExportAdminLogoutRoute(
  db: Database, request: Request, raceId: string,
  logout = logoutPairingAdminSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedIofResultListExportAdminOrigin(request, configured.policy)) {
    return iofResultListExportAdminFailure(403, "FORBIDDEN");
  }
  const proof = iofResultListExportAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "EXPORT_IOF_RESULT_LIST",
      readBodyIsEmpty: () => hasNoIofResultListExportAdminRequestBody(request)
    });
    if (result.status === "unauthorized") return clearIofResultListExportAdminCookies(
      iofResultListExportAdminFailure(401, "UNAUTHORIZED"), configured.policy
    );
    if (result.status === "forbidden") return iofResultListExportAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return iofResultListExportAdminFailure(400, "INVALID_REQUEST");
    return clearIofResultListExportAdminCookies(
      new Response(null, { status: 204, headers: privateIofResultListExportAdminHeaders }), configured.policy
    );
  } catch { return iofResultListExportAdminFailure(500, "INTERNAL_ERROR"); }
}

function exportFailure(result: { status: string }): Response | undefined {
  if (result.status === "invalid-request") return iofResultListExportAdminFailure(400, "INVALID_REQUEST");
  if (result.status === "unauthorized") return iofResultListExportAdminFailure(401, "UNAUTHORIZED");
  if (result.status === "forbidden") return iofResultListExportAdminFailure(403, "FORBIDDEN");
  if (result.status === "not-found") return iofResultListExportAdminFailure(404, "NOT_FOUND");
  if (result.status === "conflict") return iofResultListExportAdminFailure(409, "CONFLICT");
  if (result.status === "too-large") return iofResultListExportAdminFailure(413, "TOO_LARGE");
  return undefined;
}

export async function iofResultListExportDownloadRoute(
  db: Database, request: Request, raceId: string,
  exportResultList = exportIofResultListAsAdmin, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = iofResultListExportAdminSessionProof(request, configured.policy, false);
  try {
    const result = await exportResultList(db, { sessionToken: proof.sessionToken, raceId });
    const failure = exportFailure(result);
    if (failure) return failure;
    if (!("bytes" in result) || !("metadata" in result)) {
      return iofResultListExportAdminFailure(500, "INTERNAL_ERROR");
    }
    const metadata = iofResultListExportMetadataSchema.parse(result.metadata);
    if (metadata.raceId !== raceId) return iofResultListExportAdminFailure(500, "INTERNAL_ERROR");
    const body = Uint8Array.from(result.bytes);
    const headers = new Headers(privateIofResultListExportAdminHeaders);
    headers.set("content-type", "application/xml; charset=utf-8");
    headers.set("content-disposition", `attachment; filename="otid-result-list-${raceId}.xml"`);
    headers.set("content-length", String(body.byteLength));
    headers.set("etag", `"sha256-${metadata.sha256}"`);
    headers.set("x-otid-content-sha256", metadata.sha256);
    headers.set("x-otid-race-id", metadata.raceId);
    headers.set("x-otid-snapshot-version", String(metadata.snapshotVersion));
    headers.set("x-otid-class-count", String(metadata.classCount));
    headers.set("x-otid-result-count", String(metadata.resultCount));
    headers.set("x-otid-stale-result-count", String(metadata.staleResultCount));
    headers.set("x-otid-omitted-entry-count", String(metadata.omittedEntryCount));
    return new Response(body, { status: 200, headers });
  } catch { return iofResultListExportAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function frozenRaceFinalizationListRoute(
  db: Database,
  request: Request,
  raceId: string,
  list = listFrozenRaceFinalizationsAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = iofResultListExportAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { sessionToken: proof.sessionToken, raceId });
    const failure = exportFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return iofResultListExportAdminFailure(500, "INTERNAL_ERROR");
    return iofResultListExportAdminJson(frozenRaceFinalizationListResponseSchema.parse(result.response));
  } catch {
    return iofResultListExportAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function frozenIofResultListDownloadRoute(
  db: Database,
  request: Request,
  raceId: string,
  finalizationId: string,
  exportResultList = exportFrozenIofResultListAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = iofResultListExportAdminSessionProof(request, configured.policy, false);
  try {
    const result = await exportResultList(db, {
      sessionToken: proof.sessionToken,
      raceId,
      finalizationId
    });
    const failure = exportFailure(result);
    if (failure) return failure;
    if (!("bytes" in result) || !("finalization" in result)) {
      return iofResultListExportAdminFailure(500, "INTERNAL_ERROR");
    }
    const finalization = result.finalization;
    if (finalization.raceId !== raceId || finalization.id !== finalizationId ||
        finalization.completeXmlSha256 === null) {
      return iofResultListExportAdminFailure(500, "INTERNAL_ERROR");
    }
    const body = Uint8Array.from(result.bytes);
    const headers = new Headers(privateIofResultListExportAdminHeaders);
    headers.set("content-type", "application/xml; charset=utf-8");
    headers.set("content-disposition", `attachment; filename="otid-complete-result-list-${raceId}-r${finalization.scopeRevision}.xml"`);
    headers.set("content-length", String(body.byteLength));
    headers.set("etag", `"sha256-${finalization.completeXmlSha256}"`);
    headers.set("x-otid-content-sha256", finalization.completeXmlSha256);
    headers.set("x-otid-race-id", finalization.raceId);
    headers.set("x-otid-finalization-id", finalization.id);
    headers.set("x-otid-finalization-revision", String(finalization.scopeRevision));
    headers.set("x-otid-snapshot-version", String(finalization.sourceSnapshotVersion));
    headers.set("x-otid-class-count", String(finalization.classCount));
    headers.set("x-otid-result-count", String(finalization.entryCount));
    return new Response(body, { status: 200, headers });
  } catch {
    return iofResultListExportAdminFailure(500, "INTERNAL_ERROR");
  }
}
