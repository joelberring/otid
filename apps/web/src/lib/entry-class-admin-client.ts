import {
  entryClassAdminListResponseSchema,
  entryClassChangeRequestSchema,
  entryClassChangeResponseSchema,
  type EntryClassAdminListResponse,
  type EntryClassChangeResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readEntryClassAdminCsrfCookie } from "./entry-class-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type EntryClassAdminData = EntryClassAdminListResponse;

export interface EntryClassChangeAttempt {
  requestId: string;
  entryId: string;
  displayName: string;
  previousClassId: string;
  classId: string;
  expectedEntryVersion: number;
}

export function parseEntryClassAdminData(value: unknown, expectedRaceId: string): EntryClassAdminData {
  const parsed = entryClassAdminListResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) throw new Error(sv.entryClassInvalidResponse);
  const classIds = new Set(parsed.data.classes.map((raceClass) => raceClass.id));
  if (parsed.data.entries.some((entry) => !classIds.has(entry.classId))) throw new Error(sv.entryClassInvalidResponse);
  return parsed.data;
}

export function createEntryClassChangeAttempt(
  input: Omit<EntryClassChangeAttempt, "requestId">,
  webCrypto: Crypto = globalThis.crypto
): EntryClassChangeAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || input.previousClassId === input.classId || input.expectedEntryVersion < 1) {
    throw new Error(sv.entryClassInvalidAttempt);
  }
  return { requestId, ...input };
}

export function entryClassChangeBody(attempt: EntryClassChangeAttempt) {
  return entryClassChangeRequestSchema.parse({
    formatVersion: 1,
    classId: attempt.classId,
    expectedEntryVersion: attempt.expectedEntryVersion
  });
}

export function parseEntryClassChangeResponse(
  value: unknown,
  attempt: EntryClassChangeAttempt,
  expectedRaceId: string
): EntryClassChangeResponse {
  const parsed = entryClassChangeResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.requestId !== attempt.requestId || parsed.data.raceId !== expectedRaceId ||
      parsed.data.entryId !== attempt.entryId || parsed.data.previousClassId !== attempt.previousClassId ||
      parsed.data.classId !== attempt.classId || parsed.data.entryVersionBefore !== attempt.expectedEntryVersion ||
      parsed.data.entryVersionAfter !== attempt.expectedEntryVersion + 1 ||
      parsed.data.snapshotVersionAfter !== parsed.data.snapshotVersionBefore + 1) {
    throw new Error(sv.entryClassInvalidResponse);
  }
  return parsed.data;
}

export function readEntryClassAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readEntryClassAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.entryClassLoginAgain);
}

export function isDefinitiveEntryClassRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409;
}
