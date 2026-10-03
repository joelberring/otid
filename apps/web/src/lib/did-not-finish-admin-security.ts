import { didNotFinishAdminErrorResponseSchema, type DidNotFinishAdminErrorCode } from "@o-tid/contracts";
import { DID_NOT_FINISH_ADMIN_LOOPBACK_COOKIE_NAMES, DID_NOT_FINISH_ADMIN_PRODUCTION_COOKIE_NAMES, isDidNotFinishAdminLoopbackHostname } from "./did-not-finish-admin-cookies";
import { ResultWriteAdminConfigurationError, ResultWriteAdminRequestError, createResultWriteAdminSecurity, privateResultWriteAdminHeaders, type ResultWriteAdminSecurityPolicy, type ResultWriteAdminSessionProof } from "./result-write-admin-security";

const tools = createResultWriteAdminSecurity({
  productionCookieNames: DID_NOT_FINISH_ADMIN_PRODUCTION_COOKIE_NAMES,
  loopbackCookieNames: DID_NOT_FINISH_ADMIN_LOOPBACK_COOKIE_NAMES,
  isLoopbackHostname: isDidNotFinishAdminLoopbackHostname,
  errorResponseSchema: didNotFinishAdminErrorResponseSchema,
  configurationLabel: "ej-fullföljt"
});

export const didNotFinishAdminSecurityPolicy = tools.securityPolicy;
export const hasExpectedDidNotFinishAdminOrigin = tools.hasExpectedOrigin;
export const didNotFinishAdminSessionProof = tools.sessionProof;
export const readDidNotFinishAdminJson = tools.readJson;
export const hasNoDidNotFinishAdminRequestBody = tools.hasNoBody;
export const setDidNotFinishAdminCookies = tools.setCookies;
export const clearDidNotFinishAdminCookies = tools.clearCookies;
export const didNotFinishAdminJson = tools.json;
export const didNotFinishAdminFailure = (status: 400 | 401 | 403 | 404 | 409 | 413 | 500, code: DidNotFinishAdminErrorCode) => tools.failure(status, code);
export const privateDidNotFinishAdminHeaders = privateResultWriteAdminHeaders;
export { ResultWriteAdminConfigurationError as DidNotFinishAdminConfigurationError };
export { ResultWriteAdminRequestError as DidNotFinishAdminRequestError };
export type DidNotFinishAdminSecurityPolicy = ResultWriteAdminSecurityPolicy<typeof DID_NOT_FINISH_ADMIN_PRODUCTION_COOKIE_NAMES | typeof DID_NOT_FINISH_ADMIN_LOOPBACK_COOKIE_NAMES>;
export type DidNotFinishAdminSessionProof = ResultWriteAdminSessionProof;
