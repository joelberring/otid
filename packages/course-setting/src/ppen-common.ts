/** Det som läsaren och skrivaren av .ppen delar: namn på slag, tal, ringavbrott och råa element. */
import type { CircleGap, ControlKind, Course, CourseSettingDocument, Leg, OverprintStandard, RawXml } from "./types";
import { CourseSettingEditError } from "./types";
import { el, parseXml, serializeXml, type XmlElement } from "./xml";

export const ROOT = "course-scribe-event";

export const CONTROL_KINDS: Readonly<Record<string, ControlKind>> = {
  normal: "NORMAL", start: "START", finish: "FINISH", "crossing-point": "CROSSING_POINT", "map-exchange": "MAP_EXCHANGE",
  "map-issue": "MAP_ISSUE"
};
export const LABEL_KINDS: Readonly<Record<string, Course["labelKind"]>> = {
  sequence: "SEQUENCE", code: "CODE", "sequence-and-code": "SEQUENCE_AND_CODE", "sequence-and-score": "SEQUENCE_AND_SCORE",
  "code-and-score": "CODE_AND_SCORE", score: "SCORE"
};
export const FLAGGING_KINDS: Readonly<Record<string, NonNullable<Leg["flagging"]>>> = {
  none: "NONE", all: "ALL", "beginning-part": "BEGINNING", "end-part": "END", "map-issue-middle": "MIDDLE"
};
/** Purple Pens specialobjekt (EventDB.cs, Special.ReadAttributesAndContent); andra slag kan Purple Pen inte läsa. */
export const SPECIAL_KINDS = new Set([
  "first-aid", "water", "optional-crossing-point", "forbidden-route", "registration-mark", "boundary", "out-of-bounds",
  "dangerous-area", "temporary-construction", "white-out", "text", "descriptions", "image", "line", "rectangle", "ellipse"
]);
export const MAP_STANDARDS: Readonly<Record<string, OverprintStandard>> = { "2017": "ISOM2017", Spr2019: "ISSPROM2019", "2000": "ISOM2017" };

export function invertRecord<V extends string>(record: Readonly<Record<string, V>>): Record<V, string> {
  const out = {} as Record<V, string>;
  for (const [key, value] of Object.entries(record)) if (!(value in out)) out[value] = key;
  return out;
}

export function invalid(message: string): CourseSettingEditError {
  return new CourseSettingEditError("INVALID", `Ingen giltig .ppen: ${message}`);
}

/** Ett tal ur filen (Purple Pen skriver med punkt, ibland med exponent). */
export function parseNumber(text: string | undefined, what: string): number {
  const value = text === undefined ? NaN : Number(text.trim());
  if (text === undefined || text.trim() === "" || !Number.isFinite(value)) throw invalid(`${what} är inte ett tal (${text ?? "saknas"})`);
  return value;
}

export function parseInteger(text: string | undefined, what: string): number {
  const value = parseNumber(text, what);
  if (!Number.isInteger(value)) throw invalid(`${what} är inte ett heltal (${text})`);
  return value;
}

/** Purple Pen läser true/false med XmlConvert (även 1/0). */
export function parseBool(text: string, what: string): boolean {
  const value = text.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw invalid(`${what} är inte true/false (${text})`);
}

