import { entryClassAdminSecurityPolicy } from "./entry-class-admin-security";
import { ENTRY_CARD_ADMIN_PRODUCTION_COOKIE_NAMES, ENTRY_CARD_ADMIN_LOOPBACK_COOKIE_NAMES } from "./entry-card-admin-cookies";

// Both small admin surfaces share request limits and cookie mechanics.
export {
  EntryClassAdminConfigurationError as EntryCardAdminConfigurationError,
  clearEntryClassAdminCookies as clearEntryCardAdminCookies,
  entryClassAdminFailure as entryCardAdminFailure,
  entryClassAdminJson as entryCardAdminJson,
  entryClassAdminSessionProof as entryCardAdminSessionProof,
  hasExpectedEntryClassAdminOrigin as hasExpectedEntryCardAdminOrigin,
  hasNoEntryClassAdminRequestBody as hasNoEntryCardAdminRequestBody,
  privateEntryClassAdminHeaders as privateEntryCardAdminHeaders,
  readEntryClassAdminJson as readEntryCardAdminJson,
  setEntryClassAdminCookies as setEntryCardAdminCookies
} from "./entry-class-admin-security";

export function entryCardAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
) {
  const policy = entryClassAdminSecurityPolicy(environment);
  return { ...policy, cookieNames: policy.secureCookies
    ? ENTRY_CARD_ADMIN_PRODUCTION_COOKIE_NAMES : ENTRY_CARD_ADMIN_LOOPBACK_COOKIE_NAMES };
}

