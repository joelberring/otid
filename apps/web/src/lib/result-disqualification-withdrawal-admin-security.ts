import {
  resultDisqualificationWithdrawalAdminErrorResponseSchema,
  type ResultDisqualificationWithdrawalAdminErrorCode
} from "@o-tid/contracts";
import {
  RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES,
  RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES,
  isResultDisqualificationWithdrawalAdminLoopbackHostname
} from "./result-disqualification-withdrawal-admin-cookies";
import {
  ResultWriteAdminConfigurationError,
  ResultWriteAdminRequestError,
  createResultWriteAdminSecurity,
  privateResultWriteAdminHeaders,
  type ResultWriteAdminSecurityPolicy,
  type ResultWriteAdminSessionProof
} from "./result-write-admin-security";

const tools = createResultWriteAdminSecurity({
  productionCookieNames: RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES,
  loopbackCookieNames: RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES,
  isLoopbackHostname: isResultDisqualificationWithdrawalAdminLoopbackHostname,
  errorResponseSchema: resultDisqualificationWithdrawalAdminErrorResponseSchema,
  configurationLabel: "återtagande av resultatdiskvalifikation"
});

export const resultDisqualificationWithdrawalAdminSecurityPolicy = tools.securityPolicy;
export const hasExpectedResultDisqualificationWithdrawalAdminOrigin = tools.hasExpectedOrigin;
export const resultDisqualificationWithdrawalAdminSessionProof = tools.sessionProof;
export const readResultDisqualificationWithdrawalAdminJson = tools.readJson;
export const hasNoResultDisqualificationWithdrawalAdminRequestBody = tools.hasNoBody;
export const setResultDisqualificationWithdrawalAdminCookies = tools.setCookies;
export const clearResultDisqualificationWithdrawalAdminCookies = tools.clearCookies;
export const resultDisqualificationWithdrawalAdminJson = tools.json;
export const resultDisqualificationWithdrawalAdminFailure = (
  status: 400 | 401 | 403 | 404 | 409 | 413 | 500,
  code: ResultDisqualificationWithdrawalAdminErrorCode
) => tools.failure(status, code);
export const privateResultDisqualificationWithdrawalAdminHeaders = privateResultWriteAdminHeaders;
export { ResultWriteAdminConfigurationError as ResultDisqualificationWithdrawalAdminConfigurationError };
export { ResultWriteAdminRequestError as ResultDisqualificationWithdrawalAdminRequestError };
export type ResultDisqualificationWithdrawalAdminSecurityPolicy = ResultWriteAdminSecurityPolicy<
  typeof RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES |
  typeof RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES
>;
export type ResultDisqualificationWithdrawalAdminSessionProof = ResultWriteAdminSessionProof;
