/**
 * Bygger minimala OCAD-filer för tester: version 9–12+ med `buildOcd` och version 8 med `buildOcd8`. Bara de fält som läsaren
 * använder fylls i. Symbolkropparna anges alltid som i version 12 (från 796); byggaren flyttar dem till versionens layout.
 */

export interface OcdCoord { readonly x: number; readonly y: number; readonly xFlags?: number; readonly yFlags?: number }

export interface OcdSymbolSpec {
  readonly number: number;
  readonly type: number;
  readonly description?: string;
  readonly status?: number;
  /** Bytes från position 796 och framåt (version 12:s layout). */
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

/**
 * Indexblock om 256 poster i en kedja (blockets första fält pekar på nästa), så att testkartor kan ha fler än 256 objekt.
 * Ger blockets position och postens nummer i blocket för post nummer `k`.
 */
function chained(w: Writer, firstPointer: number, entrySize: number): (k: number) => [number, number] {
  let block = 0;
  return k => {
    if (k % 256 === 0) {
      const next = w.reserve(4 + 256 * entrySize);
      w.i32(block === 0 ? firstPointer : block, next);
      block = next;
    }
    return [block, k % 256];
  };
}

/** Windows-1252 för tecken under 256 (räcker för testerna: å, ä, ö). */
const latin1 = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0) & 0xff);

const utf16 = (text: string) => {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) { out[2 * i] = text.charCodeAt(i) & 0xff; out[2 * i + 1] = text.charCodeAt(i) >> 8; }
  return out;
};

/** OCAD-koordinat i 0,01 mm med flaggor i de låga 8 bitarna. */
export function ocdCoord(x: number, y: number, xFlags = 0, yFlags = 0): OcdCoord {
  return { x, y, xFlags, yFlags };
}

/**
 * Ytsymbolens kropp i version 9–11: datastorleken och ritdatan ligger 4 byte tidigare än i version 12 (byte 30–33 i
 * version 12:s kropp finns inte).
 */
function areaBodyBefore12(body: Uint8Array): Uint8Array {
  if (body.length < 36) return body.slice(0, Math.min(body.length, 32));
  return concat(body.subarray(0, 30), body.subarray(34));
}

/** Text i strängparametrar: UTF-8 (förval) eller Windows-1252 som OCAD 8–11 ofta skrev. */
export type StringEncoding = "UTF8" | "WINDOWS_1252";

export function buildOcd(spec: OcdSpec & { readonly encoding?: StringEncoding }): Uint8Array {
  const version = spec.version ?? 2018;
  const before12 = version < 12;
  const symbolBase = version <= 10 ? 572 : 796;
  const objectHeader = before12 ? 40 : 56;
  const w = new Writer();
  const header = w.reserve(64);
  w.u16(header, 0x0cad);
  w.u16(header + 4, version);
  w.u8(header + 6, spec.subversion ?? 8);

  const symbols = spec.symbols ?? [];
  if (symbols.length > 0) {
    const slot = chained(w, header + 8, 4);
    symbols.forEach((symbol, k) => {
      const [block, index] = slot(k);
      const raw = symbol.body ?? new Uint8Array(0);
      const body = before12 && symbol.type === 3 ? areaBodyBefore12(raw) : raw;
      const size = symbolBase + body.length;
      const at = w.reserve(size);
      w.i32(block + 4 + index * 4, at);
      w.i32(at, size);
      w.i32(at + 4, symbol.number);
      w.u8(at + 8, symbol.type);
      w.u8(at + 11, symbol.status ?? 0);
      const description = symbol.description ?? `Symbol ${symbol.number}`;
      if (version <= 10) { w.u8(at + 56, description.length); w.bytes(at + 57, latin1(description)); }
      else w.bytes(at + 56, utf16(description));
      w.bytes(at + symbolBase, body);
    });
  }

  const objects = spec.objects ?? [];
  if (objects.length > 0) {
    const slot = chained(w, header + 12, 40);
    objects.forEach((object, k) => {
      const [block, index] = slot(k);
      const text = object.text === undefined ? new Uint8Array(0) : utf16(`${object.text}\0`);
      const textWords = Math.ceil(text.length / 8);
      const size = objectHeader + 8 * (object.coords.length + textWords);
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
      w.i32(at + (before12 ? 8 : 44), object.coords.length);
      w.u16(at + (before12 ? 12 : 48), textWords);
      object.coords.forEach((coord, k) => {
        w.i32(at + objectHeader + 8 * k, (Math.round(coord.x) << 8) | (coord.xFlags ?? 0));
        w.i32(at + objectHeader + 4 + 8 * k, (Math.round(coord.y) << 8) | (coord.yFlags ?? 0));
      });
      w.bytes(at + objectHeader + 8 * object.coords.length, text);
    });
  }

  const strings = spec.strings ?? [];
  if (strings.length > 0) {
    const block = w.reserve(4 + 256 * 16);
    w.i32(header + 32, block);
    strings.forEach((entry, index) => {
      const data = spec.encoding === "WINDOWS_1252" ? latin1(entry.value) : new TextEncoder().encode(entry.value);
      const at = w.reserve(data.length + 1);
      w.bytes(at, data);
      w.i32(block + 4 + index * 16, at);
      w.i32(block + 8 + index * 16, data.length + 1);
      w.i32(block + 12 + index * 16, entry.type);
    });
  }
  return w.result();
}

