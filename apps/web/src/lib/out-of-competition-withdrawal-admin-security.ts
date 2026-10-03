import {
  outOfCompetitionWithdrawalAdminErrorResponseSchema,
  type OutOfCompetitionWithdrawalAdminErrorCode
} from "@o-tid/contracts";
import {
  OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES,
  OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES,
  isOutOfCompetitionWithdrawalAdminLoopbackHostname
} from "./out-of-competition-withdrawal-admin-cookies";
import {
  ResultWriteAdminConfigurationError,
  ResultWriteAdminRequestError,
  createResultWriteAdminSecurity,
  privateResultWriteAdminHeaders,
  type ResultWriteAdminSecurityPolicy,
  type ResultWriteAdminSessionProof
} from "./result-write-admin-security";

const tools = createResultWriteAdminSecurity({
  productionCookieNames: OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES,
  loopbackCookieNames: OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES,
  isLoopbackHostname: isOutOfCompetitionWithdrawalAdminLoopbackHostname,
  errorResponseSchema: outOfCompetitionWithdrawalAdminErrorResponseSchema,
  configurationLabel: "återtagande av utom tävlan"
});

export const outOfCompetitionWithdrawalAdminSecurityPolicy = tools.securityPolicy;
export const hasExpectedOutOfCompetitionWithdrawalAdminOrigin = tools.hasExpectedOrigin;
export const outOfCompetitionWithdrawalAdminSessionProof = tools.sessionProof;
export const readOutOfCompetitionWithdrawalAdminJson = tools.readJson;
export const hasNoOutOfCompetitionWithdrawalAdminRequestBody = tools.hasNoBody;
export const setOutOfCompetitionWithdrawalAdminCookies = tools.setCookies;
export const clearOutOfCompetitionWithdrawalAdminCookies = tools.clearCookies;
export const outOfCompetitionWithdrawalAdminJson = tools.json;
export const outOfCompetitionWithdrawalAdminFailure = (
  status: 400 | 401 | 403 | 404 | 409 | 413 | 500,
  code: OutOfCompetitionWithdrawalAdminErrorCode
) => tools.failure(status, code);
export const privateOutOfCompetitionWithdrawalAdminHeaders = privateResultWriteAdminHeaders;
export { ResultWriteAdminConfigurationError as OutOfCompetitionWithdrawalAdminConfigurationError };
export { ResultWriteAdminRequestError as OutOfCompetitionWithdrawalAdminRequestError };
export type OutOfCompetitionWithdrawalAdminSecurityPolicy = ResultWriteAdminSecurityPolicy<
  typeof OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES |
  typeof OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES
>;
export type OutOfCompetitionWithdrawalAdminSessionProof = ResultWriteAdminSessionProof;
