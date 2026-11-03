import { concatBytes } from "./bytes";
import { classifyPath, isCourseDataXml, mapFormatOfHead } from "./classify";
import type { ScannedFile } from "./plan";
import { ppenMapReference } from "./ppen-reference";

/**
 * ADR-0194 beslut 6 och ADR-0204: filerna läses ur en abstrakt källa, så att samma läsning körs i kommandot (filerna på datorn,
 * `scan.ts`) och i webbläsaren (File och Blob, `browser.ts`). Bara namnen listas; en fil läses först när den är en kartfil,
 * en .ppen eller XML (de första 4 kB för att se om roten är CourseData). Allt annat öppnas aldrig.
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

/** sha256 som räknas bit för bit (node:crypto i kommandot, WebCrypto i webbläsaren). */
export interface Sha256 { update(chunk: Uint8Array): void; digest(): Promise<string> }
export type CreateSha256 = () => Sha256;

export interface ScanResult {
  readonly scanned: ScannedFile[];
  /** Banfilernas innehåll per sha256 (små filer, hålls i minnet). */
  readonly courseContents: Map<string, Uint8Array>;
  /** En källa per kartinnehåll (för uppladdningen). */
  readonly mapSources: Map<string, SourceFile>;
  readonly problems: string[];
}

export interface ScanOptions {
  readonly onProgress?: (done: number, total: number, path: string) => void;
  /**
   * Webbläsaren: kartfiler över serverns gräns läses inte (de kan inte laddas upp) och räknas som `TOO_LARGE_MAP` med ett
   * besked bland problemen. Kommandot sätter ingen gräns; servern säger till när filen skickas.
   */
  readonly maxMapBytes?: number;
  readonly describeTooLarge?: (file: SourceFile, maxBytes: number) => string;
  readonly signal?: AbortSignal;
}

async function readHead(file: SourceFile, length: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of file.open()) {
    chunks.push(chunk); total += chunk.byteLength;
    if (total >= length) break;
  }
  return concatBytes(chunks, length);
}

async function readAll(file: SourceFile): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of file.open()) chunks.push(chunk);
  return concatBytes(chunks);
}

/** sha256 och början av filen i en läsning. */
async function hashWithHead(file: SourceFile, createSha256: CreateSha256): Promise<{ sha256: string; head: Uint8Array; size: number }> {
  const hash = createSha256();
  const head: Uint8Array[] = [];
  let headLength = 0, size = 0;
  for await (const chunk of file.open()) {
    hash.update(chunk);
    size += chunk.byteLength;
    if (headLength < 4096) { head.push(chunk); headLength += chunk.byteLength; }
  }
  return { sha256: await hash.digest(), head: concatBytes(head, 4096), size };
}

export async function scanSourceFiles(files: readonly SourceFile[], createSha256: CreateSha256, options: ScanOptions = {}): Promise<ScanResult> {
  const scanned: ScannedFile[] = [];
  const courseContents = new Map<string, Uint8Array>();
  const mapSources = new Map<string, SourceFile>();
  const problems: string[] = [];
  let done = 0;
  for (const file of files) {
    options.signal?.throwIfAborted();
    options.onProgress?.(++done, files.length, file.path);
    const classified = classifyPath(file.path);
    const base = { source: file.source, path: file.path, size: file.size };
    try {
      if (classified.kind === "SKIP") { scanned.push({ ...base, kind: "SKIP", category: classified.category }); continue; }
      if (classified.kind === "MAP") {
        if (options.maxMapBytes !== undefined && file.size > options.maxMapBytes) {
          problems.push(options.describeTooLarge?.(file, options.maxMapBytes) ?? `${file.path}: kartfilen är för stor`);
          scanned.push({ ...base, kind: "SKIP", category: "TOO_LARGE_MAP" });
          continue;
        }
        const { sha256, head, size } = await hashWithHead(file, createSha256);
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
      const hash = createSha256();
      hash.update(bytes);
      const sha256 = await hash.digest();
      courseContents.set(sha256, bytes);
      const mapReference = classified.kind === "PPEN" ? ppenMapReference(new TextDecoder("utf-8", { fatal: false }).decode(bytes)) : null;
      scanned.push({ ...base, size: bytes.byteLength, kind: classified.kind === "PPEN" ? "PPEN" : "COURSE_DATA", sha256, mapReference });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      problems.push(`${file.source}: ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      scanned.push({ ...base, kind: "SKIP", category: "OTHER" });
    }
  }
  return { scanned, courseContents, mapSources, problems };
}
