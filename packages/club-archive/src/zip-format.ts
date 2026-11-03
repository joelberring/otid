/**
 * ADR-0194 beslut 6 och ADR-0204: zip-filens format utan Node. Bara centralkatalogen räknas (som säkerhetskopians läsare,
 * ADR-0187), varje post läses som en ström direkt ur filen (okomprimerad eller deflate), och ZIP64 stöds (Google Drive gör
 * zip-filer på flera hundra MB). Läsningen av byte och uppackningen ges av den som anropar: Node (`zip.ts`, filhandtag och
 * zlib) eller webbläsaren (`browser.ts`, `Blob.slice` och `DecompressionStream`).
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

/** Läser `length` byte från `position`; kastar `ZipReadError` när filen tar slut. */
export interface RandomAccess {
  readonly size: number;
  read(position: number, length: number): Promise<Uint8Array>;
}

const EOCD = 0x06054b50, ZIP64_LOCATOR = 0x07064b50, ZIP64_EOCD = 0x06064b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const MAX32 = 0xffffffff, MAX16 = 0xffff;

/** CP437 (zip-filernas gamla teckenkodning) för byte 128–255. */
const CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/** Namnet: UTF-8 när flaggan säger det eller när byten är giltig UTF-8 (macOS sätter inte flaggan), annars CP437. */
export function decodeZipName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder("utf-8").decode(bytes).normalize("NFC");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).normalize("NFC"); } catch {
    return [...bytes].map(byte => byte < 128 ? String.fromCharCode(byte) : CP437[byte - 128]!).join("").normalize("NFC");
  }
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const u64 = (data: DataView, offset: number) => {
  const value = data.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipReadError("Zip-filen är för stor");
  return Number(value);
};

/** Centralkatalogens poster. */
export async function readZipDirectory(file: RandomAccess): Promise<ZipEntryInfo[]> {
  const size = file.size;
  const tailLength = Math.min(size, 65_557);
  const tailBytes = await file.read(size - tailLength, tailLength);
  const tail = view(tailBytes);
  let eocd = -1;
  for (let index = tailBytes.length - 22; index >= 0; index--) if (tail.getUint32(index, true) === EOCD) { eocd = index; break; }
  if (eocd < 0) throw new ZipReadError("Inte en zip-fil (slutet saknas)");
  let total = tail.getUint16(eocd + 10, true), directorySize = tail.getUint32(eocd + 12, true), directoryOffset = tail.getUint32(eocd + 16, true);
  if (total === MAX16 || directorySize === MAX32 || directoryOffset === MAX32) {
    const locator = eocd - 20;
    if (locator < 0 || tail.getUint32(locator, true) !== ZIP64_LOCATOR) throw new ZipReadError("ZIP64-posten saknas");
    const record = view(await file.read(u64(tail, locator + 8), 56));
    if (record.getUint32(0, true) !== ZIP64_EOCD) throw new ZipReadError("ZIP64-posten är fel");
    total = u64(record, 32); directorySize = u64(record, 40); directoryOffset = u64(record, 48);
  }
  if (directoryOffset + directorySize > size) throw new ZipReadError("Centralkatalogen ligger utanför filen");
  const directoryBytes = await file.read(directoryOffset, directorySize);
  const directory = view(directoryBytes);
  const entries: ZipEntryInfo[] = [];
  let at = 0;
  for (let index = 0; index < total; index++) {
    if (at + 46 > directoryBytes.length || directory.getUint32(at, true) !== CENTRAL) throw new ZipReadError("Centralkatalogen är fel");
    const flags = directory.getUint16(at + 8, true), method = directory.getUint16(at + 10, true), crc32 = directory.getUint32(at + 16, true);
    let compressedSize = directory.getUint32(at + 20, true), size = directory.getUint32(at + 24, true);
    const nameLength = directory.getUint16(at + 28, true), extraLength = directory.getUint16(at + 30, true), commentLength = directory.getUint16(at + 32, true);
    let localHeaderOffset = directory.getUint32(at + 42, true);
    const nameBytes = directoryBytes.subarray(at + 46, at + 46 + nameLength);
    const extra = directoryBytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    const extraView = view(extra);
    let name = decodeZipName(nameBytes, (flags & 0x0800) !== 0);
    for (let e = 0; e + 4 <= extra.length;) {
      const id = extraView.getUint16(e, true), length = extraView.getUint16(e + 2, true);
      const data = extra.subarray(e + 4, e + 4 + length);
      const dataView = view(data);
      if (id === 0x0001) {
        let p = 0;
        if (size === MAX32 && p + 8 <= data.length) { size = u64(dataView, p); p += 8; }
        if (compressedSize === MAX32 && p + 8 <= data.length) { compressedSize = u64(dataView, p); p += 8; }
        if (localHeaderOffset === MAX32 && p + 8 <= data.length) { localHeaderOffset = u64(dataView, p); p += 8; }
      } else if (id === 0x7075 && data.length > 5) {
        // Info-ZIP Unicode Path: namnet i UTF-8 när huvudnamnet är i en gammal kodning.
        name = new TextDecoder("utf-8").decode(data.subarray(5)).normalize("NFC");
      }
      e += 4 + length;
    }
    entries.push({ name, method, compressedSize, size, crc32, localHeaderOffset, encrypted: (flags & 1) !== 0, directory: name.endsWith("/") });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Var postens data börjar (efter det lokala huvudet); kastar för krypterade poster och okänd komprimering. */
export async function zipEntryDataStart(file: RandomAccess, entry: ZipEntryInfo): Promise<number> {
  if (entry.encrypted) throw new ZipReadError(`${entry.name}: krypterad post`);
  if (entry.method !== 0 && entry.method !== 8) throw new ZipReadError(`${entry.name}: okänd komprimering ${entry.method}`);
  const local = view(await file.read(entry.localHeaderOffset, 30));
  if (local.getUint32(0, true) !== LOCAL) throw new ZipReadError(`${entry.name}: posten är fel`);
  return entry.localHeaderOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
}

/**
 * Den uppackade postens bitar med kontroll av storleken under läsningen och CRC när hela posten lästs (`crc` saknas = ingen
 * CRC-kontroll).
 */
export async function* checkedZipEntry<T extends Uint8Array>(entry: ZipEntryInfo, stream: AsyncIterable<T>,
  crc?: (chunk: Uint8Array, value: number) => number): AsyncGenerator<T> {
  let value = 0, length = 0;
  for await (const chunk of stream) {
    length += chunk.byteLength;
    if (length > entry.size) throw new ZipReadError(`${entry.name}: större än katalogen säger`);
    if (crc) value = crc(chunk, value);
    yield chunk;
  }
  if (length !== entry.size) throw new ZipReadError(`${entry.name}: storleken stämmer inte`);
  if (crc && (value >>> 0) !== entry.crc32) throw new ZipReadError(`${entry.name}: CRC stämmer inte`);
}