/** Talet som text: exakt det som lästes (JavaScript skriver kortaste formen som läses tillbaka lika). */
export function formatNumber(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

/** Kortaste text som ger samma 32-bitarstal, som Purple Pens `XmlConvert.ToString(float)`. */
export function formatFloat32(value: number): string {
  const target = Math.fround(value);
  for (let digits = 1; digits <= 9; digits++) {
    const candidate = Number(value.toPrecision(digits));
    if (Math.fround(candidate) === target) return formatNumber(candidate);
  }
  return formatNumber(value);
}

/** Nya ringavbrott "start:slut,start:slut" (CircleGap.DecodeGaps i Purple Pen). */
export function decodeCircleGaps(text: string, scale: number | null): CircleGap[] {
  const gaps: CircleGap[] = [];
  for (const part of text.split(",")) {
    const [start, end, ...rest] = part.split(":");
    if (start === undefined || end === undefined || rest.length > 0) continue;
    const startDegrees = Number(start.trim());
    const endDegrees = Number(end.trim());
    if (Number.isFinite(startDegrees) && Number.isFinite(endDegrees)) gaps.push({ scale, startDegrees, endDegrees });
  }
  return gaps;
}

export function encodeCircleGaps(gaps: readonly CircleGap[]): string {
  return gaps.map(gap => `${formatNumber(gap.startDegrees)}:${formatNumber(gap.endDegrees)}`).join(",");
}

/**
 * Gamla ringavbrott: 32 bitar, en per 11,25°, 0 = avbrott (CircleGap.ComputeCircleGaps i Purple Pen, BSD). `null` om
 * texten inte är bitar.
 */
export function decodeOldCircleGaps(bits: string, scale: number | null): CircleGap[] | null {
  const text = bits.trim();
  if (!/^[01]{1,32}$/.test(text)) return null;
  const value = parseInt(text, 2) >>> 0;
  if (value === 0xFFFFFFFF) return [];
  if (value === 0) return [{ scale, startDegrees: -360, endDegrees: 0 }];
  const bit = (i: number) => ((value >>> (((i % 32) + 32) % 32)) & 1) === 1;
  let firstGap = 0;
  for (let i = 0; i < 32; i++) if (!bit(i) && bit(i - 1)) { firstGap = i; break; }
  const gaps: CircleGap[] = [];
  let lastGapStart = firstGap;
  for (let i = firstGap; i < firstGap + 32; i++) {
    if (bit(i) && !bit(i - 1)) gaps.push({ scale, startDegrees: lastGapStart * 360 / 32, endDegrees: i * 360 / 32 });
    else if (!bit(i) && bit(i - 1)) lastGapStart = i;
  }
  return gaps;
}

/** Gamla bitarna ur nya avbrott (CircleGap.ComputeApproximateOldStyleGaps i Purple Pen, BSD). */
export function encodeOldCircleGaps(gaps: readonly CircleGap[]): string {
  let bits = 0xFFFFFFFF;
  for (const gap of gaps) {
    for (let bit = 0; bit < 32; bit++) {
      const angle = (bit + 0.5) * 360 / 32;
      const inside = (angle >= gap.startDegrees && angle <= gap.endDegrees)
        || (angle - 360 >= gap.startDegrees && angle - 360 <= gap.endDegrees);
      if (inside) bits &= ~(1 << bit);
    }
  }
  return (bits >>> 0).toString(2).padStart(32, "0");
}

export function legKey(from: string, to: string): string {
  return `${from}-${to}`;
}

export function toRaw(element: XmlElement): RawXml {
  return { xml: serializeXml(element) };
}

export function fromRaw(raw: RawXml): XmlElement {
  return parseXml(raw.xml).root;
}

export function rawName(raw: RawXml): string {
  return /^<([^\s/>]+)/.exec(raw.xml)?.[1] ?? "";
}

/** Ett attribut ur ett rått element (t.ex. `all-controls` print-scale ur händelsens `raw`). */
export function rawAttribute(raws: readonly RawXml[] | undefined, element: string, attribute: string): string | undefined {
  for (const raw of raws ?? []) {
    if (rawName(raw) !== element) continue;
    const found = fromRaw(raw).attrs.find(([name]) => name === attribute);
    if (found) return found[1];
  }
  return undefined;
}

/** Elementet utan de attribut som lästs; `null` om inget återstår (och elementet inte behöver finnas kvar). */
export function stub(element: XmlElement, used: readonly string[], keepEmpty = false, dropContent = false): RawXml | null {
  const attrs = element.attrs.filter(([name]) => !used.includes(name));
  const children = dropContent ? [] : element.children;
  if (!keepEmpty && attrs.length === 0 && children.length === 0) return null;
  return toRaw(el(element.name, attrs, children));
}

/** Nästa lediga heltal som id, som Purple Pens ObjectStore. */
export function nextId(ids: Iterable<string>): string {
  let max = 0;
  for (const id of ids) {
    const value = Number(id);
    if (Number.isInteger(value) && value > max) max = value;
  }
  return String(max + 1);
}

export type MutableDocument = { -readonly [K in keyof CourseSettingDocument]: CourseSettingDocument[K] };
