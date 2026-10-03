import {
  withoutTimingWithdrawalAdminErrorResponseSchema,
  type WithoutTimingWithdrawalAdminErrorCode
} from "@o-tid/contracts";
import {
  WITHOUT_TIMING_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES,
  WITHOUT_TIMING_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES,
  isWithoutTimingWithdrawalAdminLoopbackHostname
} from "./without-timing-withdrawal-admin-cookies";
import {
  ResultWriteAdminConfigurationError,
  ResultWriteAdminRequestError,
  createResultWriteAdminSecurity,
  privateResultWriteAdminHeaders,
  type ResultWriteAdminSecurityPolicy,
  type ResultWriteAdminSessionProof
} from "./result-write-admin-security";

const tools = createResultWriteAdminSecurity({
  productionCookieNames: WITHOUT_TIMING_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES,
  loopbackCookieNames: WITHOUT_TIMING_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES,
  isLoopbackHostname: isWithoutTimingWithdrawalAdminLoopbackHostname,
  errorResponseSchema: withoutTimingWithdrawalAdminErrorResponseSchema,
  configurationLabel: "återtagande av utan tidtagning"
});

export const withoutTimingWithdrawalAdminSecurityPolicy = tools.securityPolicy;
export const hasExpectedWithoutTimingWithdrawalAdminOrigin = tools.hasExpectedOrigin;
export const withoutTimingWithdrawalAdminSessionProof = tools.sessionProof;
export const readWithoutTimingWithdrawalAdminJson = tools.readJson;
export const hasNoWithoutTimingWithdrawalAdminRequestBody = tools.hasNoBody;
export const setWithoutTimingWithdrawalAdminCookies = tools.setCookies;
export const clearWithoutTimingWithdrawalAdminCookies = tools.clearCookies;
export const withoutTimingWithdrawalAdminJson = tools.json;
export const withoutTimingWithdrawalAdminFailure = (
  status: 400 | 401 | 403 | 404 | 409 | 413 | 500,
  code: WithoutTimingWithdrawalAdminErrorCode
) => tools.failure(status, code);
export const privateWithoutTimingWithdrawalAdminHeaders = privateResultWriteAdminHeaders;
export { ResultWriteAdminConfigurationError as WithoutTimingWithdrawalAdminConfigurationError };
export { ResultWriteAdminRequestError as WithoutTimingWithdrawalAdminRequestError };
export type WithoutTimingWithdrawalAdminSecurityPolicy = ResultWriteAdminSecurityPolicy<
  typeof WITHOUT_TIMING_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES |
  typeof WITHOUT_TIMING_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES
>;
export type WithoutTimingWithdrawalAdminSessionProof = ResultWriteAdminSessionProof;
