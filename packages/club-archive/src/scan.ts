import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { classifyPath, isCourseDataXml, mapFormatOfHead } from "./classify";
import { baseName, extensionOf, normalizePath } from "./folder-name";
import type { ScannedFile } from "./plan";
import { ppenMapReference } from "./ppen-reference";
import { ZipFile } from "./zip";

/**
 * ADR-0194 beslut 6: filerna i en mapp med zip-filer och/eller uppackade mappar. Bara namnen listas; en fil läses först när
 * den är en kartfil, en .ppen eller XML (de första 4 kB för att se om roten är CourseData). Allt annat öppnas aldrig.
 */
export interface SourceFile {
  /** Zip-filens eller mappens namn (för rapporten). */
  readonly source: string;
  /** Sökvägen i arkivet med `/`. */
  readonly path: string;
  readonly size: number;
  readonly open: () => AsyncIterable<Uint8Array>;
}

export const COURSE_FILE_MAX_BYTES = 5 * 1024 * 1024;

export interface Sources { readonly files: readonly SourceFile[]; readonly labels: readonly string[]; close(): Promise<void> }

async function walk(root: string, directory: string, out: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else if (entry.isFile()) out.push(full);
  }
}

export async function openSources(inputs: readonly string[]): Promise<Sources> {
  const files: SourceFile[] = [];
  const zips: ZipFile[] = [];
  const labels: string[] = [];
  for (const input of inputs) {
    const root = resolve(input);
    const info = await stat(root);
    const paths: string[] = [];
    if (info.isDirectory()) await walk(root, root, paths); else paths.push(root);
    let loose = 0;
    for (const path of paths.sort()) {
      if (extensionOf(path) === "zip") {
        const zip = await ZipFile.open(path);
        zips.push(zip);
        const label = baseName(path);
        labels.push(label);
        for (const entry of zip.entries) {
          if (entry.directory) continue;
          files.push({ source: label, path: normalizePath(entry.name), size: entry.size, open: () => zip.read(entry) });
        }
      } else {
        const size = (await stat(path)).size;
        const inside = info.isDirectory() ? relative(root, path).split(sep).join("/") : baseName(path);
        files.push({ source: baseName(root), path: normalizePath(inside), size, open: () => createReadStream(path) as AsyncIterable<Buffer> });
        loose++;
      }
    }
    if (loose > 0) labels.push(`${baseName(root)}/ (${loose} filer)`);
  }
  return { files, labels, close: async () => { for (const zip of zips) await zip.close(); } };
}

async function readHead(file: SourceFile, length: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of file.open()) {
    chunks.push(chunk); total += chunk.byteLength;
    if (total >= length) break;
  }
  return Buffer.concat(chunks).subarray(0, length);
}

async function readAll(file: SourceFile): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of file.open()) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** sha256 och början av filen i en läsning. */
async function hashWithHead(file: SourceFile): Promise<{ sha256: string; head: Uint8Array; size: number }> {
  const hash = createHash("sha256");
  const head: Uint8Array[] = [];
  let headLength = 0, size = 0;
  for await (const chunk of file.open()) {
    hash.update(chunk);
    size += chunk.byteLength;
    if (headLength < 4096) { head.push(chunk); headLength += chunk.byteLength; }
  }
  return { sha256: hash.digest("hex"), head: Buffer.concat(head).subarray(0, 4096), size };
}

export interface ScanResult {
  readonly scanned: ScannedFile[];
  /** Banfilernas innehåll per sha256 (små filer, hålls i minnet). */
  readonly courseContents: Map<string, Uint8Array>;
  /** En källa per kartinnehåll (för uppladdningen). */
  readonly mapSources: Map<string, SourceFile>;
  readonly problems: string[];
}

export async function scanSources(files: readonly SourceFile[], onProgress: (done: number, total: number, path: string) => void = () => undefined)
  : Promise<ScanResult> {
  const scanned: ScannedFile[] = [];
  const courseContents = new Map<string, Uint8Array>();
  const mapSources = new Map<string, SourceFile>();
  const problems: string[] = [];
  let done = 0;
  for (const file of files) {
    onProgress(++done, files.length, file.path);
    const classified = classifyPath(file.path);
    const base = { source: file.source, path: file.path, size: file.size };
    try {
      if (classified.kind === "SKIP") { scanned.push({ ...base, kind: "SKIP", category: classified.category }); continue; }
      if (classified.kind === "MAP") {
        const { sha256, head, size } = await hashWithHead(file);
        const format = mapFormatOfHead(head);
        if (!format) { scanned.push({ ...base, kind: "SKIP", category: "UNKNOWN_MAP" }); continue; }
        scanned.push({ ...base, size, kind: "MAP", format, sha256 });
        if (!mapSources.has(sha256)) mapSources.set(sha256, file);
        continue;
      }
      if (classified.kind === "XML") {
        const head = new TextDecoder("utf-8", { fatal: false }).decode(await readHead(file, 4096));
        if (!isCourseDataXml(head)) { scanned.push({ ...base, kind: "SKIP", category: "OTHER_XML" }); continue; }
      }
      if (file.size > COURSE_FILE_MAX_BYTES) {
        problems.push(`${file.path}: banfilen är större än 5 MB och hoppas över`);
        scanned.push({ ...base, kind: "SKIP", category: "OTHER" });
        continue;
      }
      const bytes = await readAll(file);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      courseContents.set(sha256, bytes);
      const mapReference = classified.kind === "PPEN" ? ppenMapReference(new TextDecoder("utf-8", { fatal: false }).decode(bytes)) : null;
      scanned.push({ ...base, size: bytes.byteLength, kind: classified.kind === "PPEN" ? "PPEN" : "COURSE_DATA", sha256, mapReference });
    } catch (error) {
      problems.push(`${file.source}: ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      scanned.push({ ...base, kind: "SKIP", category: "OTHER" });
    }
  }
  return { scanned, courseContents, mapSources, problems };
}
