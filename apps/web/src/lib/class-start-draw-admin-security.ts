import { entryClassAdminSecurityPolicy } from "./entry-class-admin-security";
import { CLASS_START_DRAW_ADMIN_PRODUCTION_COOKIE_NAMES, CLASS_START_DRAW_ADMIN_LOOPBACK_COOKIE_NAMES } from "./class-start-draw-admin-cookies";

// Both small admin surfaces share request limits and cookie mechanics.
export {
  EntryClassAdminConfigurationError as ClassStartDrawAdminConfigurationError,
  clearEntryClassAdminCookies as clearClassStartDrawAdminCookies,
  entryClassAdminFailure as classStartDrawAdminFailure,
  entryClassAdminJson as classStartDrawAdminJson,
  entryClassAdminSessionProof as classStartDrawAdminSessionProof,
  hasExpectedEntryClassAdminOrigin as hasExpectedClassStartDrawAdminOrigin,
  hasNoEntryClassAdminRequestBody as hasNoClassStartDrawAdminRequestBody,
  privateEntryClassAdminHeaders as privateClassStartDrawAdminHeaders,
  readEntryClassAdminJson as readClassStartDrawAdminJson,
  setEntryClassAdminCookies as setClassStartDrawAdminCookies
} from "./entry-class-admin-security";

export function classStartDrawAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
) {
  const policy = entryClassAdminSecurityPolicy(environment);
  return { ...policy, cookieNames: policy.secureCookies
    ? CLASS_START_DRAW_ADMIN_PRODUCTION_COOKIE_NAMES : CLASS_START_DRAW_ADMIN_LOOPBACK_COOKIE_NAMES };
}
