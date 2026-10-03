import { entryClassAdminSecurityPolicy } from "./entry-class-admin-security";
import { ENTRY_IDENTITY_ADMIN_PRODUCTION_COOKIE_NAMES, ENTRY_IDENTITY_ADMIN_LOOPBACK_COOKIE_NAMES } from "./entry-identity-admin-cookies";

// Reuse cookie/origin mechanics; identity requests have their own 8 KiB reader.
export {
  EntryClassAdminConfigurationError as EntryIdentityAdminConfigurationError,
  clearEntryClassAdminCookies as clearEntryIdentityAdminCookies,
  entryClassAdminFailure as entryIdentityAdminFailure,
  entryClassAdminJson as entryIdentityAdminJson,
  entryClassAdminSessionProof as entryIdentityAdminSessionProof,
  hasExpectedEntryClassAdminOrigin as hasExpectedEntryIdentityAdminOrigin,
  hasNoEntryClassAdminRequestBody as hasNoEntryIdentityAdminRequestBody,
  privateEntryClassAdminHeaders as privateEntryIdentityAdminHeaders,
  setEntryClassAdminCookies as setEntryIdentityAdminCookies
} from "./entry-class-admin-security";

export function entryIdentityAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
) {
  const policy = entryClassAdminSecurityPolicy(environment);
  return { ...policy, cookieNames: policy.secureCookies
    ? ENTRY_IDENTITY_ADMIN_PRODUCTION_COOKIE_NAMES : ENTRY_IDENTITY_ADMIN_LOOPBACK_COOKIE_NAMES };
}
export const ENTRY_IDENTITY_ADMIN_MAX_BODY_BYTES = 8192;
class EntryIdentityAdminRequestError extends Error {}
export async function readEntryIdentityAdminJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") {
    throw new EntryIdentityAdminRequestError("Content-Type måste vara application/json");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) < 1 || Number(declaredLength) > ENTRY_IDENTITY_ADMIN_MAX_BODY_BYTES)) {
    throw new EntryIdentityAdminRequestError("Ogiltig bodylängd");
  }
  if (!request.body) throw new EntryIdentityAdminRequestError("Body saknas");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > ENTRY_IDENTITY_ADMIN_MAX_BODY_BYTES) throw new EntryIdentityAdminRequestError("Bodyn är för stor");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (length === 0) throw new EntryIdentityAdminRequestError("Body saknas");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new EntryIdentityAdminRequestError("Ogiltig JSON");
  }
}
