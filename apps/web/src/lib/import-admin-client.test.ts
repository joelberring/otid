import { describe, expect, it } from "vitest";
import {
  createIofImportAttempt,
  parseIofImportResponse
} from "./import-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";
const importFileId = "10000000-0000-4000-8000-000000000003";

const cryptoStub = {
  randomUUID: () => requestId,
  subtle: { digest: async () => new Uint8Array(32).fill(0xab).buffer }
} as unknown as Crypto;

describe("TASK 005G importadmin-klient", () => {
  it("skapar samma minnesbundna request-id och hash för explicit retry", async () => {
    const file = new File(["<CourseData/>"], "banor.xml", { type: "text/plain" });
    const attempt = await createIofImportAttempt(file, cryptoStub);
    expect(attempt).toEqual({ file, requestId, contentHash: "ab".repeat(32) });
    expect(attempt.file.name).toBe("banor.xml");
  });

  it.each([0, 5_000_001])("avvisar %i bytes före request", async (size) => {
    const file = new File([new Uint8Array(size)], "fel.xml");
    await expect(createIofImportAttempt(file, cryptoStub)).rejects.toThrow("1–5 000 000");
  });

  it("godtar endast ett bekräftat svar bundet till samma request, race, hash och byteantal", async () => {
    const file = new File(["<EntryList/>"] , "entries.xml");
    const attempt = await createIofImportAttempt(file, cryptoStub);
    const response = {
      formatVersion: 1 as const,
      status: "stored" as const,
      replayed: false,
      requestId,
      raceId,
      importFileId,
      contentHash: "ab".repeat(32),
      byteCount: file.size,
      report: { kind: "EntryList" as const, warnings: [], imported: { entries: 2 } }
    };
    expect(parseIofImportResponse(response, attempt, raceId)).toEqual(response);
    expect(() => parseIofImportResponse({ ...response, raceId: importFileId }, attempt, raceId)).toThrow("ogiltigt importsvar");
    expect(() => parseIofImportResponse({ ...response, contentHash: "cd".repeat(32) }, attempt, raceId)).toThrow("ogiltigt importsvar");
  });

  it("godtar den strikta StartList-rapporten och avvisar en ofullständig rapport", async () => {
    const file = new File(["<StartList/>"] , "starter.xml");
    const attempt = await createIofImportAttempt(file, cryptoStub);
    const response = {
      formatVersion: 1 as const,
      status: "stored" as const,
      replayed: false,
      requestId,
      raceId,
      importFileId,
      contentHash: "ab".repeat(32),
      byteCount: file.size,
      report: {
        kind: "StartList" as const,
        warnings: [],
        imported: { classes: 1, entries: 2 },
        changed: { classes: 1, entries: 2 },
        resultsRequiringRecalculation: 1,
        snapshotChanged: true
      }
    };
    expect(parseIofImportResponse(response, attempt, raceId)).toEqual(response);
    const incompleteReport: Record<string, unknown> = { ...response.report };
    delete incompleteReport.snapshotChanged;
    expect(() => parseIofImportResponse(
      { ...response, report: incompleteReport },
      attempt,
      raceId
    )).toThrow("ogiltigt importsvar");
  });

});
