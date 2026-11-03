import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { baseName, extensionOf, normalizePath, pathInChosenFolder } from "./folder-name";
import { scanSourceFiles, type CreateSha256, type ScanResult, type SourceFile, type Sources } from "./scan-core";
import { ZipFile } from "./zip";

/**
 * ADR-0194 beslut 6: filerna i en mapp på datorn med zip-filer och/eller uppackade mappar (kommandot). Läsningen är densamma
 * som i webbläsaren (`scan-core.ts`); här finns bara filsystemet och node:crypto.
 */
export { COURSE_FILE_MAX_BYTES, type ScanResult, type SourceFile, type Sources } from "./scan-core";

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
        const inside = info.isDirectory() ? pathInChosenFolder(baseName(root), relative(root, path).split(sep).join("/")) : normalizePath(baseName(path));
        files.push({ source: baseName(root), path: inside, size, open: () => createReadStream(path) as AsyncIterable<Buffer> });
        loose++;
      }
    }
    if (loose > 0) labels.push(`${baseName(root)}/ (${loose} filer)`);
  }
  return { files, labels, close: async () => { for (const zip of zips) await zip.close(); } };
}

export const nodeSha256: CreateSha256 = () => {
  const hash = createHash("sha256");
  return { update: chunk => { hash.update(chunk); }, digest: async () => hash.digest("hex") };
};

export async function scanSources(files: readonly SourceFile[], onProgress: (done: number, total: number, path: string) => void = () => undefined)
  : Promise<ScanResult> {
  return scanSourceFiles(files, nodeSha256, { onProgress });
}
