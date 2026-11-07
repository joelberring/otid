import { previewRaceBackup, restoreRaceBackup } from "@o-tid/application";
import {
  RACE_BACKUP_MAX_BYTES, raceBackupPreviewSchema, raceBackupProblemSchema, raceRestoreResponseSchema, type RaceBackupProblem
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  RequestBodyError, SecurityConfigurationError, accountFailure, hasExpectedOrigin, privateJson, readBoundedBytes, securityPolicy,
  sessionProof, validDeclaredLength, type SecurityPolicy
} from "./security-policy";
import { logServerError } from "./server-error-log";
import { routeMailer } from "./invitation-route-handlers";

/**
 * "Återställ tävling från säkerhetskopia" (ADR-0187): förhandsvisningen och återställningen tar emot zip-filen som den är
 * (högst RACE_BACKUP_MAX_BYTES). Kontots session och CSRF som när man skapar en tävling; ett avvisat innehåll ger 422 med
 * orsaken (`RaceBackupProblem`), för stort 413. Valen (begärans id och personerna) står i adressen.
 */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
const TYPES = new Set(["application/zip", "application/x-zip-compressed", "application/octet-stream"]);

const problem = (value: RaceBackupProblem, status = 422) => privateJson(raceBackupProblemSchema.parse(value), status);

async function upload(request: Request, environment: Environment): Promise<{ response: Response } | { policy: SecurityPolicy; bytes: Uint8Array }> {
  let policy: SecurityPolicy;
  try { policy = securityPolicy(environment); }
  catch (error) { if (error instanceof SecurityConfigurationError) return { response: accountFailure(500, "INTERNAL_ERROR") }; throw error; }
  if (!hasExpectedOrigin(request, policy)) return { response: accountFailure(403, "FORBIDDEN") };
  if (!TYPES.has((request.headers.get("content-type") ?? "").split(";")[0]!.trim())) return { response: accountFailure(400, "INVALID_REQUEST") };
  if (!validDeclaredLength(request, RACE_BACKUP_MAX_BYTES)) return { response: problem({ formatVersion: 1, error: "TOO_LARGE" }, 413) };
  try { return { policy, bytes: await readBoundedBytes(request, RACE_BACKUP_MAX_BYTES) }; }
  catch (error) {
    if (!(error instanceof RequestBodyError)) throw error;
    return { response: error.message === "Bodyn är för stor" ? problem({ formatVersion: 1, error: "TOO_LARGE" }, 413) : accountFailure(400, "INVALID_REQUEST") };
  }
}

function failure(status: string): Response {
  if (status === "unauthorized") return accountFailure(401, "UNAUTHORIZED");
  if (status === "forbidden") return accountFailure(403, "FORBIDDEN");
  if (status === "conflict") return accountFailure(409, "CONFLICT");
  return accountFailure(400, "INVALID_REQUEST");
}

export async function raceRestorePreviewRoute(db: Database, request: Request, environment: Environment = process.env,
  preview: typeof previewRaceBackup = previewRaceBackup): Promise<Response> {
  const input = await upload(request, environment);
  if ("response" in input) return input.response;
  try {
    const result = await preview(db, { ...sessionProof(request, input.policy, true), requireCsrf: true, bytes: input.bytes });
    if (result.status === "invalid") return problem(result.problem);
    if (result.status !== "ok") return failure(result.status);
    return privateJson(raceBackupPreviewSchema.parse(result.preview));
  } catch (error) { logServerError("race-restore", "raceRestorePreviewRoute", error); return accountFailure(500, "INTERNAL_ERROR"); }
}

export async function raceRestoreRoute(db: Database, request: Request, environment: Environment = process.env,
  restore: typeof restoreRaceBackup = restoreRaceBackup): Promise<Response> {
  const input = await upload(request, environment);
  if ("response" in input) return input.response;
  const search = new URL(request.url).searchParams;
  try {
    const result = await restore(db, { ...sessionProof(request, input.policy, true), requireCsrf: true, bytes: input.bytes,
      options: { requestId: search.get("requestId"), people: search.get("people") } }, new Date(), routeMailer(environment));
    if (result.status === "invalid") return problem(result.problem);
    if (result.status !== "restored") return failure(result.status);
    const response = raceRestoreResponseSchema.parse(result.response);
    return privateJson(response, response.replayed ? 200 : 201);
  } catch (error) { logServerError("race-restore", "raceRestoreRoute", error); return accountFailure(500, "INTERNAL_ERROR"); }
}
