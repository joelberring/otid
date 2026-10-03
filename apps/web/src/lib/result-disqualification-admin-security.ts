import {
  resultDisqualificationAdminErrorResponseSchema,
  type ResultDisqualificationAdminErrorCode
} from "@o-tid/contracts";
import {
  RESULT_DISQUALIFICATION_ADMIN_LOOPBACK_COOKIE_NAMES,
  RESULT_DISQUALIFICATION_ADMIN_PRODUCTION_COOKIE_NAMES,
  isResultDisqualificationAdminLoopbackHostname
} from "./result-disqualification-admin-cookies";
import {
  ResultWriteAdminConfigurationError,
  ResultWriteAdminRequestError,
  createResultWriteAdminSecurity,
  privateResultWriteAdminHeaders,
  type ResultWriteAdminSecurityPolicy,
  type ResultWriteAdminSessionProof
} from "./result-write-admin-security";

const tools = createResultWriteAdminSecurity({
  productionCookieNames: RESULT_DISQUALIFICATION_ADMIN_PRODUCTION_COOKIE_NAMES,
  loopbackCookieNames: RESULT_DISQUALIFICATION_ADMIN_LOOPBACK_COOKIE_NAMES,
  isLoopbackHostname: isResultDisqualificationAdminLoopbackHostname,
  errorResponseSchema: resultDisqualificationAdminErrorResponseSchema,
  configurationLabel: "resultatdiskvalifikation"
});

export const resultDisqualificationAdminSecurityPolicy = tools.securityPolicy;
export const hasExpectedResultDisqualificationAdminOrigin = tools.hasExpectedOrigin;
export const resultDisqualificationAdminSessionProof = tools.sessionProof;
export const readResultDisqualificationAdminJson = tools.readJson;
export const hasNoResultDisqualificationAdminRequestBody = tools.hasNoBody;
export const setResultDisqualificationAdminCookies = tools.setCookies;
export const clearResultDisqualificationAdminCookies = tools.clearCookies;
export const resultDisqualificationAdminJson = tools.json;
export const resultDisqualificationAdminFailure = (
  status: 400 | 401 | 403 | 404 | 409 | 413 | 500,
  code: ResultDisqualificationAdminErrorCode
) => tools.failure(status, code);
export const privateResultDisqualificationAdminHeaders = privateResultWriteAdminHeaders;
export { ResultWriteAdminConfigurationError as ResultDisqualificationAdminConfigurationError };
export { ResultWriteAdminRequestError as ResultDisqualificationAdminRequestError };
export type ResultDisqualificationAdminSecurityPolicy = ResultWriteAdminSecurityPolicy<
  typeof RESULT_DISQUALIFICATION_ADMIN_PRODUCTION_COOKIE_NAMES |
  typeof RESULT_DISQUALIFICATION_ADMIN_LOOPBACK_COOKIE_NAMES
>;
export type ResultDisqualificationAdminSessionProof = ResultWriteAdminSessionProof;
