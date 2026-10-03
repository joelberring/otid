import {
  redeemRouteUploadBearerLink,
  decideRoutePublicationConsentAsParticipant,
  readRoutePublicationConsentAsParticipant,
  readRouteUploadStatusAsParticipant,
  reserveRouteUploadAsParticipant,
  routeUploadBearerTokenPrefix,
  transferRouteUploadAsParticipant
} from "@o-tid/application";
import { routePublicationConsentIdempotencyKeySchema, routePublicationConsentRequestSchema, routePublicationConsentResponseSchema, routePublicationConsentStateResponseSchema, routeUploadReservationRequestSchema, routeUploadReservationResponseSchema, routeUploadStatusResponseSchema, routeUploadStorageReceiptSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { createConfiguredRouteStore } from "./route-store";
import {
  hasExpectedRouteUploadOrigin, privateRouteUploadHeaders, routeUploadFailure, routeUploadJson,
  routeUploadSecurityPolicy, routeUploadSessionProof, setRouteUploadCookies, type RouteUploadSecurityPolicy
} from "./route-upload-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const secret = /^[A-Za-z0-9_-]{43}$/;

function policyOrFailure(environment: Environment): { policy: RouteUploadSecurityPolicy } | { response: Response } {
  try { return { policy: routeUploadSecurityPolicy(environment) }; }
  catch { return { response: routeUploadFailure(500, "INTERNAL_ERROR") }; }
}
function key(request: Request): string | null { const value = request.headers.get("idempotency-key"); return value?.startsWith("route-upload:") ? value : null; }
function consentKey(request: Request): string | null { const value = request.headers.get("idempotency-key"); return value && routePublicationConsentIdempotencyKeySchema.safeParse(value).success ? value : null; }
async function json(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json" || !request.body) throw new Error("INVALID_JSON");
  const declared = request.headers.get("content-length"); if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) < 1 || Number(declared) > 4_096)) throw new Error("INVALID_JSON");
  const bytes = await request.arrayBuffer(); if (bytes.byteLength === 0 || bytes.byteLength > 4_096) throw new Error("INVALID_JSON");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
async function* requestBytes(request: Request, signal: AbortSignal): AsyncIterable<Uint8Array> {
  if (!request.body) return;
  const reader = request.body.getReader(), cancel = () => void reader.cancel(); signal.addEventListener("abort", cancel, { once: true });
  try { for (;;) { if (signal.aborted) return; const { done, value } = await reader.read(); if (done) return; yield value; } }
  finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => undefined); }
}

/** GET bearer route: creates cookies then redirects before any HTML or API request. */
export async function redeemRouteUploadLinkRoute(
  db: Database, request: Request, grantId: string, bearerSecret: string,
  redeem: typeof redeemRouteUploadBearerLink = redeemRouteUploadBearerLink, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!uuid.test(grantId) || !secret.test(bearerSecret)) return routeUploadFailure(404, "NOT_FOUND");
  const result = await redeem(db, `${routeUploadBearerTokenPrefix}.${grantId}.${bearerSecret}`);
  if (result.status !== "redeemed") return routeUploadFailure(404, "NOT_FOUND");
  const response = new Response(null, { status: 303, headers: { ...privateRouteUploadHeaders, location: "/route-upload" } });
  try { return setRouteUploadCookies(response, configured.policy, result); }
  catch { return routeUploadFailure(500, "INTERNAL_ERROR"); }
}

export async function routeUploadReservationRoute(
  db: Database, request: Request,
  reserve: typeof reserveRouteUploadAsParticipant = reserveRouteUploadAsParticipant, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedRouteUploadOrigin(request, configured.policy)) return routeUploadFailure(403, "FORBIDDEN");
  let body: unknown; try { body = await json(request); } catch { return routeUploadFailure(400, "INVALID_REQUEST"); }
  const intent = routeUploadReservationRequestSchema.safeParse(body), idempotencyKey = key(request);
  if (!intent.success || !idempotencyKey) return routeUploadFailure(400, "INVALID_REQUEST");
  const result = await reserve(db, { ...routeUploadSessionProof(request, configured.policy, true), idempotencyKey, request: intent.data });
  if (result.status === "reserved") return routeUploadJson(routeUploadReservationResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
  if (result.status === "conflict") return routeUploadFailure(409, "CONFLICT");
  if (result.status === "forbidden") return routeUploadFailure(403, "FORBIDDEN");
  if (result.status === "unauthorized") return routeUploadFailure(401, "UNAUTHORIZED");
  return routeUploadFailure(400, "INVALID_REQUEST");
}

