import {
  readoutHistoryDetailResponseSchema,
  readoutHistoryListResponseSchema,
  type ReadoutHistoryDetailResponse,
  type ReadoutHistoryListResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readReadoutResultHistoryAdminCsrfCookie } from "./readout-result-history-admin-security";

export function parseReadoutHistoryList(value: unknown, raceId: string): ReadoutHistoryListResponse {
  const parsed = readoutHistoryListResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== raceId) throw new Error(sv.readoutHistoryInvalidResponse);
  return parsed.data;
}

export function parseReadoutHistoryDetail(
  value: unknown,
  raceId: string,
  readoutId: string
): ReadoutHistoryDetailResponse {
  const parsed = readoutHistoryDetailResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== raceId || parsed.data.readout.id !== readoutId) {
    throw new Error(sv.readoutHistoryInvalidResponse);
  }
  return parsed.data;
}

export function readReadoutResultHistoryAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readReadoutResultHistoryAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.readoutHistoryLoginAgain);
}
