import { entryClassAdminSecurityPolicy } from "./entry-class-admin-security";
import { ENTRY_START_TIME_ADMIN_PRODUCTION_COOKIE_NAMES, ENTRY_START_TIME_ADMIN_LOOPBACK_COOKIE_NAMES } from "./entry-start-time-admin-cookies";

// Both small admin surfaces share request limits and cookie mechanics.
export {
  EntryClassAdminConfigurationError as EntryStartTimeAdminConfigurationError,
  clearEntryClassAdminCookies as clearEntryStartTimeAdminCookies,
  entryClassAdminFailure as entryStartTimeAdminFailure,
  entryClassAdminJson as entryStartTimeAdminJson,
  entryClassAdminSessionProof as entryStartTimeAdminSessionProof,
  hasExpectedEntryClassAdminOrigin as hasExpectedEntryStartTimeAdminOrigin,
  hasNoEntryClassAdminRequestBody as hasNoEntryStartTimeAdminRequestBody,
  privateEntryClassAdminHeaders as privateEntryStartTimeAdminHeaders,
  readEntryClassAdminJson as readEntryStartTimeAdminJson,
  setEntryClassAdminCookies as setEntryStartTimeAdminCookies
} from "./entry-class-admin-security";

export function entryStartTimeAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
) {
  const policy = entryClassAdminSecurityPolicy(environment);
  return { ...policy, cookieNames: policy.secureCookies
    ? ENTRY_START_TIME_ADMIN_PRODUCTION_COOKIE_NAMES : ENTRY_START_TIME_ADMIN_LOOPBACK_COOKIE_NAMES };
}
