import {
  iofResultListExportAdminErrorResponseSchema,
  type IofResultListExportAdminErrorCode
} from "@o-tid/contracts";

const privateIofResultListExportAdminHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;

export function iofResultListExportAdminFailure(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 500,
  error: IofResultListExportAdminErrorCode
): Response {
  return Response.json(iofResultListExportAdminErrorResponseSchema.parse({ formatVersion: 1, error }),
    { status, headers: privateIofResultListExportAdminHeaders });
}
