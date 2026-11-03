import { concatBytes, crc32, streamChunks, toHex } from "./bytes";
import { baseName, extensionOf, normalizePath, pathInChosenFolder } from "./folder-name";
import { scanSourceFiles, type CreateSha256, type ScanOptions, type ScanResult, type SourceFile, type Sources } from "./scan-core";
import { checkedZipEntry, readZipDirectory, zipEntryDataStart, ZipReadError, type RandomAccess, type ZipEntryInfo } from "./zip-format";

/**
 * ADR-0204: importen i webbläsaren. Samma läsning och plan som kommandot (`scan-core.ts`, `plan.ts`), men källan är File och
 * Blob: en zip-fil läses med `Blob.slice` (bara centralkatalogen och posterna som behövs), deflate packas upp med
 * `DecompressionStream`, och sha256 räknas med WebCrypto. En fil som importen inte tar (PDF, startlistor, bilder …) öppnas
 * aldrig och lämnar aldrig datorn; bara namnet och storleken räknas.
 */
export function blobAccess(blob: Blob): RandomAccess {
  return {
    size: blob.size,
    async read(position, length) {
      const bytes = new Uint8Array(await blob.slice(position, position + length).arrayBuffer());
      if (bytes.byteLength < length) throw new ZipReadError("Zip-filen är avkortad");
      return bytes;
    }
  };
}

export class BlobZip {
  private constructor(private readonly blob: Blob, private readonly access: RandomAccess, readonly entries: readonly ZipEntryInfo[]) {}

  static async open(blob: Blob): Promise<BlobZip> {
    const access = blobAccess(blob);
    return new BlobZip(blob, access, await readZipDirectory(access));
  }

  /** Postens innehåll bit för bit (uppackat i minnet). CRC kontrolleras när hela posten lästs. */
  async *read(entry: ZipEntryInfo, options: { verify?: boolean } = {}): AsyncGenerator<Uint8Array> {
    const start = await zipEntryDataStart(this.access, entry);
    if (entry.compressedSize === 0) return;
    let stream = this.blob.slice(start, start + entry.compressedSize).stream();
    if (entry.method === 8) stream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
    yield* checkedZipEntry(entry, streamChunks(stream), options.verify !== false ? crc32 : undefined);
  }
}

/** sha256 med WebCrypto (som inte räknar bit för bit): bitarna samlas och räknas en gång. Kartfilerna är högst serverns gräns. */
export const webCryptoSha256: CreateSha256 = () => {
  const chunks: Uint8Array[] = [];
  return {
    update: chunk => { chunks.push(chunk); },
    digest: async () => {
      const only = chunks.length === 1 && chunks[0]!.buffer instanceof ArrayBuffer ? chunks[0] as Uint8Array<ArrayBuffer> : concatBytes(chunks);
      return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", only)));
    }
  };
};

/** En fil i webbläsaren: också innehållet som Blob för uppladdningen (en lös fil skickas som den är, utan kopia). */
export interface BrowserSourceFile extends SourceFile {
  readonly blob: () => Promise<Blob>;
}

/** Innehållet som Blob (en post i en zip-fil packas upp i minnet). */
export async function sourceBlob(file: SourceFile): Promise<Blob> {
  if ("blob" in file && typeof (file as BrowserSourceFile).blob === "function") return (file as BrowserSourceFile).blob();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for await (const chunk of file.open()) chunks.push(chunk.buffer instanceof ArrayBuffer ? chunk as Uint8Array<ArrayBuffer> : new Uint8Array(chunk));
  return new Blob(chunks);
}

/**
 * Det som valdes: en mapp (filerna med sökvägen under mappen, som `webkitRelativePath` utan mappens namn) eller en fil
 * (zip eller lös fil). Motsvarar kommandots argument: en mapp eller en fil.
 */
export type BrowserRoot =
  | { readonly kind: "folder"; readonly name: string; readonly files: readonly { readonly path: string; readonly file: Blob }[] }
  | { readonly kind: "file"; readonly name: string; readonly file: Blob };

const byPath = (a: { path: string }, b: { path: string }) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Samma källor som kommandots `openSources` (samma ordning, sökvägar och etiketter). En trasig zip-fil blir ett problem. */
export async function openBrowserSources(roots: readonly BrowserRoot[]): Promise<Sources & { readonly problems: readonly string[] }> {
  const files: BrowserSourceFile[] = [];
  const labels: string[] = [];
  const problems: string[] = [];
  for (const root of roots) {
    const items = root.kind === "folder" ? [...root.files].sort(byPath) : [{ path: root.name, file: root.file }];
    let loose = 0;
    for (const item of items) {
      if (extensionOf(item.path) === "zip") {
        const label = baseName(item.path);
        let zip: BlobZip;
        try { zip = await BlobZip.open(item.file); } catch (error) {
          problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        labels.push(label);
        for (const entry of zip.entries) {
          if (entry.directory) continue;
          const open = () => zip.read(entry);
          files.push({ source: label, path: normalizePath(entry.name), size: entry.size, open, blob: () => sourceBlob({ source: label, path: entry.name,
            size: entry.size, open }) });
        }
      } else {
        const file = item.file;
        const inside = root.kind === "folder" ? pathInChosenFolder(root.name, item.path) : normalizePath(baseName(item.path));
        files.push({ source: baseName(root.name), path: inside, size: file.size, open: () => streamChunks(file.stream()),
          blob: async () => file });
        loose++;
      }
    }
    if (loose > 0) labels.push(`${baseName(root.name)}/ (${loose} filer)`);
  }
  return { files, labels, problems, close: async () => undefined };
}

export async function scanBrowserSources(files: readonly SourceFile[], options: ScanOptions = {}): Promise<ScanResult> {
  return scanSourceFiles(files, webCryptoSha256, options);
}
