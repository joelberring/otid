import { entryClassAdminSecurityPolicy } from "./entry-class-admin-security";
import { START_LIST_PUBLICATION_ADMIN_PRODUCTION_COOKIE_NAMES, START_LIST_PUBLICATION_ADMIN_LOOPBACK_COOKIE_NAMES } from "./start-list-publication-admin-cookies";

// Both small admin surfaces share request limits and cookie mechanics.
export {
  EntryClassAdminConfigurationError as StartListPublicationAdminConfigurationError,
  clearEntryClassAdminCookies as clearStartListPublicationAdminCookies,
  entryClassAdminFailure as startListPublicationAdminFailure,
  entryClassAdminJson as startListPublicationAdminJson,
  entryClassAdminSessionProof as startListPublicationAdminSessionProof,
  hasExpectedEntryClassAdminOrigin as hasExpectedStartListPublicationAdminOrigin,
  hasNoEntryClassAdminRequestBody as hasNoStartListPublicationAdminRequestBody,
  privateEntryClassAdminHeaders as privateStartListPublicationAdminHeaders,
  readEntryClassAdminJson as readStartListPublicationAdminJson,
  setEntryClassAdminCookies as setStartListPublicationAdminCookies
} from "./entry-class-admin-security";

export function startListPublicationAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
) {
  const policy = entryClassAdminSecurityPolicy(environment);
  return { ...policy, cookieNames: policy.secureCookies
    ? START_LIST_PUBLICATION_ADMIN_PRODUCTION_COOKIE_NAMES : START_LIST_PUBLICATION_ADMIN_LOOPBACK_COOKIE_NAMES };
}