export interface Ocd8Spec {
  /** Färgerna: nummer, namn och CMYK i procent. */
  readonly colors?: readonly { readonly number: number; readonly name: string; readonly cmyk: readonly [number, number, number, number] }[];
  readonly scale?: number;
  readonly realWorld?: { readonly x: number; readonly y: number; readonly angle?: number };
  /** Symbolnummer som i version 8 (1012 = 101.2). Ytsymbolens kropp i version 8:s form (`areaBody8`). */
  readonly symbols?: readonly OcdSymbolSpec[];
  /** `symbol` som i version 8; `deleted` sätter symbol 0 i indexet; `ansi` skriver texten i Windows-1252. */
  readonly objects?: readonly (OcdObjectSpec & { readonly deleted?: boolean; readonly ansi?: boolean })[];
}

/** OCAD 8: färghuvud, inställningspost, symbolhuvud om 348 byte, index om 24 byte och objekthuvud om 32 byte. */
export function buildOcd8(spec: Ocd8Spec): Uint8Array {
  const w = new Writer();
  const header = w.reserve(48);
  w.u16(header, 0x0cad);
  w.u16(header + 2, 2);
  w.u16(header + 4, 8);
  const colors = spec.colors ?? [];
  const symHeader = w.reserve(24 + 256 * 72 + 32 * 24);
  w.i16(symHeader, colors.length);
  colors.forEach((color, index) => {
    const at = 72 + index * 72;
    w.i16(at, color.number);
    color.cmyk.forEach((value, k) => w.u8(at + 4 + k, Math.round(value * 2)));
    w.u8(at + 8, color.name.length);
    w.bytes(at + 9, latin1(color.name));
  });
  const setup = w.reserve(64);
  w.i32(header + 16, setup);
  w.i32(header + 20, 64);
  const view = new DataView(new ArrayBuffer(8));
  const double = (at: number, value: number) => { view.setFloat64(0, value, true); w.bytes(at, new Uint8Array(view.buffer.slice(0))); };
  double(setup + 24, spec.scale ?? 10000);
  double(setup + 32, spec.realWorld?.x ?? 0);
  double(setup + 40, spec.realWorld?.y ?? 0);
  double(setup + 48, spec.realWorld?.angle ?? 0);

  const symbols = spec.symbols ?? [];
  if (symbols.length > 0) {
    const block = w.reserve(4 + 256 * 4);
    w.i32(header + 8, block);
    symbols.forEach((symbol, index) => {
      const body = symbol.body ?? new Uint8Array(0);
      const size = 348 + body.length;
      const at = w.reserve(size);
      w.i32(block + 4 + index * 4, at);
      w.i16(at, size);
      w.i16(at + 2, symbol.number);
      w.i16(at + 4, symbol.type);
      w.u8(at + 11, symbol.status ?? 0);
      const description = symbol.description ?? `Symbol ${symbol.number}`;
      w.u8(at + 52, description.length);
      w.bytes(at + 53, latin1(description));
      w.bytes(at + 348, body);
    });
  }
  const objects = spec.objects ?? [];
  if (objects.length > 0) {
    const block = w.reserve(4 + 256 * 24);
    w.i32(header + 12, block);
    objects.forEach((object, index) => {
      const text = object.text === undefined ? new Uint8Array(0) : object.ansi ? latin1(`${object.text}\0`) : utf16(`${object.text}\0`);
      const textWords = Math.ceil(text.length / 8);
      const at = w.reserve(32 + 8 * (object.coords.length + textWords));
      const entry = block + 4 + index * 24;
      w.i32(entry + 16, at);
      w.u16(entry + 20, object.coords.length + textWords);
      w.i16(entry + 22, object.deleted ? 0 : object.symbol);
      w.i16(at, object.symbol);
      w.u8(at + 2, object.type);
      w.u8(at + 3, object.ansi ? 0 : 1);
      w.i16(at + 4, object.coords.length);
      w.i16(at + 6, textWords);
      w.i16(at + 8, object.angle ?? 0);
      object.coords.forEach((coord, k) => {
        w.i32(at + 32 + 8 * k, (Math.round(coord.x) << 8) | (coord.xFlags ?? 0));
        w.i32(at + 36 + 8 * k, (Math.round(coord.y) << 8) | (coord.yFlags ?? 0));
      });
      w.bytes(at + 32 + 8 * object.coords.length, text);
    });
  }
  return w.result();
}

/** Ytsymbolens kropp i version 8 ur version 12:s: FillOn som 16 bit vid +2 och ritdatan 4 byte tidigare. */
export function areaBody8(body: Uint8Array): Uint8Array {
  // Version 9–11:s kropp utan kantlinjen (AreaFlags och FillOn i stället) och utan byten FillOn/BorderOn (814–815).
  const before = areaBodyBefore12(body);
  const fillOn = body.length > 18 ? body[18]! : 0;
  const out = before.length > 20 ? concat(before.subarray(0, 18), before.subarray(20)) : before.slice(0, Math.min(before.length, 18));
  out.fill(0, 0, 4);
  out[2] = fillOn;
  return out;
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
