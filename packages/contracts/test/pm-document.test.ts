import { describe, expect, it } from "vitest";
import {
  PM_DOCUMENT_MAX_BYTES,
  pmDocumentUploadRequestSchema as upload,
  pmDocumentPublishRequestSchema as publish,
  pmDocumentWithdrawRequestSchema as withdraw,
  pmDocumentUploadIdempotencyKeySchema as uploadKey,
  pmDocumentPublishIdempotencyKeySchema as publishKey,
  pmDocumentWithdrawIdempotencyKeySchema as withdrawKey
} from "../src";

const id = "12345678-1234-4234-8234-123456789abc";
const request = { formatVersion: 1, title: "PM – Lång", byteLength: 123, sha256: "a".repeat(64), mediaType: "application/pdf" };

describe("TASK013 PM request boundaries (not PDF validation)", () => {
  it("retains a valid upload intent exactly and accepts both size boundaries", () => {
    expect(upload.parse(request)).toEqual(request);
    for (const byteLength of [1, PM_DOCUMENT_MAX_BYTES]) expect(upload.parse({ ...request, byteLength }).byteLength).toBe(byteLength);
  });

  it.each([0, -1, 1.5, PM_DOCUMENT_MAX_BYTES + 1, NaN, Infinity, "123"])("rejects invalid declared length %s", (byteLength) => {
    expect(upload.safeParse({ ...request, byteLength }).success).toBe(false);
  });

  it.each(["", " PM", "PM ", "PM\n", "PM\u0000", "PM\u0085", "PM\u202e", "PM\u2066", "PM\u200f", "PM\u061c", "La\u030ang", "x".repeat(121), "\ud800"])("rejects noncanonical title %j without silently rewriting it", (title) => {
    expect(upload.safeParse({ ...request, title }).success).toBe(false);
  });

  it("counts Unicode code points, including valid supplementary characters", () => {
    expect(upload.safeParse({ ...request, title: "🧭".repeat(120) }).success).toBe(true);
    expect(upload.safeParse({ ...request, title: "🧭".repeat(121) }).success).toBe(false);
  });

  it("requires exact lowercase SHA and media type", () => {
    for (const sha256 of ["A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65), ` ${request.sha256}`]) {
      expect(upload.safeParse({ ...request, sha256 }).success).toBe(false);
    }
    for (const mediaType of ["text/html", "application/pdf; charset=utf-8", "APPLICATION/PDF"]) {
      expect(upload.safeParse({ ...request, mediaType }).success).toBe(false);
    }
  });

  it("rejects client-supplied storage, identity and scan claims", () => {
    for (const field of ["bucket", "key", "versionId", "scanStatus", "scanReportId", "ready", "actorId", "raceId", "uploadId", "fileName"]) {
      expect(upload.safeParse({ ...request, [field]: "untrusted" }).success).toBe(false);
    }
    expect(publish.safeParse({ formatVersion: 1, uploadId: id, expectedPublicationRevision: 0, scanReportId: id }).success).toBe(false);
    expect(withdraw.safeParse({ formatVersion: 1, publicationId: id, expectedPublicationRevision: 1, force: true }).success).toBe(false);
  });

  it("binds publication and withdrawal to their exact target and revision shapes", () => {
    for (const expectedPublicationRevision of [0, 1, 2_147_483_647]) {
      expect(publish.safeParse({ formatVersion: 1, uploadId: id, expectedPublicationRevision }).success).toBe(true);
    }
    for (const expectedPublicationRevision of [-1, 0.5, 2_147_483_648, "1"]) {
      expect(publish.safeParse({ formatVersion: 1, uploadId: id, expectedPublicationRevision }).success).toBe(false);
    }
    expect(withdraw.safeParse({ formatVersion: 1, publicationId: id, expectedPublicationRevision: 1 }).success).toBe(true);
    expect(withdraw.safeParse({ formatVersion: 1, publicationId: id, expectedPublicationRevision: 0 }).success).toBe(false);
    expect(publish.safeParse({ formatVersion: 1, uploadId: id.toUpperCase(), expectedPublicationRevision: 0 }).success).toBe(false);
    expect(publish.safeParse({ formatVersion: 1, publicationId: id, expectedPublicationRevision: 1 }).success).toBe(false);
    expect(upload.safeParse({ ...request, formatVersion: 2 }).success).toBe(false);
  });

  it("separates canonical operation-specific idempotency keys", () => {
    const schemas = [uploadKey, publishKey, withdrawKey];
    const keys = [`pm-upload:${id}`, `pm-publish:${id}`, `pm-withdraw:${id}`];
    schemas.forEach((schema, index) => {
      keys.forEach((key, keyIndex) => expect(schema.safeParse(key).success).toBe(index === keyIndex));
      expect(schema.safeParse(`${keys[index]}\n`).success).toBe(false);
      expect(schema.safeParse(keys[index]!.toUpperCase()).success).toBe(false);
    });
  });
});
