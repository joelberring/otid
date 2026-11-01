import type { DescriptionLayout, DescriptionPrimitive, DescriptionSymbol, SymbolShape } from "@o-tid/course-setting";

/**
 * Steg 63 (ADR-0180): kontrollbeskrivningen som SVG. `layoutDescription` ger figurer i mm med y nedåt; symbolernas figurer
 * (`descriptionSymbols`) ligger i en ruta på 200 × 200 enheter med (0,0) i mitten och y uppåt. Här räknas allt om till
 * papperets mm direkt (ingen transform), så att linjebredderna blir rätt i alla visare och samma noder ritas i editorn,
 * på utskriftssidan och i den nedladdade SVG-filen. Allt är rent svart.
 */
export type SvgNode =
  | { readonly tag: "path"; readonly d: string; readonly fill: boolean; readonly strokeWidth?: number | undefined }
  | { readonly tag: "line"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly strokeWidth: number }
  | { readonly tag: "circle"; readonly cx: number; readonly cy: number; readonly r: number; readonly fill: boolean; readonly strokeWidth?: number | undefined }
  | { readonly tag: "text"; readonly x: number; readonly y: number; readonly text: string; readonly size: number; readonly bold: boolean;
      readonly anchor: "start" | "middle" | "end"; readonly textLength?: number | undefined }
  /** En symbol: figurerna i papperets mm. `symbol` och `ref` blir data-attribut (för tester och markering). */
  | { readonly tag: "symbol"; readonly symbol: string; readonly ref?: string | undefined; readonly children: readonly SvgNode[] };

export type SymbolLookup = ReadonlyMap<string, DescriptionSymbol>;

export const DESCRIPTION_FONT = "Arial, Helvetica, sans-serif";
/** Ungefärlig medelbredd för ett tecken i Arial, i fontstorlekar (för att krympa text som inte får plats). */
const CHARACTER_WIDTH = 0.56;

/** Tre decimaler räcker (tusendels mm) och håller SVG-filen liten. */
export const mm = (value: number) => Math.round(value * 1000) / 1000;

export function symbolLookup(symbols: readonly DescriptionSymbol[]): SymbolLookup {
  return new Map(symbols.map(symbol => [symbol.id, symbol]));
}

/** En punkt i symbolens ruta (200 × 200, y uppåt, (0,0) i mitten) till papperets mm (y nedåt) med rutans mitt i `center`. */
export function symbolPoint(point: { x: number; y: number }, center: { x: number; y: number }, size: number): { x: number; y: number } {
  const unit = size / 200;
  return { x: mm(center.x + point.x * unit), y: mm(center.y - point.y * unit) };
}

function pointList(points: readonly { x: number; y: number }[], center: { x: number; y: number }, size: number): string {
  return points.map((point, index) => {
    const at = symbolPoint(point, center, size);
    return `${index === 0 ? "M" : "L"}${at.x} ${at.y}`;
  }).join(" ");
}

/** Bezierkurvan som i symbols.xml: startpunkt och sedan tre punkter per kurva (två styrpunkter och slutpunkten). */
function bezierPath(points: readonly { x: number; y: number }[], center: { x: number; y: number }, size: number): string {
  if (points.length === 0) return "";
  const at = points.map(point => symbolPoint(point, center, size));
  const parts = [`M${at[0]!.x} ${at[0]!.y}`];
  for (let index = 1; index + 2 < at.length; index += 3) {
    const [first, second, end] = [at[index]!, at[index + 1]!, at[index + 2]!];
    parts.push(`C${first.x} ${first.y} ${second.x} ${second.y} ${end.x} ${end.y}`);
  }
  return parts.join(" ");
}

/** Symbolens figurer som noder, med rutans mitt i `center` och rutans sida `size` mm. */
export function symbolNodes(shapes: readonly SymbolShape[], center: { x: number; y: number }, size: number): SvgNode[] {
  const unit = size / 200;
  return shapes.map((shape): SvgNode => {
    switch (shape.kind) {
      case "polyline": return { tag: "path", d: `${pointList(shape.points, center, size)}${shape.closed ? " Z" : ""}`, fill: false, strokeWidth: mm(shape.width * unit) };
      case "polygon": return { tag: "path", d: `${pointList(shape.points, center, size)} Z`, fill: true };
      case "circle": {
        const at = symbolPoint(shape.center, center, size);
        return { tag: "circle", cx: at.x, cy: at.y, r: mm(shape.radius * unit), fill: false, strokeWidth: mm(shape.width * unit) };
      }
      case "disc": {
        const at = symbolPoint(shape.center, center, size);
        return { tag: "circle", cx: at.x, cy: at.y, r: mm(shape.radius * unit), fill: true };
      }
      case "bezier": return shape.filled ? { tag: "path", d: `${bezierPath(shape.points, center, size)} Z`, fill: true }
        : { tag: "path", d: bezierPath(shape.points, center, size), fill: false, strokeWidth: mm(shape.width * unit) };
    }
  });
}

