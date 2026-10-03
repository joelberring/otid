import { outOfCompetitionAdminErrorResponseSchema, type OutOfCompetitionAdminErrorCode } from "@o-tid/contracts";
import { OUT_OF_COMPETITION_ADMIN_LOOPBACK_COOKIE_NAMES, OUT_OF_COMPETITION_ADMIN_PRODUCTION_COOKIE_NAMES, isOutOfCompetitionAdminLoopbackHostname } from "./out-of-competition-admin-cookies";
import { ResultWriteAdminConfigurationError, ResultWriteAdminRequestError, createResultWriteAdminSecurity, privateResultWriteAdminHeaders, type ResultWriteAdminSecurityPolicy, type ResultWriteAdminSessionProof } from "./result-write-admin-security";

const tools = createResultWriteAdminSecurity({
  productionCookieNames: OUT_OF_COMPETITION_ADMIN_PRODUCTION_COOKIE_NAMES,
  loopbackCookieNames: OUT_OF_COMPETITION_ADMIN_LOOPBACK_COOKIE_NAMES,
  isLoopbackHostname: isOutOfCompetitionAdminLoopbackHostname,
  errorResponseSchema: outOfCompetitionAdminErrorResponseSchema,
  configurationLabel: "utom tävlan"
});

export const outOfCompetitionAdminSecurityPolicy = tools.securityPolicy;
export const hasExpectedOutOfCompetitionAdminOrigin = tools.hasExpectedOrigin;
export const outOfCompetitionAdminSessionProof = tools.sessionProof;
export const readOutOfCompetitionAdminJson = tools.readJson;
export const hasNoOutOfCompetitionAdminRequestBody = tools.hasNoBody;
export const setOutOfCompetitionAdminCookies = tools.setCookies;
export const clearOutOfCompetitionAdminCookies = tools.clearCookies;
export const outOfCompetitionAdminJson = tools.json;
export const outOfCompetitionAdminFailure = (status: 400 | 401 | 403 | 404 | 409 | 413 | 500, code: OutOfCompetitionAdminErrorCode) => tools.failure(status, code);
export const privateOutOfCompetitionAdminHeaders = privateResultWriteAdminHeaders;
export { ResultWriteAdminConfigurationError as OutOfCompetitionAdminConfigurationError };
export { ResultWriteAdminRequestError as OutOfCompetitionAdminRequestError };
export type OutOfCompetitionAdminSecurityPolicy = ResultWriteAdminSecurityPolicy<typeof OUT_OF_COMPETITION_ADMIN_PRODUCTION_COOKIE_NAMES | typeof OUT_OF_COMPETITION_ADMIN_LOOPBACK_COOKIE_NAMES>;
export type OutOfCompetitionAdminSessionProof = ResultWriteAdminSessionProof;
