import { entryClassAdminSecurityPolicy } from "./entry-class-admin-security";
import { START_LIST_ADMIN_PRODUCTION_COOKIE_NAMES, START_LIST_ADMIN_LOOPBACK_COOKIE_NAMES } from "./start-list-admin-cookies";

// Both small admin surfaces share request limits and cookie mechanics.
export {
  EntryClassAdminConfigurationError as StartListAdminConfigurationError,
  clearEntryClassAdminCookies as clearStartListAdminCookies,
  entryClassAdminFailure as startListAdminFailure,
  entryClassAdminJson as startListAdminJson,
  entryClassAdminSessionProof as startListAdminSessionProof,
  hasExpectedEntryClassAdminOrigin as hasExpectedStartListAdminOrigin,
  hasNoEntryClassAdminRequestBody as hasNoStartListAdminRequestBody,
  privateEntryClassAdminHeaders as privateStartListAdminHeaders,
  readEntryClassAdminJson as readStartListAdminJson,
  setEntryClassAdminCookies as setStartListAdminCookies
} from "./entry-class-admin-security";

export function startListAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
) {
  const policy = entryClassAdminSecurityPolicy(environment);
  return { ...policy, cookieNames: policy.secureCookies
    ? START_LIST_ADMIN_PRODUCTION_COOKIE_NAMES : START_LIST_ADMIN_LOOPBACK_COOKIE_NAMES };
}
