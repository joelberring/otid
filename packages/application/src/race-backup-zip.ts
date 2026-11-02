import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Säkerhetskopians arkiv (ADR-0187): en vanlig zip (PKZIP 2.0, deflate eller okomprimerad, ingen ZIP64), så att filen går att
 * öppna med vilket zipprogram som helst. Läsaren är strikt: bara centralkatalogen räknas, inga krypterade poster, inga
 * dubbletter, namnen ska följa ett mönster, varje post packas upp med en gräns och kontrolleras mot sin CRC och storlek.
 */
export class ZipError extends Error {}

export interface ZipEntry { name: string; data: Uint8Array }

const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;
/** 2026-01-01 00:00 i DOS-format; tiden i arkivet bär ingen information (manifestet har tidpunkten). */
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 6 });
    // Redan komprimerade filer (bilder, OCAD) sparas som de är när deflate inte vinner något.
    const stored = compressed.byteLength >= entry.data.byteLength;
    const body = stored ? entry.data : compressed;
    const crc = crc32(entry.data) >>> 0;
    if (offset + 30 + name.byteLength + body.byteLength > 0xffffffff) throw new ZipError("Arkivet blir för stort");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.byteLength, 18); local.writeUInt32LE(entry.data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26); local.writeUInt16LE(0, 28);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(stored ? 0 : 8, 10); header.writeUInt16LE(DOS_TIME, 12); header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(body.byteLength, 20); header.writeUInt32LE(entry.data.byteLength, 24);
    header.writeUInt16LE(name.byteLength, 28); header.writeUInt32LE(offset, 42);
    parts.push(local, name, body);
    central.push(header, name);
    offset += 30 + name.byteLength + body.byteLength;
  }
  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

export interface ZipLimits {
  maxEntries: number;
  /** Största uppackade storlek per post, beroende på namnet. */
  maxEntryBytes: (name: string) => number;
  maxTotalBytes: number;
  /** Tillåtna namn. */
  name: RegExp;
}

interface CentralEntry { name: string; method: number; crc: number; compressedSize: number; size: number; offset: number }

/** Läser katalogen utan att packa upp något. Posterna packas upp en i taget med `extract`. */
export class ZipReader {
  readonly entries: ReadonlyMap<string, CentralEntry>;
  constructor(private readonly bytes: Uint8Array, private readonly limits: ZipLimits) {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let index = buffer.byteLength - 22; index >= Math.max(0, buffer.byteLength - 22 - 0xffff); index -= 1) {
      if (buffer.readUInt32LE(index) === END) { end = index; break; }
    }
    if (end < 0) throw new ZipError("Filen är inte ett zip-arkiv");
    const count = buffer.readUInt16LE(end + 10);
    const size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
    if (buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0 || buffer.readUInt16LE(end + 8) !== count) {
      throw new ZipError("Arkiv i flera delar stöds inte");
    }
    if (count > limits.maxEntries) throw new ZipError("För många filer i arkivet");
    if (start + size > end) throw new ZipError("Arkivets katalog är trasig");
    const entries = new Map<string, CentralEntry>();
    let position = start, total = 0;
    for (let index = 0; index < count; index += 1) {
      if (position + 46 > end || buffer.readUInt32LE(position) !== CENTRAL) throw new ZipError("Arkivets katalog är trasig");
      const flags = buffer.readUInt16LE(position + 8), method = buffer.readUInt16LE(position + 10);
      const crc = buffer.readUInt32LE(position + 16), compressedSize = buffer.readUInt32LE(position + 20);
      const uncompressed = buffer.readUInt32LE(position + 24), nameLength = buffer.readUInt16LE(position + 28);
      const extraLength = buffer.readUInt16LE(position + 30), commentLength = buffer.readUInt16LE(position + 32);
      const offset = buffer.readUInt32LE(position + 42);
      if (position + 46 + nameLength + extraLength + commentLength > end) throw new ZipError("Arkivets katalog är trasig");
      const name = buffer.subarray(position + 46, position + 46 + nameLength).toString("utf8");
      if ((flags & 0x1) !== 0 || (flags & 0x40) !== 0) throw new ZipError("Krypterade arkiv stöds inte");
      if (method !== 0 && method !== 8) throw new ZipError("Okänd komprimering i arkivet");
      if (!limits.name.test(name)) throw new ZipError(`Okänd fil i arkivet: ${name.slice(0, 80)}`);
      if (entries.has(name)) throw new ZipError("Samma fil finns två gånger i arkivet");
      if (uncompressed > limits.maxEntryBytes(name)) throw new ZipError(`För stor fil i arkivet: ${name}`);
      if (method === 0 && compressedSize !== uncompressed) throw new ZipError("Arkivets katalog är trasig");
      total += uncompressed;
      if (total > limits.maxTotalBytes) throw new ZipError("Arkivet är för stort uppackat");
      entries.set(name, { name, method, crc, compressedSize, size: uncompressed, offset });
      position += 46 + nameLength + extraLength + commentLength;
    }
    this.entries = entries;
  }

  /** Packar upp en post och kontrollerar storlek och CRC. Ger undefined när posten saknas. */
  extract(name: string): Uint8Array | undefined {
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    const buffer = Buffer.from(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    const local = entry.offset;
    if (local + 30 > buffer.byteLength || buffer.readUInt32LE(local) !== LOCAL) throw new ZipError("Arkivet är trasigt");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + entry.compressedSize > buffer.byteLength) throw new ZipError("Arkivet är trasigt");
    const body = buffer.subarray(start, start + entry.compressedSize);
    let data: Uint8Array;
    try {
      data = entry.method === 0 ? body : inflateRawSync(body, { maxOutputLength: Math.max(1, entry.size) });
    } catch { throw new ZipError(`Filen ${name} i arkivet är trasig`); }
    if (data.byteLength !== entry.size || (crc32(data) >>> 0) !== entry.crc) throw new ZipError(`Filen ${name} i arkivet är trasig`);
    return data;
  }
}
