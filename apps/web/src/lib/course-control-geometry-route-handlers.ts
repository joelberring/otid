import { authenticatePairingAdminSession, createCourseControlGeometryAsAdmin, readCourseControlGeometryStateAsAdmin } from "@o-tid/application";
import { adminCourseControlGeometryStateResponseSchema, courseControlGeometryCreateRequestSchema, courseControlGeometryResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { RACE_ADMINISTRATOR_LOOPBACK_COOKIES, RACE_ADMINISTRATOR_PRODUCTION_COOKIES } from "./race-administrator-cookies";
import { entryClassAdminFailure, entryClassAdminJson, entryClassAdminSecurityPolicy, entryClassAdminSessionProof, hasExpectedEntryClassAdminOrigin, hasNoEntryClassAdminRequestBody, readEntryClassAdminJson } from "./entry-class-admin-security";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
function failure(status: 400 | 401 | 403 | 404 | 409 | 500) { return entryClassAdminFailure(status, status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR"); }
async function authorize(db: Database, request: Request, raceId: string, write: boolean, environment: Environment) {
  if (!uuid.test(raceId)) return { response: failure(400) } as const;
  let policy; try { const base = entryClassAdminSecurityPolicy(environment); policy = { ...base, cookieNames: base.secureCookies ? RACE_ADMINISTRATOR_PRODUCTION_COOKIES : RACE_ADMINISTRATOR_LOOPBACK_COOKIES }; } catch { return { response: failure(500) } as const; }
  if (write && !hasExpectedEntryClassAdminOrigin(request, policy)) return { response: failure(403) } as const;
  const proof = entryClassAdminSessionProof(request, policy, write);
  const auth = await authenticatePairingAdminSession(db, { ...proof, raceId, capability: "MANAGE_RACE", requireCsrf: write });
  if (auth.status !== "authenticated") return { response: failure(auth.status === "forbidden" ? 403 : 401) } as const;
  return { proof } as const;
}
export async function courseControlGeometryStateRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  const access = await authorize(db, request, raceId, false, environment); if ("response" in access) return access.response;
  if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400);
  const result = await readCourseControlGeometryStateAsAdmin(db, { ...access.proof, raceId });
  return result.status === "ok" ? entryClassAdminJson(adminCourseControlGeometryStateResponseSchema.parse(result.response)) : failure(result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : 400);
}
export async function createCourseControlGeometryRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  const access = await authorize(db, request, raceId, true, environment); if ("response" in access) return access.response;
  const key = request.headers.get("idempotency-key"); let body: unknown; try { body = await readEntryClassAdminJson(request); } catch { return failure(400); }
  const parsed = courseControlGeometryCreateRequestSchema.safeParse(body);
  if (!parsed.success || !key?.startsWith("course-control-geometry:")) return failure(400);
  const result = await createCourseControlGeometryAsAdmin(db, { ...access.proof, raceId, idempotencyKey: key, request: parsed.data });
  if (result.status === "created") return entryClassAdminJson(courseControlGeometryResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
  if (result.status === "not-found") return failure(404);
  return failure(result.status === "conflict" ? 409 : result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : 400);
}
