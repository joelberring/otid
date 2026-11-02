import { createReadStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import * as zlib from "node:zlib";

/**
 * ADR-0194 beslut 6: läser en zip-fil utan att packa upp den. Bara centralkatalogen räknas (som säkerhetskopians läsare,
 * ADR-0187), varje post läses som en ström direkt ur filen (okomprimerad eller deflate), och ZIP64 stöds (Google Drive gör
 * zip-filer på flera hundra MB). Inget skrivs till disken.
 */
export class ZipReadError extends Error {}

export interface ZipEntryInfo {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly crc32: number;
  readonly localHeaderOffset: number;
  readonly encrypted: boolean;
  readonly directory: boolean;
}

const EOCD = 0x06054b50, ZIP64_LOCATOR = 0x07064b50, ZIP64_EOCD = 0x06064b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const MAX32 = 0xffffffff, MAX16 = 0xffff;

/** CP437 (zip-filernas gamla teckenkodning) för byte 128–255. */
const CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/** Namnet: UTF-8 när flaggan säger det eller när byten är giltig UTF-8 (macOS sätter inte flaggan), annars CP437. */
export function decodeZipName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder("utf-8").decode(bytes).normalize("NFC");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).normalize("NFC"); } catch {
    return [...bytes].map(byte => byte < 128 ? String.fromCharCode(byte) : CP437[byte - 128]!).join("").normalize("NFC");
  }
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, read, length - read, position + read);
    if (bytesRead === 0) throw new ZipReadError("Zip-filen är avkortad");
    read += bytesRead;
  }
  return buffer;
}

const u64 = (buffer: Buffer, offset: number) => {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipReadError("Zip-filen är för stor");
  return Number(value);
};

export class ZipFile {
  private constructor(readonly path: string, private readonly handle: FileHandle, readonly entries: readonly ZipEntryInfo[]) {}

  static async open(path: string): Promise<ZipFile> {
    const handle = await open(path, "r");
    try {
      const { size } = await handle.stat();
      const tailLength = Math.min(size, 65_557);
      const tail = await readAt(handle, size - tailLength, tailLength);
      let eocd = -1;
      for (let index = tail.length - 22; index >= 0; index--) if (tail.readUInt32LE(index) === EOCD) { eocd = index; break; }
      if (eocd < 0) throw new ZipReadError("Inte en zip-fil (slutet saknas)");
      let total = tail.readUInt16LE(eocd + 10), directorySize = tail.readUInt32LE(eocd + 12), directoryOffset = tail.readUInt32LE(eocd + 16);
      if (total === MAX16 || directorySize === MAX32 || directoryOffset === MAX32) {
        const locator = eocd - 20;
        if (locator < 0 || tail.readUInt32LE(locator) !== ZIP64_LOCATOR) throw new ZipReadError("ZIP64-posten saknas");
        const record = await readAt(handle, u64(tail, locator + 8), 56);
        if (record.readUInt32LE(0) !== ZIP64_EOCD) throw new ZipReadError("ZIP64-posten är fel");
        total = u64(record, 32); directorySize = u64(record, 40); directoryOffset = u64(record, 48);
      }
      if (directoryOffset + directorySize > size) throw new ZipReadError("Centralkatalogen ligger utanför filen");
      const directory = await readAt(handle, directoryOffset, directorySize);
      const entries: ZipEntryInfo[] = [];
      let at = 0;
      for (let index = 0; index < total; index++) {
        if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL) throw new ZipReadError("Centralkatalogen är fel");
        const flags = directory.readUInt16LE(at + 8), method = directory.readUInt16LE(at + 10), crc32 = directory.readUInt32LE(at + 16);
        let compressedSize = directory.readUInt32LE(at + 20), size = directory.readUInt32LE(at + 24);
        const nameLength = directory.readUInt16LE(at + 28), extraLength = directory.readUInt16LE(at + 30), commentLength = directory.readUInt16LE(at + 32);
        let localHeaderOffset = directory.readUInt32LE(at + 42);
        const nameBytes = directory.subarray(at + 46, at + 46 + nameLength);
        const extra = directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
        let name = decodeZipName(nameBytes, (flags & 0x0800) !== 0);
        for (let e = 0; e + 4 <= extra.length;) {
          const id = extra.readUInt16LE(e), length = extra.readUInt16LE(e + 2);
          const data = extra.subarray(e + 4, e + 4 + length);
          if (id === 0x0001) {
            let p = 0;
            if (size === MAX32 && p + 8 <= data.length) { size = u64(data, p); p += 8; }
            if (compressedSize === MAX32 && p + 8 <= data.length) { compressedSize = u64(data, p); p += 8; }
            if (localHeaderOffset === MAX32 && p + 8 <= data.length) { localHeaderOffset = u64(data, p); p += 8; }
          } else if (id === 0x7075 && data.length > 5) {
            // Info-ZIP Unicode Path: namnet i UTF-8 när huvudnamnet är i en gammal kodning.
            name = new TextDecoder("utf-8").decode(data.subarray(5)).normalize("NFC");
          }
          e += 4 + length;
        }
        entries.push({ name, method, compressedSize, size, crc32, localHeaderOffset, encrypted: (flags & 1) !== 0, directory: name.endsWith("/") });
        at += 46 + nameLength + extraLength + commentLength;
      }
      return new ZipFile(path, handle, entries);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  /** Postens innehåll som en ström (packas upp i minnet bit för bit). CRC kontrolleras när hela posten lästs. */
  async *read(entry: ZipEntryInfo, options: { verify?: boolean } = {}): AsyncGenerator<Buffer> {
    if (entry.encrypted) throw new ZipReadError(`${entry.name}: krypterad post`);
    if (entry.method !== 0 && entry.method !== 8) throw new ZipReadError(`${entry.name}: okänd komprimering ${entry.method}`);
    const local = await readAt(this.handle, entry.localHeaderOffset, 30);
    if (local.readUInt32LE(0) !== LOCAL) throw new ZipReadError(`${entry.name}: posten är fel`);
    const start = entry.localHeaderOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    if (entry.compressedSize === 0) return;
    const raw = createReadStream(this.path, { start, end: start + entry.compressedSize - 1, highWaterMark: 1024 * 1024 });
    const stream = entry.method === 8 ? raw.pipe(createInflateRaw()) : raw;
    const crcOf = (zlib as { crc32?: (data: Uint8Array, value?: number) => number }).crc32;
    let crc = 0, length = 0;
    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        length += chunk.byteLength;
        if (length > entry.size) throw new ZipReadError(`${entry.name}: större än katalogen säger`);
        if (options.verify !== false && crcOf) crc = crcOf(chunk, crc);
        yield chunk;
      }
    } finally {
      raw.destroy();
      if (stream !== raw) stream.destroy();
    }
    if (length !== entry.size) throw new ZipReadError(`${entry.name}: storleken stämmer inte`);
    if (options.verify !== false && crcOf && (crc >>> 0) !== entry.crc32) throw new ZipReadError(`${entry.name}: CRC stämmer inte`);
  }

  async close(): Promise<void> { await this.handle.close(); }
}