/** Token-free private read after the bearer link has been exchanged for its host-only session. */
export async function routeUploadStatusRoute(
  db: Database, request: Request,
  readStatus: typeof readRouteUploadStatusAsParticipant = readRouteUploadStatusAsParticipant,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  const result = await readStatus(db, routeUploadSessionProof(request, configured.policy, false));
  if (result.status === "ok") return routeUploadJson(routeUploadStatusResponseSchema.parse(result.response));
  if (result.status === "forbidden") return routeUploadFailure(403, "FORBIDDEN");
  return routeUploadFailure(401, "UNAUTHORIZED");
}

/** Separate private state; it deliberately has no public-result or manifest selector. */
export async function routePublicationConsentStateRoute(
  db: Database, request: Request,
  readState: typeof readRoutePublicationConsentAsParticipant = readRoutePublicationConsentAsParticipant,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  const result = await readState(db, routeUploadSessionProof(request, configured.policy, false));
  if (result.status === "ok") return routeUploadJson(routePublicationConsentStateResponseSchema.parse(result.response));
  if (result.status === "forbidden") return routeUploadFailure(403, "FORBIDDEN");
  return routeUploadFailure(401, "UNAUTHORIZED");
}

export async function routePublicationConsentDecisionRoute(
  db: Database, request: Request,
  decide: typeof decideRoutePublicationConsentAsParticipant = decideRoutePublicationConsentAsParticipant,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedRouteUploadOrigin(request, configured.policy)) return routeUploadFailure(403, "FORBIDDEN");
  let body: unknown; try { body = await json(request); } catch { return routeUploadFailure(400, "INVALID_REQUEST"); }
  const intent = routePublicationConsentRequestSchema.safeParse(body), idempotencyKey = consentKey(request);
  if (!intent.success || !idempotencyKey) return routeUploadFailure(400, "INVALID_REQUEST");
  const result = await decide(db, { ...routeUploadSessionProof(request, configured.policy, true), idempotencyKey, request: intent.data });
  if (result.status === "stored") return routeUploadJson(routePublicationConsentResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
  if (result.status === "conflict") return routeUploadFailure(409, "CONFLICT");
  if (result.status === "not-found") return routeUploadFailure(404, "NOT_FOUND");
  if (result.status === "forbidden") return routeUploadFailure(403, "FORBIDDEN");
  if (result.status === "unauthorized") return routeUploadFailure(401, "UNAUTHORIZED");
  return routeUploadFailure(400, "INVALID_REQUEST");
}

export async function routeUploadTransferRoute(
  db: Database, request: Request, uploadId: string,
  transfer: typeof transferRouteUploadAsParticipant = transferRouteUploadAsParticipant, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!uuid.test(uploadId) || request.headers.get("content-type") !== "application/gpx+xml") return routeUploadFailure(400, "INVALID_REQUEST");
  if (!hasExpectedRouteUploadOrigin(request, configured.policy)) return routeUploadFailure(403, "FORBIDDEN");
  let store; try { store = createConfiguredRouteStore(); } catch { return routeUploadFailure(503, "INTERNAL_ERROR"); }
  const result = await transfer(db, { ...routeUploadSessionProof(request, configured.policy, true), uploadId,
    readBody: signal => requestBytes(request, signal) }, store);
  if (result.status === "stored") return routeUploadJson(routeUploadStorageReceiptSchema.parse(result.response), result.response.replayed ? 200 : 201);
  if (result.status === "not-found") return routeUploadFailure(404, "NOT_FOUND");
  if (result.status === "forbidden") return routeUploadFailure(403, "FORBIDDEN");
  if (result.status === "unauthorized") return routeUploadFailure(401, "UNAUTHORIZED");
  if (result.status === "invalid-body" || result.status === "invalid-request") return routeUploadFailure(400, "INVALID_REQUEST");
  if (result.status === "quota-exceeded") return routeUploadJson({ formatVersion: 1, error: "INTERNAL_ERROR" }, 429);
  return routeUploadFailure(503, "INTERNAL_ERROR");
}
