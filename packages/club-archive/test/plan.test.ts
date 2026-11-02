import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildImportPlan, type ScannedFile } from "../src/plan";
import { entryBatches } from "../src/payload";
import { formatReport } from "../src/report";
import { runImport } from "../src/run";
import { openSources, scanSources } from "../src/scan";
import { decodeZipName, ZipFile } from "../src/zip";
import { buildZip, syntheticYearZips } from "./synthetic-archive";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const map = (path: string, content = path): ScannedFile => ({ kind: "MAP", source: "z", path, size: 1000, format: "OCD", sha256: sha(content) });
const ppen = (path: string, mapReference: string | null): ScannedFile => ({ kind: "PPEN", source: "z", path, size: 10, sha256: sha(path), mapReference });

describe("planen: kartans referens i .ppen löses över mapparna (ADR-0194 beslut 6)", () => {
  it("samma mapp, på filnamnet i en annan mapp (närmast i tid), och karta saknas", () => {
    const plan = buildImportPlan([
      map("2019/04-02 Skogen [Anna]/Skogen.ocd", "skogen-v1"),
      ppen("2019/04-02 Skogen [Anna]/Räv.ppen", "C:\\OL\\Skogen.ocd"),
      // Samma filnamn, annat innehåll, 2021: banan 2019-06 ska få 2019 års karta.
      map("2021/04-02 Skogen [Anna]/Skogen.ocd", "skogen-v2"),
      ppen("2019/06-04 Ängen [Per]/Keps.ppen", "C:\\Users\\per\\Skogen.ocd"),
      ppen("2021/06-04 Ängen [Per]/Keps2.ppen", "C:\\Users\\per\\Skogen.ocd"),
      ppen("2019/08-01 Sjön/Sjön.ppen", "C:\\OL\\Sjön.ocd"),
      { kind: "SKIP", source: "z", path: "2019/10-10 Möte/Protokoll.pdf", size: 50, category: "PDF" }
    ], { withLeaders: true });
    const byPath = new Map(plan.trainings.map(training => [training.path, training]));
    expect(byPath.get("2019/04-02 Skogen [Anna]")).toMatchObject({ status: "COMPLETE", leader: "Anna",
      courseFiles: [{ resolution: "FOLDER", mapSha256: sha("skogen-v1") }] });
    expect(byPath.get("2019/06-04 Ängen [Per]")).toMatchObject({ status: "COURSES_RESOLVED",
      courseFiles: [{ resolution: "NAME", mapSha256: sha("skogen-v1"), resolvedFrom: "2019/04-02 Skogen [Anna]" }] });
    expect(byPath.get("2021/06-04 Ängen [Per]")!.courseFiles[0]).toMatchObject({ resolution: "NAME", mapSha256: sha("skogen-v2") });
    expect(byPath.get("2019/08-01 Sjön")).toMatchObject({ status: "MAP_MISSING", courseFiles: [{ resolution: "MISSING", mapSha256: null }] });
    expect(plan.skippedFolders).toEqual([{ path: "2019/10-10 Möte", files: 1, categories: { PDF: 1 } }]);
    // Två versioner av Skogen i en logisk karta, med datum från den första träningen.
    expect(plan.maps).toHaveLength(1);
    expect(plan.maps[0]).toMatchObject({ name: "Skogen", versions: [{ versionDate: "2019-04-02", dateFromName: false }, { versionDate: "2021-04-02" }] });
  });

  it("samma karta i många mappar laddas upp en gång; utan ledare; en enda karta i mappen räcker utan sökväg", () => {
    const plan = buildImportPlan([
      map("2019/01-01 A [X]/Karta.ocd", "same"), map("2019/02-01 B [Y]/Karta kopia.ocd", "same"), map("2019/03-01 C/Karta.ocd", "same"),
      { kind: "COURSE_DATA", source: "z", path: "2019/03-01 C/banor.xml", size: 20, sha256: sha("cd"), mapReference: null }
    ], { withLeaders: false });
    expect(plan.totals).toMatchObject({ mapFiles: 3, uniqueMaps: 1, uniqueMapBytes: 1000, mapBytes: 3000 });
    expect(plan.maps[0]!.versions[0]!.paths).toHaveLength(3);
    expect(plan.trainings.every(training => training.leader === null)).toBe(true);
    expect(plan.trainings.find(training => training.path === "2019/03-01 C")).toMatchObject({ status: "COMPLETE" });
    expect(plan.trainings.find(training => training.path === "2019/01-01 A [X]")).toMatchObject({ status: "MAP_ONLY" });
  });
});

