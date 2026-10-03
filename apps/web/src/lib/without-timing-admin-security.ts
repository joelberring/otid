import {
  createResultWriteAdminSecurity,
  privateResultWriteAdminHeaders
} from "./result-write-admin-security";
import { withoutTimingAdminErrorResponseSchema } from "@o-tid/contracts";

export const privateWithoutTimingAdminHeaders = privateResultWriteAdminHeaders;
export class WithoutTimingAdminConfigurationError extends Error {}

const security = createResultWriteAdminSecurity({
  productionCookieNames: {
    session: "__Host-otid-without-timing-admin-session",
    csrf: "__Host-otid-without-timing-admin-csrf"
  },
  loopbackCookieNames: {
    session: "otid_without_timing_admin_session",
    csrf: "otid_without_timing_admin_csrf"
  },
  isLoopbackHostname: (hostname: string) => hostname === "127.0.0.1" || hostname === "localhost",
  errorResponseSchema: withoutTimingAdminErrorResponseSchema,
  configurationLabel: "utan-tidtagning"
});

export const withoutTimingAdminSecurityPolicy = security.securityPolicy;
export const hasExpectedWithoutTimingAdminOrigin = security.hasExpectedOrigin;
export const withoutTimingAdminSessionProof = security.sessionProof;
export const readWithoutTimingAdminJson = security.readJson;
export const hasNoWithoutTimingAdminRequestBody = security.hasNoBody;
export const setWithoutTimingAdminCookies = security.setCookies;
export const clearWithoutTimingAdminCookies = security.clearCookies;
export const withoutTimingAdminJson = security.json;
export const withoutTimingAdminFailure = security.failure;
