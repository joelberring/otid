import { createReadStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import * as zlib from "node:zlib";
import { checkedZipEntry, readZipDirectory, zipEntryDataStart, ZipReadError, type RandomAccess, type ZipEntryInfo } from "./zip-format";

/**
 * ADR-0194 beslut 6: läser en zip-fil på datorn utan att packa upp den (formatet i `zip-format.ts`). Varje post läses som en
 * ström direkt ur filen och packas upp i minnet bit för bit. Inget skrivs till disken.
 */
export { decodeZipName, ZipReadError, type ZipEntryInfo } from "./zip-format";

function handleAccess(handle: FileHandle, size: number): RandomAccess {
  return {
    size,
    async read(position, length) {
      const buffer = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await handle.read(buffer, read, length - read, position + read);
        if (bytesRead === 0) throw new ZipReadError("Zip-filen är avkortad");
        read += bytesRead;
      }
      return buffer;
    }
  };
}

export class ZipFile {
  private constructor(readonly path: string, private readonly handle: FileHandle, private readonly access: RandomAccess,
    readonly entries: readonly ZipEntryInfo[]) {}

  static async open(path: string): Promise<ZipFile> {
    const handle = await open(path, "r");
    try {
      const { size } = await handle.stat();
      const access = handleAccess(handle, size);
      return new ZipFile(path, handle, access, await readZipDirectory(access));
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  /** Postens innehåll som en ström (packas upp i minnet bit för bit). CRC kontrolleras när hela posten lästs. */
  async *read(entry: ZipEntryInfo, options: { verify?: boolean } = {}): AsyncGenerator<Buffer> {
    const start = await zipEntryDataStart(this.access, entry);
    if (entry.compressedSize === 0) return;
    const raw = createReadStream(this.path, { start, end: start + entry.compressedSize - 1, highWaterMark: 1024 * 1024 });
    const stream = entry.method === 8 ? raw.pipe(createInflateRaw()) : raw;
    const crcOf = (zlib as { crc32?: (data: Uint8Array, value?: number) => number }).crc32;
    try {
      yield* checkedZipEntry(entry, stream as AsyncIterable<Buffer>, options.verify !== false && crcOf ? crcOf : undefined);
    } finally {
      raw.destroy();
      if (stream !== raw) stream.destroy();
    }
  }

  async close(): Promise<void> { await this.handle.close(); }
}
