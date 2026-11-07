/**
 * ADR-0219: rå genomgång av en Mapper-fils `<parts>` för skrivaren och kontrollen. Till skillnad från läsaren tas alla
 * `<object>`-element med (även dem läsaren hoppar över), så att ordningstalen och antalen stämmer med filen.
 */
import { findTag } from "../omap/read";

/** Ett `<object …>…</object>` som teckenintervall [start, end) i texten. */
export interface RawElement { readonly start: number; readonly end: number }

export interface RawPart {
  /** `<objects …>` (start, tecknet efter `>`), eller null om delen saknar elementet. */
  readonly objectsTag: { readonly start: number; readonly end: number; readonly selfClosing: boolean } | null;
  /** Var `</objects>` börjar (samma som `objectsTag.end` när taggen är självstängande). */
  readonly objectsClose: number;
  readonly elements: readonly RawElement[];
}

export interface RawParts {
  /** `<parts` och tecknet efter `</parts>`. */
  readonly start: number;
  readonly end: number;
  /** Delen som Mapper hade vald (`current`), förval 0. */
  readonly current: number;
  readonly parts: readonly RawPart[];
}

export class ScanError extends Error {}

/** Elementets slut (tecknet efter `>` eller `</name>`), eller -1. */
export function elementEnd(content: string, open: number, name: string, limit = content.length): number {
  const tagEnd = content.indexOf(">", open);
  if (tagEnd < 0 || tagEnd >= limit) return -1;
  if (content.charCodeAt(tagEnd - 1) === 47) return tagEnd + 1;
  const close = content.indexOf(`</${name}>`, tagEnd);
  return close < 0 || close + name.length + 3 > limit ? -1 : close + name.length + 3;
}

export function scanParts(content: string): RawParts | null {
  const start = findTag(content, "<parts", 0);
  if (start < 0) return null;
  const close = content.indexOf("</parts>", start);
  if (close < 0) throw new ScanError("Mapper-filen är avkortad (objekten tar slut mitt i).");
  const end = close + "</parts>".length;
  const head = content.slice(start, content.indexOf(">", start) + 1);
  const current = Number(/\scurrent="(\d+)"/.exec(head)?.[1] ?? "0");
  const parts: RawPart[] = [];
  const partStarts: number[] = [];
  for (let at = findTag(content, "<part", start); at >= 0 && at < close; at = findTag(content, "<part", at + 5)) partStarts.push(at);
  partStarts.forEach((partStart, index) => {
    const partLimit = index + 1 < partStarts.length ? partStarts[index + 1]! : close;
    const open = findTag(content, "<objects", partStart);
    if (open < 0 || open >= partLimit) { parts.push({ objectsTag: null, objectsClose: -1, elements: [] }); return; }
    const tagEnd = content.indexOf(">", open);
    if (tagEnd < 0 || tagEnd >= partLimit) throw new ScanError("Mapper-filen är avkortad i en kartdel.");
    const selfClosing = content.charCodeAt(tagEnd - 1) === 47;
    const objectsClose = selfClosing ? tagEnd + 1 : content.indexOf("</objects>", tagEnd);
    if (objectsClose < 0 || objectsClose > partLimit) throw new ScanError("Mapper-filen är avkortad i en kartdel.");
    const elements: RawElement[] = [];
    if (!selfClosing) {
      for (let at = findTag(content, "<object", tagEnd); at >= 0 && at < objectsClose;) {
        const elementStop = elementEnd(content, at, "object", objectsClose);
        if (elementStop < 0) throw new ScanError("Mapper-filen är avkortad mitt i ett objekt.");
        elements.push({ start: at, end: elementStop });
        at = findTag(content, "<object", elementStop);
      }
    }
    parts.push({ objectsTag: { start: open, end: tagEnd + 1, selfClosing }, objectsClose, elements });
  });
  return { start, end, current: Number.isInteger(current) ? current : 0, parts };
}

/** `<undo>` och `<redo>` med innehåll utanför `<parts>`: intervallen att ta bort (med radbrytningen före, om de står på egen rad). */
export function historyRanges(content: string, parts: RawParts | null): RawElement[] {
  const ranges: RawElement[] = [];
  for (const name of ["undo", "redo"] as const) {
    for (let at = findTag(content, `<${name}`, 0); at >= 0; at = findTag(content, `<${name}`, at + 1)) {
      if (parts && at >= parts.start && at < parts.end) continue;
      const stop = elementEnd(content, at, name);
      if (stop < 0) throw new ScanError(`Mapper-filens <${name}> är avkortad.`);
      const empty = content.charCodeAt(content.indexOf(">", at) - 1) === 47 || /^<[^>]*>\s*<\/\w+>$/.test(content.slice(at, stop));
      if (!empty) ranges.push({ start: lineStart(content, at), end: stop });
      at = stop - 1;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** Början av elementets rad (radbrytningen och indraget före) när bara blanktecken står före det på raden, annars `at`. */
export function lineStart(content: string, at: number): number {
  let i = at;
  while (i > 0 && (content.charCodeAt(i - 1) === 32 || content.charCodeAt(i - 1) === 9)) i--;
  if (i > 0 && content.charCodeAt(i - 1) === 10) {
    i--;
    if (i > 0 && content.charCodeAt(i - 1) === 13) i--;
    return i;
  }
  return at;
}

/** Blanktecknen direkt före elementet (t.ex. "\n  "), för att lägga nya objekt på samma sätt. */
export function leadingWhitespace(content: string, at: number): string {
  let i = at;
  while (i > 0 && /\s/.test(content[i - 1]!)) i--;
  return content.slice(i, at);
}
