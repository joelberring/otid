/** Läsning med gränskontroll: varje läsning utanför filen ger `MapFileError("TRUNCATED")`, aldrig en krasch eller ett hängande. */
import { MapFileError } from "../model";

export class Bytes {
  private readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number { return this.bytes.length; }

  has(offset: number, size: number): boolean {
    return Number.isInteger(offset) && offset >= 0 && size >= 0 && offset + size <= this.bytes.length;
  }

  check(offset: number, size: number, what: string): void {
    if (!this.has(offset, size)) throw new MapFileError("TRUNCATED", `OCAD-filen är avkortad eller trasig (${what} ligger utanför filen).`);
  }

  u8(offset: number): number { this.check(offset, 1, "byte"); return this.view.getUint8(offset); }
  u16(offset: number): number { this.check(offset, 2, "tal"); return this.view.getUint16(offset, true); }
  i16(offset: number): number { this.check(offset, 2, "tal"); return this.view.getInt16(offset, true); }
  u32(offset: number): number { this.check(offset, 4, "tal"); return this.view.getUint32(offset, true); }
  i32(offset: number): number { this.check(offset, 4, "tal"); return this.view.getInt32(offset, true); }

  /** UTF-16LE fram till första nolltecknet, högst `maxBytes`. */
  utf16(offset: number, maxBytes: number): string {
    this.check(offset, maxBytes, "text");
    let end = offset;
    while (end + 1 < offset + maxBytes && (this.bytes[end]! !== 0 || this.bytes[end + 1]! !== 0)) end += 2;
    return new TextDecoder("utf-16le").decode(this.bytes.subarray(offset, end));
  }

  /** UTF-8 fram till första nolltecknet, högst `maxBytes`. */
  utf8(offset: number, maxBytes: number): string {
    this.check(offset, maxBytes, "text");
    let end = offset;
    while (end < offset + maxBytes && this.bytes[end]! !== 0) end++;
    return new TextDecoder("utf-8").decode(this.bytes.subarray(offset, end));
  }

  /** Pascalsträng: en längdbyte följd av högst `capacity` tecken (UTF-8 i OCAD 12 och senare). */
  pascal(offset: number, capacity: number): string {
    const length = Math.min(this.u8(offset), capacity);
    return this.utf8(offset + 1, length);
  }
}

/**
 * Följer en kedja av indexblock (första fältet är nästa blocks position). Kedjan begränsas av filens storlek och
 * avbryts vid en slinga, så att en trasig fil aldrig kan hänga läsaren.
 */
export function indexBlocks(bytes: Bytes, first: number, blockSize: number): number[] {
  const blocks: number[] = [];
  const seen = new Set<number>();
  const limit = Math.floor(bytes.length / blockSize) + 1;
  for (let position = first; position !== 0; position = bytes.u32(position)) {
    if (seen.has(position) || blocks.length >= limit) throw new MapFileError("INVALID", "OCAD-filens index går i en slinga.");
    bytes.check(position, blockSize, "indexblock");
    seen.add(position);
    blocks.push(position);
  }
  return blocks;
}
