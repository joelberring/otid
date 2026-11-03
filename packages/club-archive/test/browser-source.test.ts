import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BlobZip, openBrowserSources, scanBrowserSources, sourceBlob, type BrowserRoot } from "../src/browser";
import { buildImportPlan } from "../src/plan";
import { formatReport } from "../src/report";
import { openSources, scanSources } from "../src/scan";
import { uploadPlan, type ImportUploader } from "../src/upload";
import { buildZip, syntheticCourseData, syntheticMap, syntheticPpen, syntheticYearZips } from "./synthetic-archive";

/**
 * ADR-0204: läsningen ur en abstrakt källa. Samma filer som mapp på disken (kommandot) och som File/Blob (webbläsaren) ger
 * exakt samma plan och rapport; en fil som importen inte tar öppnas aldrig i webbläsaren; inget i webbläsarens moduler
 * importerar Node.
 */
const pdf = new TextEncoder().encode("%PDF-1.4\n% påhittad resultatlista\n");
const looseFolder = (): { path: string; data: Uint8Array }[] => [
  { path: "2021/03-14 Skogen [Kim]/Skogen.omap", data: syntheticMap(0) },
  { path: "2021/03-14 Skogen [Kim]/Skogen.ppen", data: syntheticPpen("C:\\OL\\Skogen.omap", "Mars") },
  { path: "2021/03-14 Skogen [Kim]/Banor.xml", data: syntheticCourseData() },
  { path: "2021/03-14 Skogen [Kim]/Resultat.pdf", data: pdf },
  { path: "2021/05-01 Möte/Startlista.pdf", data: pdf }
];

/** Bytes som BlobPart (Buffer och Uint8Array kan ligga på en SharedArrayBuffer enligt typerna). */
const part = (data: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(data);

/** En Blob som kastar om innehållet läses: bevisar att filen aldrig öppnas. */
class Untouchable extends Blob {
  override slice(): Blob { throw new Error("filen öppnades"); }
  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> { throw new Error("filen öppnades"); }
  override arrayBuffer(): Promise<ArrayBuffer> { throw new Error("filen öppnades"); }
  override text(): Promise<string> { throw new Error("filen öppnades"); }
  override bytes(): Promise<Uint8Array<ArrayBuffer>> { throw new Error("filen öppnades"); }
}

let dir: string;
let folder: BrowserRoot;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "otid-webbimport-"));
  const root = join(dir, "Klubbträningar");
  const files: { path: string; file: Blob }[] = [];
  for (const zip of syntheticYearZips()) {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, zip.name), zip.data);
    files.push({ path: zip.name, file: new Blob([part(zip.data)]) });
  }
  for (const file of looseFolder()) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.data);
    files.push({ path: file.path, file: file.path.endsWith(".pdf") ? new Untouchable([part(file.data)]) : new Blob([part(file.data)]) });
  }
  folder = { kind: "folder", name: "Klubbträningar", files: files.reverse() };
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

const contents = (map: Map<string, Uint8Array>) => [...map].map(([sha, bytes]) => [sha, Buffer.from(bytes).toString("hex")]).sort();

