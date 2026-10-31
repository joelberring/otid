/** Bygger minimala OCAD-filer (version 12+) för tester. Bara de fält som läsaren använder fylls i. */

export interface OcdCoord { readonly x: number; readonly y: number; readonly xFlags?: number; readonly yFlags?: number }

export interface OcdSymbolSpec {
  readonly number: number;
  readonly type: number;
  readonly description?: string;
  readonly status?: number;
  /** Bytes från position 796 och framåt. */
  readonly body?: Uint8Array;
}

export interface OcdObjectSpec {
  readonly symbol: number;
  readonly type: number;
  readonly status?: number;
  readonly angle?: number;
  readonly coords: readonly OcdCoord[];
  readonly text?: string;
}

export interface OcdSpec {
  readonly version?: number;
  readonly subversion?: number;
  readonly strings?: readonly { readonly type: number; readonly value: string }[];
  readonly symbols?: readonly OcdSymbolSpec[];
  readonly objects?: readonly OcdObjectSpec[];
}

class Writer {
  private buffer = new Uint8Array(4096);
  private view = new DataView(this.buffer.buffer);
  length = 0;

  reserve(size: number): number {
    const at = this.length;
    this.length += size;
    if (this.length > this.buffer.length) {
      const bigger = new Uint8Array(Math.max(this.length, this.buffer.length * 2));
      bigger.set(this.buffer);
      this.buffer = bigger;
      this.view = new DataView(bigger.buffer);
    }
    return at;
  }

  u8(at: number, value: number) { this.view.setUint8(at, value); }
  u16(at: number, value: number) { this.view.setUint16(at, value, true); }
  i16(at: number, value: number) { this.view.setInt16(at, value, true); }
  i32(at: number, value: number) { this.view.setInt32(at, value, true); }
  bytes(at: number, data: Uint8Array) { this.buffer.set(data, at); }
  result(): Uint8Array { return this.buffer.slice(0, this.length); }
}

const utf16 = (text: string) => {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) { out[2 * i] = text.charCodeAt(i) & 0xff; out[2 * i + 1] = text.charCodeAt(i) >> 8; }
  return out;
};

/** OCAD-koordinat i 0,01 mm med flaggor i de låga 8 bitarna. */
export function ocdCoord(x: number, y: number, xFlags = 0, yFlags = 0): OcdCoord {
  return { x, y, xFlags, yFlags };
}

export function buildOcd(spec: OcdSpec): Uint8Array {
  const w = new Writer();
  const header = w.reserve(64);
  w.u16(header, 0x0cad);
  w.u16(header + 4, spec.version ?? 2018);
  w.u8(header + 6, spec.subversion ?? 8);

  const symbols = spec.symbols ?? [];
  if (symbols.length > 0) {
    const block = w.reserve(4 + 256 * 4);
    w.i32(header + 8, block);
    symbols.forEach((symbol, index) => {
      const body = symbol.body ?? new Uint8Array(0);
      const size = 796 + body.length;
      const at = w.reserve(size);
      w.i32(block + 4 + index * 4, at);
      w.i32(at, size);
      w.i32(at + 4, symbol.number);
      w.u8(at + 8, symbol.type);
      w.u8(at + 11, symbol.status ?? 0);
      w.bytes(at + 56, utf16(symbol.description ?? `Symbol ${symbol.number}`));
      w.bytes(at + 796, body);
    });
  }

  const objects = spec.objects ?? [];
  if (objects.length > 0) {
    const block = w.reserve(4 + 256 * 40);
    w.i32(header + 12, block);
    objects.forEach((object, index) => {
      const text = object.text === undefined ? new Uint8Array(0) : utf16(`${object.text}\0`);
      const textWords = Math.ceil(text.length / 8);
      const size = 56 + 8 * (object.coords.length + textWords);
      const at = w.reserve(size);
      const entry = block + 4 + index * 40;
      w.i32(entry + 16, at);
      w.i32(entry + 20, size);
      w.i32(entry + 24, object.symbol);
      w.u8(entry + 28, object.type);
      w.u8(entry + 30, object.status ?? 1);
      w.i32(at, object.symbol);
      w.u8(at + 4, object.type);
      w.i16(at + 6, object.angle ?? 0);
      w.i32(at + 44, object.coords.length);
      w.u16(at + 48, textWords);
      object.coords.forEach((coord, k) => {
        w.i32(at + 56 + 8 * k, (Math.round(coord.x) << 8) | (coord.xFlags ?? 0));
        w.i32(at + 60 + 8 * k, (Math.round(coord.y) << 8) | (coord.yFlags ?? 0));
      });
      w.bytes(at + 56 + 8 * object.coords.length, text);
    });
  }

  const strings = spec.strings ?? [];
  if (strings.length > 0) {
    const block = w.reserve(4 + 256 * 16);
    w.i32(header + 32, block);
    strings.forEach((entry, index) => {
      const data = new TextEncoder().encode(entry.value);
      const at = w.reserve(data.length + 1);
      w.bytes(at, data);
      w.i32(block + 4 + index * 16, at);
      w.i32(block + 8 + index * 16, data.length + 1);
      w.i32(block + 12 + index * 16, entry.type);
    });
  }
  return w.result();
}

/** Bytes för en symbolkropp (från position 796) med 16-bitarstal på givna positioner. */
export function symbolBody(size: number, fields: Readonly<Record<number, number>>, extra?: (view: DataView) => void): Uint8Array {
  const body = new Uint8Array(size);
  const view = new DataView(body.buffer);
  for (const [offset, value] of Object.entries(fields)) view.setInt16(Number(offset) - 796, value, true);
  extra?.(view);
  return body;
}

/** Ett ritelement (16 byte huvud + koordinater) för punkt- och ytsymboler. */
export function element(type: number, color: number, lineWidth: number, diameter: number, coords: readonly OcdCoord[]): Uint8Array {
  const out = new Uint8Array(16 + 8 * coords.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, type, true);
  view.setUint16(4, color, true);
  view.setInt16(6, lineWidth, true);
  view.setInt16(8, diameter, true);
  view.setUint16(10, coords.length, true);
  coords.forEach((coord, k) => {
    view.setInt32(16 + 8 * k, (coord.x << 8) | (coord.xFlags ?? 0), true);
    view.setInt32(20 + 8 * k, (coord.y << 8) | (coord.yFlags ?? 0), true);
  });
  return out;
}

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** Enkel deterministisk slumpgenerator (mulberry32) för slumptester. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
