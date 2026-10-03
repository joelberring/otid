import {
  resultApprovalWithdrawalAdminErrorResponseSchema,
  type ResultApprovalWithdrawalAdminErrorCode
} from "@o-tid/contracts";
import {
  RESULT_APPROVAL_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES,
  RESULT_APPROVAL_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES,
  isResultApprovalWithdrawalAdminLoopbackHostname
} from "./result-approval-withdrawal-admin-cookies";
import {
  ResultWriteAdminConfigurationError,
  ResultWriteAdminRequestError,
  createResultWriteAdminSecurity,
  privateResultWriteAdminHeaders,
  type ResultWriteAdminSecurityPolicy,
  type ResultWriteAdminSessionProof
} from "./result-write-admin-security";

const tools = createResultWriteAdminSecurity({
  productionCookieNames: RESULT_APPROVAL_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES,
  loopbackCookieNames: RESULT_APPROVAL_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES,
  isLoopbackHostname: isResultApprovalWithdrawalAdminLoopbackHostname,
  errorResponseSchema: resultApprovalWithdrawalAdminErrorResponseSchema,
  configurationLabel: "återtagande av manuellt resultatgodkännande"
});

export const resultApprovalWithdrawalAdminSecurityPolicy = tools.securityPolicy;
export const hasExpectedResultApprovalWithdrawalAdminOrigin = tools.hasExpectedOrigin;
export const resultApprovalWithdrawalAdminSessionProof = tools.sessionProof;
export const readResultApprovalWithdrawalAdminJson = tools.readJson;
export const hasNoResultApprovalWithdrawalAdminRequestBody = tools.hasNoBody;
export const setResultApprovalWithdrawalAdminCookies = tools.setCookies;
export const clearResultApprovalWithdrawalAdminCookies = tools.clearCookies;
export const resultApprovalWithdrawalAdminJson = tools.json;
export const resultApprovalWithdrawalAdminFailure = (
  status: 400 | 401 | 403 | 404 | 409 | 413 | 500,
  code: ResultApprovalWithdrawalAdminErrorCode
) => tools.failure(status, code);
export const privateResultApprovalWithdrawalAdminHeaders = privateResultWriteAdminHeaders;
export { ResultWriteAdminConfigurationError as ResultApprovalWithdrawalAdminConfigurationError };
export { ResultWriteAdminRequestError as ResultApprovalWithdrawalAdminRequestError };
export type ResultApprovalWithdrawalAdminSecurityPolicy = ResultWriteAdminSecurityPolicy<
  typeof RESULT_APPROVAL_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES |
  typeof RESULT_APPROVAL_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES
>;
export type ResultApprovalWithdrawalAdminSessionProof = ResultWriteAdminSessionProof;