describe("samma plan ur disken och ur webbläsarens filer (ADR-0204)", () => {
  it("källorna, läsningen, planen och rapporten är identiska; PDF:erna öppnas aldrig", async () => {
    const node = await openSources([join(dir, "Klubbträningar")]);
    const nodeScan = await scanSources(node.files);
    await node.close();
    const browser = await openBrowserSources([folder]);
    expect(browser.problems).toEqual([]);
    const browserScan = await scanBrowserSources(browser.files);

    expect(browser.labels).toEqual(node.labels);
    expect(browser.files.map(file => [file.source, file.path, file.size])).toEqual(node.files.map(file => [file.source, file.path, file.size]));
    expect(browserScan.scanned).toEqual(nodeScan.scanned);
    expect(browserScan.problems).toEqual(nodeScan.problems);
    expect(contents(browserScan.courseContents)).toEqual(contents(nodeScan.courseContents));
    expect([...browserScan.mapSources.keys()]).toEqual([...nodeScan.mapSources.keys()]);
    for (const withLeaders of [true, false]) {
      const nodePlan = buildImportPlan(nodeScan.scanned, { withLeaders });
      const browserPlan = buildImportPlan(browserScan.scanned, { withLeaders });
      expect(browserPlan).toEqual(nodePlan);
      const meta = { sources: node.labels, dryRun: true, withLeaders, when: new Date("2026-11-03T12:00:00Z") };
      expect(formatReport(browserPlan, meta)).toBe(formatReport(nodePlan, meta));
    }
    const plan = buildImportPlan(browserScan.scanned, { withLeaders: true });
    expect(plan.trainings.map(training => training.path)).toContain("2021/03-14 Skogen [Kim]");
    expect(plan.skippedFiles.PDF?.files).toBe(4);
    expect(plan.skippedFolders.map(folder => folder.path)).toEqual(["2020/10-10 Klubbmöte", "2021/05-01 Möte"]);
  });

  it("en lös fil och en zip-fil som egna val ger samma källor som kommandots filargument", async () => {
    const [zip] = syntheticYearZips();
    const zipPath = join(dir, zip!.name);
    const ppenPath = join(dir, "Lös.ppen");
    const ppen = syntheticPpen("C:\\OL\\Skogen.omap");
    await writeFile(zipPath, zip!.data);
    await writeFile(ppenPath, ppen);
    const node = await openSources([zipPath, ppenPath]);
    const browser = await openBrowserSources([{ kind: "file", name: zip!.name, file: new Blob([part(zip!.data)]) },
      { kind: "file", name: basename(ppenPath), file: new Blob([part(ppen)]) }]);
    expect(browser.labels).toEqual(node.labels);
    expect(browser.files.map(file => [file.source, file.path])).toEqual(node.files.map(file => [file.source, file.path]));
    const [a, b] = [await scanSources(node.files), await scanBrowserSources(browser.files)];
    expect(b.scanned).toEqual(a.scanned);
    await node.close();
  });

  it("en kartfil över gränsen läses inte och får ett tydligt besked; en trasig zip-fil blir ett problem", async () => {
    const map = syntheticMap(0);
    const browser = await openBrowserSources([{ kind: "folder", name: "Kartor", files: [
      { path: "2022/01-01 Stor/Stor.omap", file: new Untouchable([part(map)]) },
      { path: "trasig.zip", file: new Blob([part(new TextEncoder().encode("inte en zip"))]) }] }]);
    expect(browser.problems).toEqual(["trasig.zip: Inte en zip-fil (slutet saknas)"]);
    const scan = await scanBrowserSources(browser.files, { maxMapBytes: map.byteLength - 1,
      describeTooLarge: (file, max) => `${file.path}: ${file.size} > ${max}` });
    expect(scan.scanned).toEqual([{ source: "Kartor", path: "2022/01-01 Stor/Stor.omap", size: map.byteLength, kind: "SKIP", category: "TOO_LARGE_MAP" }]);
    expect(scan.problems).toEqual([`2022/01-01 Stor/Stor.omap: ${map.byteLength} > ${map.byteLength - 1}`]);
  });

  it("zip i webbläsaren: ZIP64, deflate och CRC", async () => {
    const text = new TextEncoder().encode("hej ".repeat(1000));
    const zip = await BlobZip.open(new Blob([part(buildZip([{ name: "a/Ängen.txt", data: text }, { name: "b.bin", data: Uint8Array.from([1, 2, 3]), store: true }],
      { zip64: true }))]));
    expect(zip.entries.map(entry => [entry.name, entry.size, entry.method])).toEqual([["a/Ängen.txt", 4000, 8], ["b.bin", 3, 0]]);
    const read = async (from: BlobZip, index: number) => { const parts: Uint8Array[] = []; for await (const chunk of from.read(from.entries[index]!)) parts.push(chunk);
      return Buffer.concat(parts); };
    expect((await read(zip, 0)).toString()).toBe("hej ".repeat(1000));
    expect([...await read(zip, 1)]).toEqual([1, 2, 3]);
    const broken = buildZip([{ name: "x.txt", data: Buffer.from("abcdef"), store: true }]);
    broken[30 + 5] = "X".charCodeAt(0);
    await expect(read(await BlobZip.open(new Blob([part(broken)])), 0)).rejects.toThrow(/CRC/);
  });
});

describe("uppladdningen ur webbläsarens filer", () => {
  it("varje karta en gång som Blob med rätt innehåll, omkörningen skickar inget, och avbrott stoppar före nästa steg", async () => {
    const browser = await openBrowserSources([folder]);
    const scan = await scanBrowserSources(browser.files);
    const plan = buildImportPlan(scan.scanned, { withLeaders: true });
    const known = new Set<string>();
    const sent: string[] = [];
    const batches: unknown[] = [];
    const client: ImportUploader = {
      check: async () => ({ known: new Set(known) }),
      uploadMap: async (sha256, file) => {
        const blob = await sourceBlob(file);
        expect(createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex")).toBe(sha256);
        sent.push(sha256); known.add(sha256);
        return { stored: "new" };
      },
      batch: async body => { batches.push(body); return { maps: { created: 0, versionsAdded: 0 }, entries: { created: 0, existing: 0, courseFilesAdded: 0 }, missingContent: [] }; }
    };
    const events: string[] = [];
    const first = await uploadPlan({ plan, scan, client, maxEntriesPerBatch: 2, onEvent: event => events.push(event.kind === "map"
      ? `Karta ${event.index} av ${event.uploads}` : event.kind === "entries" ? `Träning ${event.done + event.size} av ${event.total}` : event.kind) });
    expect(first.uploaded).toBe(3);
    expect(events).toEqual(["checked", "Karta 1 av 3", "mapVersions", "Karta 2 av 3", "Karta 3 av 3", "mapVersions",
      "Träning 2 av 5", "Träning 4 av 5", "Träning 5 av 5"]);
    expect(JSON.stringify(batches)).not.toContain("Resultat.pdf");
    const again = await uploadPlan({ plan, scan, client });
    expect([again.uploaded, again.skippedUploads, sent.length]).toEqual([0, 3, 3]);
    const controller = new AbortController();
    controller.abort();
    await expect(uploadPlan({ plan, scan, client, signal: controller.signal })).rejects.toThrow();
  });
});

describe("webbläsarens moduler drar inte in Node", () => {
  it("index.ts och browser.ts importerar bara rena filer i paketet", async () => {
    const src = fileURLToPath(new URL("../src/", import.meta.url));
    const seen = new Set<string>();
    const bad: string[] = [];
    async function visit(file: string) {
      if (seen.has(file)) return;
      seen.add(file);
      const source = await readFile(join(src, file), "utf8");
      for (const match of source.matchAll(/^(?:import|export)\s(?!type\s)[^;]*?from\s+"([^"]+)"/gm)) {
        const target = match[1]!;
        if (!target.startsWith("./")) { bad.push(`${file} → ${target}`); continue; }
        await visit(`${target.slice(2)}.ts`);
      }
    }
    await visit("index.ts");
    await visit("browser.ts");
    expect(bad).toEqual([]);
    expect(seen).not.toContain("scan.ts");
    expect(seen).not.toContain("zip.ts");
    expect(seen).not.toContain("run.ts");
    expect(seen).toContain("scan-core.ts");
  });
});