const ANCHOR = { left: "start", center: "middle", right: "end" } as const;

/** Texten krymps (tecknen pressas ihop) bara när en uppskattning säger att den inte får plats i `maxWidth`. */
export function textNode(primitive: Extract<DescriptionPrimitive, { kind: "text" }>): SvgNode {
  const estimate = primitive.text.length * primitive.heightMm * CHARACTER_WIDTH * (primitive.bold ? 1.08 : 1);
  return { tag: "text", x: mm(primitive.at.x), y: mm(primitive.at.y), text: primitive.text, size: mm(primitive.heightMm), bold: primitive.bold === true,
    anchor: ANCHOR[primitive.align], ...(primitive.maxWidth !== undefined && estimate > primitive.maxWidth ? { textLength: mm(primitive.maxWidth) } : {}) };
}

/**
 * Beskrivningens figurer som noder. En symbol som inte finns (fel standard, okänt id) ritas som sitt id i rutan, så att
 * banläggaren ser att något står där. Markerbara ytor (`hit`) ritas inte.
 */
export function descriptionNodes(layout: DescriptionLayout, symbols: SymbolLookup): SvgNode[] {
  const nodes: SvgNode[] = [];
  for (const primitive of layout.primitives) {
    switch (primitive.kind) {
      case "line":
        nodes.push({ tag: "line", x1: mm(primitive.from.x), y1: mm(primitive.from.y), x2: mm(primitive.to.x), y2: mm(primitive.to.y), strokeWidth: mm(primitive.width) });
        break;
      case "text": nodes.push(textNode(primitive)); break;
      case "symbol": {
        const symbol = symbols.get(primitive.symbol);
        const children = symbol ? symbolNodes(symbol.shapes, primitive.at, primitive.size)
          : [{ tag: "text" as const, x: mm(primitive.at.x), y: mm(primitive.at.y), text: primitive.symbol, size: mm(primitive.size * 0.35), bold: false, anchor: "middle" as const }];
        nodes.push({ tag: "symbol", symbol: primitive.symbol, ref: primitive.ref, children });
        break;
      }
      case "hit": break;
    }
  }
  return nodes;
}

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function nodeXml(node: SvgNode): string {
  switch (node.tag) {
    case "path": return node.fill ? `<path d="${node.d}" fill="#000"/>`
      : `<path d="${node.d}" fill="none" stroke="#000" stroke-width="${node.strokeWidth ?? 0}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "line": return `<line x1="${node.x1}" y1="${node.y1}" x2="${node.x2}" y2="${node.y2}" stroke="#000" stroke-width="${node.strokeWidth}"/>`;
    case "circle": return node.fill ? `<circle cx="${node.cx}" cy="${node.cy}" r="${node.r}" fill="#000"/>`
      : `<circle cx="${node.cx}" cy="${node.cy}" r="${node.r}" fill="none" stroke="#000" stroke-width="${node.strokeWidth ?? 0}"/>`;
    case "text": return `<text x="${node.x}" y="${node.y}" font-size="${node.size}"${node.bold ? ` font-weight="bold"` : ""} text-anchor="${node.anchor}"`
      + ` dominant-baseline="central"${node.textLength !== undefined ? ` textLength="${node.textLength}" lengthAdjust="spacingAndGlyphs"` : ""}>${escape(node.text)}</text>`;
    case "symbol": return `<g data-symbol="${escape(node.symbol)}">${node.children.map(nodeXml).join("")}</g>`;
  }
}

/** Noderna som SVG-element (utan omgivande `<svg>`), t.ex. inuti en sidas `<g transform>`. */
export function nodesXml(nodes: readonly SvgNode[]): string {
  return nodes.map(nodeXml).join("");
}

/** En fristående SVG-fil i verklig storlek (mm), att ladda ned eller skriva ut. */
export function descriptionSvg(layout: DescriptionLayout, symbols: SymbolLookup, title?: string): string {
  const width = mm(layout.widthMm), height = mm(layout.heightMm);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"`
    + ` font-family="${DESCRIPTION_FONT}">${title ? `<title>${escape(title)}</title>` : ""}<rect width="${width}" height="${height}" fill="#fff"/>`
    + `${nodesXml(descriptionNodes(layout, symbols))}</svg>\n`;
}
