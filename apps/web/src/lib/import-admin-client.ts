import {
  IOF_IMPORT_MAX_BYTES,
  iofImportResponseSchema,
  type IofImportResponse
} from "@o-tid/contracts";
import { readAccountCsrfCookie } from "./organizer-account-cookies";
import { sv } from "../i18n/sv";
import { UUID_PATTERN } from "@o-tid/contracts";

export type { IofImportResponse } from "@o-tid/contracts";

export const MAX_IOF_IMPORT_BYTES = IOF_IMPORT_MAX_BYTES;

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface IofImportAttempt {
  file: File;
  requestId: string;
  contentHash: string;
}

export async function createIofImportAttempt(
  file: File,
  webCrypto: Crypto = globalThis.crypto
): Promise<IofImportAttempt> {
  if (file.size < 1 || file.size > MAX_IOF_IMPORT_BYTES) {
    throw new Error(sv.importFileSizeError);
  }
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId)) throw new Error(sv.importRequestIdError);
  const digest = new Uint8Array(await webCrypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  const contentHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!HASH_PATTERN.test(contentHash)) throw new Error(sv.importHashError);
  return { file, requestId, contentHash };
}

export function parseIofImportResponse(
  value: unknown,
  attempt: IofImportAttempt,
  expectedRaceId: string
): IofImportResponse {
  const parsed = iofImportResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.requestId !== attempt.requestId ||
      parsed.data.raceId !== expectedRaceId || parsed.data.contentHash !== attempt.contentHash ||
      parsed.data.byteCount !== attempt.file.size) {
    throw new Error(sv.importInvalidResponse);
  }
  return parsed.data;
}

export function readImportAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readAccountCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.importLoginAgain);
}
