import { describe, expect, it } from "vitest";
import {
  CLUB_IMPORT_TOKEN_PATTERN, clubArchiveEntryUpdateRequestSchema, clubImportBatchRequestSchema, clubMapVersionMoveRequestSchema,
  clubMemberInviteRequestSchema, clubMemberRemoveRequestSchema
} from "../src/club-archive";

/** ADR-0194: klubbarkivets kontrakt – inbjudan per adress, importens omgång, ändringarna i arkivet och nyckelns form. */
const id = "10000000-0000-4000-8000-000000000001";
const sha = "a".repeat(64);

describe("klubbarkivet", () => {
  it("inbjudan: adressen normaliseras, rollerna är ägare, administratör och läsare", () => {
    expect(clubMemberInviteRequestSchema.parse({ formatVersion: 1, requestId: id, email: " Lisa@Exempel.se ", role: "READER" }).email).toBe("lisa@exempel.se");
    expect(clubMemberInviteRequestSchema.safeParse({ formatVersion: 1, requestId: id, email: "lisa@exempel.se", role: "MEMBER" }).success).toBe(false);
    // ADR-0209: Ledare är en roll i klubbytan.
    expect(clubMemberInviteRequestSchema.safeParse({ formatVersion: 1, requestId: id, email: "lisa@exempel.se", role: "LEADER" }).success).toBe(true);
    expect(clubMemberRemoveRequestSchema.safeParse({ formatVersion: 1, memberId: id, invitationId: id }).success).toBe(false);
    expect(clubMemberRemoveRequestSchema.safeParse({ formatVersion: 1, memberId: null, invitationId: id }).success).toBe(true);
  });

  it("importens omgång: kartornas versioner och träningarna med banfiler, bara kända slag", () => {
    const batch = { formatVersion: 1,
      maps: [{ importKey: "skogen", name: "Skogen", versions: [{ sha256: sha, fileName: "Skogen.ocd", format: "OCD", versionDate: "2019-04-02", sourcePath: null }] }],
      entries: [{ importKey: "2019/04-02 Skogen [Anna]", trainingDate: "2019-04-02", year: 2019, place: "Skogen", title: "Skogen", leader: null, tags: ["Keps"],
        sourcePath: "2019/04-02 Skogen [Anna]", mapSha256: [sha], courseFiles: [{ fileName: "a.ppen", kind: "PPEN", sha256: sha, contentBase64: "PGV2ZW50Lz4=",
          mapReference: "C:\\OL\\Skogen.ocd", mapSha256: sha, resolution: "FOLDER" }] }] };
    expect(clubImportBatchRequestSchema.safeParse(batch).success).toBe(true);
    const pdf = { ...batch, entries: [{ ...batch.entries[0]!, courseFiles: [{ ...batch.entries[0]!.courseFiles[0]!, kind: "PDF" }] }] };
    expect(clubImportBatchRequestSchema.safeParse(pdf).success).toBe(false);
    expect(clubImportBatchRequestSchema.safeParse({ ...batch, maps: [{ ...batch.maps[0]!, versions: [{ ...batch.maps[0]!.versions[0]!, format: "PDF" }] }] }).success)
      .toBe(false);
    // Ett okänt fält (t.ex. en hel fil som inte hör hit) avvisas.
    expect(clubImportBatchRequestSchema.safeParse({ ...batch, attachments: [] }).success).toBe(false);
  });

  it("träningens ändringar: tomma fält blir null, högst 30 taggar", () => {
    const parsed = clubArchiveEntryUpdateRequestSchema.parse({ formatVersion: 1, trainingDate: null, place: "Skogen", title: "Skogen", leader: " ",
      tags: ["Keps"], notes: "" });
    expect([parsed.leader, parsed.notes]).toEqual([null, null]);
    expect(clubArchiveEntryUpdateRequestSchema.safeParse({ ...parsed, tags: Array.from({ length: 31 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(clubMapVersionMoveRequestSchema.safeParse({ formatVersion: 1, targetMapId: null, newMapName: null }).success).toBe(false);
  });

  it("importnyckelns form", () => {
    expect(CLUB_IMPORT_TOKEN_PATTERN.test(`otid-imp-${"A".repeat(43)}`)).toBe(true);
    expect(CLUB_IMPORT_TOKEN_PATTERN.test("otid-imp-kort")).toBe(false);
  });
});
