import { StartCheckinAdminErrorResponseSchema, type StartCheckinAdminErrorResponse } from "@o-tid/contracts";
import {
  EntryClassAdminConfigurationError as StartCheckinAdminConfigurationError,
  clearEntryClassAdminCookies,
  entryClassAdminJson,
  entryClassAdminSecurityPolicy,
  entryClassAdminSessionProof,
  hasExpectedEntryClassAdminOrigin,
  hasNoEntryClassAdminRequestBody,
  privateEntryClassAdminHeaders,
  readEntryClassAdminJson,
  setEntryClassAdminCookies
} from "./entry-class-admin-security";
import {
  FINISH_FOREST_WATCH_ADMIN_LOOPBACK_COOKIE_NAMES,
  FINISH_FOREST_WATCH_ADMIN_PRODUCTION_COOKIE_NAMES,
  START_CHECKIN_ADMIN_LOOPBACK_COOKIE_NAMES,
  START_CHECKIN_ADMIN_PRODUCTION_COOKIE_NAMES,
  type StartCheckinAdminCookieNames
} from "./start-checkin-admin-cookies";

export { StartCheckinAdminConfigurationError };
export const privateStartCheckinAdminHeaders = privateEntryClassAdminHeaders;
export const readStartCheckinAdminJson = readEntryClassAdminJson;
export const hasNoStartCheckinAdminRequestBody = hasNoEntryClassAdminRequestBody;
export const hasExpectedStartCheckinAdminOrigin = hasExpectedEntryClassAdminOrigin;
export const startCheckinAdminSessionProof = entryClassAdminSessionProof;
export const setStartCheckinAdminCookies = setEntryClassAdminCookies;
export const clearStartCheckinAdminCookies = clearEntryClassAdminCookies;

export type StartCheckinCapability = "START_CHECKIN" | "FINISH_FOREST_WATCH";
export type StartCheckinAdminErrorCode = StartCheckinAdminErrorResponse["error"];

export function startCheckinAdminSecurityPolicy(
  capability: StartCheckinCapability,
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
) {
  const policy = entryClassAdminSecurityPolicy(environment);
  const cookieNames: StartCheckinAdminCookieNames = policy.secureCookies
    ? capability === "START_CHECKIN" ? START_CHECKIN_ADMIN_PRODUCTION_COOKIE_NAMES : FINISH_FOREST_WATCH_ADMIN_PRODUCTION_COOKIE_NAMES
    : capability === "START_CHECKIN" ? START_CHECKIN_ADMIN_LOOPBACK_COOKIE_NAMES : FINISH_FOREST_WATCH_ADMIN_LOOPBACK_COOKIE_NAMES;
  return { ...policy, cookieNames };
}

export function startCheckinAdminJson(body: unknown, status = 200): Response {
  return entryClassAdminJson(body, status);
}

export function startCheckinAdminFailure(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 500,
  code: StartCheckinAdminErrorCode
): Response {
  return startCheckinAdminJson(StartCheckinAdminErrorResponseSchema.parse({ formatVersion: 1, error: code }), status);
}
