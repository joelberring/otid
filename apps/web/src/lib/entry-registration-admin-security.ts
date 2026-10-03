import { entryClassAdminSecurityPolicy } from "./entry-class-admin-security";
import { ENTRY_REGISTRATION_ADMIN_PRODUCTION_COOKIE_NAMES, ENTRY_REGISTRATION_ADMIN_LOOPBACK_COOKIE_NAMES } from "./entry-registration-admin-cookies";

// Both small admin surfaces share request limits and cookie mechanics.
export {
  EntryClassAdminConfigurationError as EntryRegistrationAdminConfigurationError,
  clearEntryClassAdminCookies as clearEntryRegistrationAdminCookies,
  entryClassAdminFailure as entryRegistrationAdminFailure,
  entryClassAdminJson as entryRegistrationAdminJson,
  entryClassAdminSessionProof as entryRegistrationAdminSessionProof,
  hasExpectedEntryClassAdminOrigin as hasExpectedEntryRegistrationAdminOrigin,
  hasNoEntryClassAdminRequestBody as hasNoEntryRegistrationAdminRequestBody,
  privateEntryClassAdminHeaders as privateEntryRegistrationAdminHeaders,
  readEntryClassAdminJson as readEntryRegistrationAdminJson,
  setEntryClassAdminCookies as setEntryRegistrationAdminCookies
} from "./entry-class-admin-security";

export function entryRegistrationAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
) {
  const policy = entryClassAdminSecurityPolicy(environment);
  return { ...policy, cookieNames: policy.secureCookies
    ? ENTRY_REGISTRATION_ADMIN_PRODUCTION_COOKIE_NAMES : ENTRY_REGISTRATION_ADMIN_LOOPBACK_COOKIE_NAMES };
}
