import type { BrowserRoot } from "@o-tid/club-archive/browser";

/**
 * ADR-0204: det som valdes i importen som källor, som kommandots argument: en mapp (med filerna under den) eller en fil (zip
 * eller lös fil). "Välj mapp" ger `webkitRelativePath` (`Mapp/2019/…`); dra och släpp ger mappar som FileSystemEntry. Filerna
 * öppnas inte här, bara namnen och storlekarna samlas.
 */

/** "Välj mapp": filerna grupperade på mappen överst (den del av sökvägen som kommandot inte heller tar med). */
export function rootsFromFolderInput(files: readonly File[]): BrowserRoot[] {
  const folders = new Map<string, { path: string; file: File }[]>();
  const loose: BrowserRoot[] = [];
  for (const file of files) {
    const relative = file.webkitRelativePath || "";
    const slash = relative.indexOf("/");
    if (slash <= 0) { loose.push({ kind: "file", name: file.name, file }); continue; }
    const name = relative.slice(0, slash);
    const list = folders.get(name) ?? [];
    list.push({ path: relative.slice(slash + 1), file });
    folders.set(name, list);
  }
  return [...[...folders].map(([name, list]): BrowserRoot => ({ kind: "folder", name, files: list })), ...loose];
}

/** "Välj filer": varje fil är en egen källa (zip-filer öppnas som zip). */
export const rootsFromFileInput = (files: readonly File[]): BrowserRoot[] => files.map(file => ({ kind: "file", name: file.name, file }));

const readEntries = (reader: FileSystemDirectoryReader) => new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
const entryFile = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

async function walk(directory: FileSystemDirectoryEntry, prefix: string, out: { path: string; file: File }[]): Promise<void> {
  const reader = directory.createReader();
  // readEntries ger en del i taget (Chrome 100 st); läs tills listan är tom.
  for (;;) {
    const batch = await readEntries(reader);
    if (batch.length === 0) return;
    for (const entry of batch) {
      if (entry.isFile) out.push({ path: `${prefix}${entry.name}`, file: await entryFile(entry as FileSystemFileEntry) });
      else if (entry.isDirectory) await walk(entry as FileSystemDirectoryEntry, `${prefix}${entry.name}/`, out);
    }
  }
}

/**
 * Dra och släpp: mappar läses rekursivt, filer blir egna källor. Posterna måste hämtas innan något väntas på, annars är
 * DataTransfer redan tömd (webbläsarna rensar den efter händelsen).
 */
export async function rootsFromDrop(transfer: DataTransfer): Promise<BrowserRoot[]> {
  const items = [...transfer.items].filter(item => item.kind === "file")
    .map(item => ({ entry: typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null, file: item.getAsFile() }));
  const roots: BrowserRoot[] = [];
  for (const { entry, file } of items) {
    if (entry?.isDirectory) {
      const files: { path: string; file: File }[] = [];
      await walk(entry as FileSystemDirectoryEntry, "", files);
      roots.push({ kind: "folder", name: entry.name, files });
    } else if (file) roots.push({ kind: "file", name: file.name, file });
  }
  return roots;
}

/** Kort beskrivning av en källa (för listan "Valt"). */
export const rootSize = (root: BrowserRoot): number => root.kind === "file" ? root.file.size : root.files.reduce((sum, item) => sum + item.file.size, 0);
