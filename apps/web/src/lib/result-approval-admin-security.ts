import { resultApprovalAdminErrorResponseSchema, type ResultApprovalAdminErrorCode } from "@o-tid/contracts";
import { RESULT_APPROVAL_ADMIN_LOOPBACK_COOKIE_NAMES, RESULT_APPROVAL_ADMIN_PRODUCTION_COOKIE_NAMES, isResultApprovalAdminLoopbackHostname } from "./result-approval-admin-cookies";
import { ResultWriteAdminConfigurationError, ResultWriteAdminRequestError, createResultWriteAdminSecurity, privateResultWriteAdminHeaders, type ResultWriteAdminSecurityPolicy, type ResultWriteAdminSessionProof } from "./result-write-admin-security";

const tools = createResultWriteAdminSecurity({
  productionCookieNames: RESULT_APPROVAL_ADMIN_PRODUCTION_COOKIE_NAMES,
  loopbackCookieNames: RESULT_APPROVAL_ADMIN_LOOPBACK_COOKIE_NAMES,
  isLoopbackHostname: isResultApprovalAdminLoopbackHostname,
  errorResponseSchema: resultApprovalAdminErrorResponseSchema,
  configurationLabel: "resultatgodkännande"
});
export const resultApprovalAdminSecurityPolicy = tools.securityPolicy;
export const hasExpectedResultApprovalAdminOrigin = tools.hasExpectedOrigin;
export const resultApprovalAdminSessionProof = tools.sessionProof;
export const readResultApprovalAdminJson = tools.readJson;
export const hasNoResultApprovalAdminRequestBody = tools.hasNoBody;
export const setResultApprovalAdminCookies = tools.setCookies;
export const clearResultApprovalAdminCookies = tools.clearCookies;
export const resultApprovalAdminJson = tools.json;
export const resultApprovalAdminFailure = (status: 400 | 401 | 403 | 404 | 409 | 413 | 500, code: ResultApprovalAdminErrorCode) => tools.failure(status, code);
export const privateResultApprovalAdminHeaders = privateResultWriteAdminHeaders;
export { ResultWriteAdminConfigurationError as ResultApprovalAdminConfigurationError };
export { ResultWriteAdminRequestError as ResultApprovalAdminRequestError };
export type ResultApprovalAdminSecurityPolicy = ResultWriteAdminSecurityPolicy<typeof RESULT_APPROVAL_ADMIN_PRODUCTION_COOKIE_NAMES | typeof RESULT_APPROVAL_ADMIN_LOOPBACK_COOKIE_NAMES>;
export type ResultApprovalAdminSessionProof = ResultWriteAdminSessionProof;