describe("zip-läsaren och hela provkörningen med syntetiska arkiv", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "otid-arkiv-"));
    for (const zip of syntheticYearZips()) await writeFile(join(dir, zip.name), zip.data);
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it("läser poster som strömmar, också ZIP64, och kontrollerar CRC", async () => {
    const path = join(dir, "test.zip");
    await writeFile(path, buildZip([{ name: "a/Ängen.txt", data: Buffer.from("hej ".repeat(1000)) }, { name: "b.bin", data: Buffer.from([1, 2, 3]), store: true }],
      { zip64: true }));
    const zip = await ZipFile.open(path);
    expect(zip.entries.map(entry => [entry.name, entry.size])).toEqual([["a/Ängen.txt", 4000], ["b.bin", 3]]);
    const chunks: Buffer[] = [];
    for await (const chunk of zip.read(zip.entries[0]!)) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe("hej ".repeat(1000));
    await zip.close();
    // En ändrad byte ger fel CRC.
    const broken = buildZip([{ name: "x.txt", data: Buffer.from("abcdef"), store: true }]);
    broken[30 + 5] = "X".charCodeAt(0);
    await writeFile(path, broken);
    const bad = await ZipFile.open(path);
    await expect((async () => { for await (const chunk of bad.read(bad.entries[0]!)) void chunk; })()).rejects.toThrow(/CRC/);
    await bad.close();
  });

  it("namn utan UTF-8-flagga: giltig UTF-8 (macOS) och CP437", async () => {
    const path = join(dir, "cp437.zip");
    const zip = buildZip([{ name: "Ängen.ppen", data: Buffer.from("x") }], { utf8Flag: false });
    await writeFile(path, zip);
    const opened = await ZipFile.open(path);
    expect(opened.entries[0]!.name).toBe("Ängen.ppen");
    await opened.close();
    // CP437 (gamla Windows-zip): Ä = 0x8E, ö = 0x94.
    expect(decodeZipName(Uint8Array.from([0x8e, 0x6e, 0x67, 0x65, 0x6e, 0x2f, 0x53, 0x6b, 0x94, 0x67]), false)).toBe("Ängen/Skög");
  });

  it("provkörningen: rapporten, inget skickas, bara kartor och banfiler lästa", async () => {
    const sources = await openSources([dir]);
    const scan = await scanSources(sources.files.filter(file => !file.source.startsWith("test") && !file.source.startsWith("cp437")));
    await sources.close();
    const plan = buildImportPlan(scan.scanned, { withLeaders: true });
    expect(plan.trainings.map(training => [training.path, training.status])).toEqual([
      ["2019/04-02 Skogen [Anna]", "COMPLETE"], ["2019/06-04 Ängen [Per]", "COURSES_RESOLVED"],
      ["2020/05-21 Parken [Kim]", "COMPLETE"], ["2020/09-01 Skogen natt [Anna]", "COMPLETE"]]);
    expect(plan.skippedFolders.map(folder => folder.path)).toEqual(["2020/10-10 Klubbmöte"]);
    expect(plan.maps.map(item => [item.name, item.versions.length])).toEqual([["Parken", 1], ["Skogen", 2]]);
    expect(plan.trainings[1]!.tags).toEqual(["Keps"]);
    const report = formatReport(plan, { sources: ["a"], dryRun: true, withLeaders: true, when: new Date("2026-11-02T12:00:00Z") });
    expect(report).toContain("bara banor, kartan hittad i en annan mapp");
    expect(report).toMatch(/PDF \(/);
    // Banfilernas innehåll finns för omgångarna; inga PDF/Excel.
    const batches = entryBatches(plan, scan.courseContents);
    expect(batches).toHaveLength(1);
    expect(JSON.stringify(batches)).not.toContain("Deltagare.xlsx");
  });

  it("runImport --dry-run skriver rapportfilen och anropar ingen server", async () => {
    const reportPath = join(dir, "rapport.txt");
    const lines: string[] = [];
    const result = await runImport({ inputs: [join(dir, "2019-20261102T210604Z-1-001.zip"), join(dir, "2020-20261102T210604Z-1-001.zip")],
      dryRun: true, withLeaders: false, reportPath, log: line => lines.push(line),
      client: { check: () => { throw new Error("ingen server i provkörningen"); }, uploadMap: () => { throw new Error("nej"); }, batch: () => { throw new Error("nej"); } } });
    expect(result.uploaded).toBe(0);
    expect(await readFile(reportPath, "utf8")).toContain("importeras inte (--utan-ledare)");
    expect((JSON.parse(await readFile(join(dir, "rapport.json"), "utf8")) as { plan: { trainings: unknown[] } }).plan.trainings).toHaveLength(4);
  });

  it("den riktiga körningen laddar upp varje karta en gång och hoppar över det servern har (omkörning)", async () => {
    const known = new Set<string>();
    const uploads: string[] = [];
    const batches: unknown[] = [];
    const client = {
      check: async () => ({ clubName: "OK Test", known: new Set(known) }),
      uploadMap: async (sha256: string, file: { open: () => AsyncIterable<Uint8Array> }) => {
        const hash = createHash("sha256");
        for await (const chunk of file.open()) hash.update(chunk);
        expect(hash.digest("hex")).toBe(sha256);
        uploads.push(sha256); known.add(sha256);
        return { stored: "new" as const };
      },
      batch: async (body: unknown) => { batches.push(body); return { maps: { created: 0, versionsAdded: 0 }, entries: { created: 0, existing: 0, courseFilesAdded: 0 }, missingContent: [] }; }
    };
    const inputs = [join(dir, "2019-20261102T210604Z-1-001.zip"), join(dir, "2020-20261102T210604Z-1-001.zip")];
    await runImport({ inputs, dryRun: false, withLeaders: true, reportPath: join(dir, "r2.txt"), log: () => undefined, client });
    expect(uploads).toHaveLength(3);
    expect(batches).toHaveLength(3);
    await runImport({ inputs, dryRun: false, withLeaders: true, reportPath: join(dir, "r3.txt"), log: () => undefined, client });
    expect(uploads).toHaveLength(3);
  });
});
