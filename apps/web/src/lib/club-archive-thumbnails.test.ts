import { describe, expect, it } from "vitest";
import type { ClubArchiveList, ClubArchiveListItem, ClubMapCheckView, ClubMapVersionView } from "@o-tid/contracts";
import { MAP_READER_VERSION } from "@o-tid/map-file";
import { checkExplanation, checkLabel, checkStatusOf, planChecks, renderFailureReason } from "./club-archive-thumbnails";

const check = (patch: Partial<ClubMapCheckView> = {}): ClubMapCheckView => ({ status: "OK", detail: null, fileVersion: "OCAD 11.2",
  readerVersion: MAP_READER_VERSION, checkedAt: "2026-11-03T10:00:00.000Z", thumbnail: true, fingerprint: true, ...patch });

const version = (versionId: string, versionCheck: ClubMapCheckView | null): ClubMapVersionView => ({ versionId, mapId: "m1", fileName: `${versionId}.ocd`,
  format: "OCD", byteLength: 10, versionDate: null, note: null, uploadedAt: "2026-11-03T10:00:00.000Z", sourcePath: null, contentSha256: "a".repeat(64),
  trainings: 0, check: versionCheck, year: 2026, yearSource: "UPLOAD", maker: null });

const entry = (entryId: string, patch: Partial<ClubArchiveListItem>): ClubArchiveListItem => ({ entryId, trainingDate: null, year: 2020, place: "", title: entryId,
  leader: null, tags: [], moments: [], levels: [], courseNames: [], courseFiles: 0, maps: [], status: "COMPLETE", thumbnail: null, thumbnailSource: null, ...patch });

const list = (versions: ClubMapVersionView[], entries: ClubArchiveListItem[]): ClubArchiveList => ({ formatVersion: 1, clubId: "c", clubName: "Klubben",
  viewer: { role: "OWNER", access: { archive: true, mapBank: true } }, entries, maps: [{ mapId: "m1", name: "Älvsjöskogen", versions, latestVersionId: versions[0]?.versionId ?? null, trainings: 0,
    ownership: "CLUB", ownerKind: "CLUB", ownerName: null, agreement: null, validUntil: null, contact: null, trainingOnly: false, feePerPrint: false,
    noPublicDisplay: false, description: null, maker: null, years: null, merges: [] }] });

describe("klubbarkivets kontroll av kartorna (ADR-0196)", () => {
  it("visar läsarens skäl kort och helt", () => {
    const old = check({ status: "UNSUPPORTED_VERSION", detail: "OCAD 7 stöds inte. Öppna kartan och spara den i nyare OCAD eller i Mapper.", thumbnail: false });
    expect(checkLabel(old)).toBe("OCAD 7 stöds inte");
    expect(checkExplanation(old)).toContain("spara den i nyare OCAD");
    expect(checkLabel(check())).toBe("Fungerar · OCAD 11.2");
    expect(checkLabel(check({ status: "TRUNCATED", detail: null }))).toBe("Filen är skadad");
    expect(checkLabel(null)).toBe("Inte kontrollerad än");
    expect(checkStatusOf("NO_CANVAS")).toBe("FAILED");
    expect(renderFailureReason("TRUNCATED")).toContain("avkortad");
    expect(renderFailureReason("UNSUPPORTED_VERSION", "OCAD 6 stöds inte.")).toBe("OCAD 6 stöds inte.");
  });

  it("ritar bara det som saknas, ritades med en äldre läsare eller på en annan kartversion, grupperat per version", () => {
    const fresh = { status: "OK" as const, detail: null, readerVersion: MAP_READER_VERSION, courseName: "Lång", createdAt: "x", stale: false };
    const source = { versionId: "v1", fileName: "v1.ocd", courseFileId: "f1" };
    const archive = list([version("v1", check()), version("v2", null), version("v3", check({ readerVersion: 1 })),
      version("v4", check({ status: "TRUNCATED", thumbnail: false, fingerprint: false }))], [
      entry("klar", { thumbnail: fresh, thumbnailSource: source }),
      entry("saknas", { thumbnailSource: source }),
      entry("gammal", { thumbnail: { ...fresh, stale: true }, thumbnailSource: source }),
      entry("utan-karta", {})
    ]);
    const jobs = planChecks(archive, false);
    expect(jobs.map(job => [job.versionId, job.check, job.entries.map(item => item.entryId)])).toEqual([
      ["v2", true, []], ["v3", true, []], ["v1", false, ["saknas", "gammal"]]]);
    // ADR-0210: en fungerande version utan fingeravtryck kontrolleras igen (en trasig fil får inget fingeravtryck).
    const unfingerprinted = planChecks(list([version("v5", check({ fingerprint: false }))], []), false);
    expect(unfingerprinted.map(job => [job.versionId, job.check])).toEqual([["v5", true]]);
    const all = planChecks(archive, true);
    expect(all.map(job => [job.versionId, job.check, job.entries.length])).toEqual([["v1", true, 3], ["v2", true, 0], ["v3", true, 0], ["v4", true, 0]]);
    expect(all[0]!.label).toBe("Älvsjöskogen (v1.ocd)");
  });
});
