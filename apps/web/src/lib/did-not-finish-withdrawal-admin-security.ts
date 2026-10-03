import { didNotFinishWithdrawalAdminErrorResponseSchema, type DidNotFinishWithdrawalAdminErrorCode } from "@o-tid/contracts";
import { DID_NOT_FINISH_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES, DID_NOT_FINISH_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES, isDidNotFinishWithdrawalAdminLoopbackHostname } from "./did-not-finish-withdrawal-admin-cookies";
import { ResultWriteAdminConfigurationError, ResultWriteAdminRequestError, createResultWriteAdminSecurity, privateResultWriteAdminHeaders, type ResultWriteAdminSecurityPolicy, type ResultWriteAdminSessionProof } from "./result-write-admin-security";

const tools = createResultWriteAdminSecurity({
  productionCookieNames: DID_NOT_FINISH_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES,
  loopbackCookieNames: DID_NOT_FINISH_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES,
  isLoopbackHostname: isDidNotFinishWithdrawalAdminLoopbackHostname,
  errorResponseSchema: didNotFinishWithdrawalAdminErrorResponseSchema,
  configurationLabel: "återtagande av ej-fullföljt"
});

export const didNotFinishWithdrawalAdminSecurityPolicy = tools.securityPolicy;
export const hasExpectedDidNotFinishWithdrawalAdminOrigin = tools.hasExpectedOrigin;
export const didNotFinishWithdrawalAdminSessionProof = tools.sessionProof;
export const readDidNotFinishWithdrawalAdminJson = tools.readJson;
export const hasNoDidNotFinishWithdrawalAdminRequestBody = tools.hasNoBody;
export const setDidNotFinishWithdrawalAdminCookies = tools.setCookies;
export const clearDidNotFinishWithdrawalAdminCookies = tools.clearCookies;
export const didNotFinishWithdrawalAdminJson = tools.json;
export const didNotFinishWithdrawalAdminFailure = (status: 400 | 401 | 403 | 404 | 409 | 413 | 500, code: DidNotFinishWithdrawalAdminErrorCode) => tools.failure(status, code);
export const privateDidNotFinishWithdrawalAdminHeaders = privateResultWriteAdminHeaders;
export { ResultWriteAdminConfigurationError as DidNotFinishWithdrawalAdminConfigurationError };
export { ResultWriteAdminRequestError as DidNotFinishWithdrawalAdminRequestError };
export type DidNotFinishWithdrawalAdminSecurityPolicy = ResultWriteAdminSecurityPolicy<typeof DID_NOT_FINISH_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES | typeof DID_NOT_FINISH_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES>;
export type DidNotFinishWithdrawalAdminSessionProof = ResultWriteAdminSessionProof;
