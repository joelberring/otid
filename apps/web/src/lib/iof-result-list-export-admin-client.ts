import {
  frozenRaceFinalizationListResponseSchema,
  iofResultListExportMetadataSchema,
  type FrozenRaceFinalizationListResponse,
  type RaceResultFinalizationMetadata,
  type IofResultListExportMetadata
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readIofResultListExportAdminCsrfCookie } from "./iof-result-list-export-admin-security";

const INTEGER_HEADER = /^(0|[1-9]\d*)$/;
const SHA256_HEADER = /^[a-f0-9]{64}$/;

function integerHeader(response: Response, name: string): number {
  const value = response.headers.get(name);
  if (!value || !INTEGER_HEADER.test(value)) throw new Error(sv.resultListExportInvalidResponse);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(sv.resultListExportInvalidResponse);
  return parsed;
}

export function parseIofResultListExportMetadata(response: Response, raceId: string): IofResultListExportMetadata {
  const sha256 = response.headers.get("x-otid-content-sha256");
  const responseRaceId = response.headers.get("x-otid-race-id");
  if (!sha256 || !SHA256_HEADER.test(sha256) || responseRaceId !== raceId) {
    throw new Error(sv.resultListExportInvalidResponse);
  }
  const parsed = iofResultListExportMetadataSchema.safeParse({
    formatVersion: 1,
    raceId: responseRaceId,
    snapshotVersion: integerHeader(response, "x-otid-snapshot-version"),
    classCount: integerHeader(response, "x-otid-class-count"),
    resultCount: integerHeader(response, "x-otid-result-count"),
    staleResultCount: integerHeader(response, "x-otid-stale-result-count"),
    omittedEntryCount: integerHeader(response, "x-otid-omitted-entry-count"),
    sha256
  });
  // ETag kontrolleras inte: en komprimerande proxy (Caddy) ändrar den. Innehållshashen kontrolleras vid sparandet.
  if (!parsed.success) {
    throw new Error(sv.resultListExportInvalidResponse);
  }
  return parsed.data;
}

export function iofResultListExportFilename(response: Response, raceId: string): string {
  const expected = `otid-result-list-${raceId}.xml`;
  if (response.headers.get("content-disposition") !== `attachment; filename="${expected}"`) {
    throw new Error(sv.resultListExportInvalidResponse);
  }
  return expected;
}

export function parseFrozenRaceFinalizations(
  value: unknown,
  raceId: string
): FrozenRaceFinalizationListResponse {
  const parsed = frozenRaceFinalizationListResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== raceId) {
    throw new Error(sv.resultListExportInvalidResponse);
  }
  return parsed.data;
}

export function validateFrozenIofResultListResponse(
  response: Response,
  expected: RaceResultFinalizationMetadata
): string {
  const expectedFilename = `otid-complete-result-list-${expected.raceId}-r${expected.scopeRevision}.xml`;
  if (response.headers.get("content-type") !== "application/xml; charset=utf-8" ||
      response.headers.get("content-disposition") !== `attachment; filename="${expectedFilename}"` ||
      response.headers.get("x-otid-race-id") !== expected.raceId ||
      response.headers.get("x-otid-finalization-id") !== expected.id ||
      response.headers.get("x-otid-finalization-revision") !== String(expected.scopeRevision) ||
      response.headers.get("x-otid-snapshot-version") !== String(expected.sourceSnapshotVersion) ||
      response.headers.get("x-otid-class-count") !== String(expected.classCount) ||
      response.headers.get("x-otid-result-count") !== String(expected.entryCount) ||
      response.headers.get("x-otid-content-sha256") !== expected.completeXmlSha256) {
    throw new Error(sv.resultListExportInvalidResponse);
  }
  return expectedFilename;
}

export function readIofResultListExportAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readIofResultListExportAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.resultListExportLoginAgain);
}
