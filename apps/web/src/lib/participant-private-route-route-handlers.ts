import { listMyPrivateRoutes, readMyPrivateRoute } from "@o-tid/application";
import {
  participantPrivateRouteDetailResponseSchema,
  participantPrivateRouteListResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  hasNoOrganizerRequestBody, organizerFailure, organizerJson,
  organizerSecurityPolicy, organizerSessionProof
} from "./organizer-account-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function failure(status: 400 | 401 | 403 | 404 | 409 | 500): Response {
  return organizerFailure(status, status === 401 || status === 404 ? "UNAUTHORIZED" :
    status === 403 ? "FORBIDDEN" : status === 400 ? "INVALID_REQUEST" :
      status === 409 ? "CONFLICT" : "INTERNAL_ERROR");
}

function statusFailure(status: string): Response {
  switch (status) {
    case "unauthorized": return failure(401);
    case "forbidden": return failure(403);
    case "not-found": return failure(404);
    case "invalid-request": return failure(400);
    case "invalid-route": return failure(409);
    default: return failure(500);
  }
}

function accountPolicy(environment: Environment) {
  try { return { policy: organizerSecurityPolicy(environment) } as const; }
  catch { return { response: failure(500) } as const; }
}

export async function participantPrivateRouteListRoute(
  db: Database,
  request: Request,
  list: typeof listMyPrivateRoutes = listMyPrivateRoutes,
  environment: Environment = process.env
): Promise<Response> {
  const configured = accountPolicy(environment);
  if ("response" in configured) return configured.response;
  if (!await hasNoOrganizerRequestBody(request)) return failure(400);
  try {
    const result = await list(db, organizerSessionProof(request, configured.policy, false));
    if (result.status !== "ok") return statusFailure(result.status);
    return organizerJson(participantPrivateRouteListResponseSchema.parse(result.response));
  } catch { return failure(500); }
}

export async function participantPrivateRouteDetailRoute(
  db: Database,
  request: Request,
  routeUploadId: string,
  read: typeof readMyPrivateRoute = readMyPrivateRoute,
  environment: Environment = process.env
): Promise<Response> {
  const configured = accountPolicy(environment);
  if ("response" in configured) return configured.response;
  if (!uuid.test(routeUploadId)) return failure(404);
  if (!await hasNoOrganizerRequestBody(request)) return failure(400);
  try {
    const result = await read(db, organizerSessionProof(request, configured.policy, false), routeUploadId);
    if (result.status !== "ok") return statusFailure(result.status);
    const response = participantPrivateRouteDetailResponseSchema.parse(result.response);
    if (response.routeUploadId !== routeUploadId) return failure(500);
    return organizerJson(response);
  } catch { return failure(500); }
}
