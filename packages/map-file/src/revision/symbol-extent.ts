/**
 * ADR-0207: hur långt en symbol ritas utanför objektets koordinater (mm), för OCAD-indexets omslutande ruta när ingen
 * annan post med samma symbol finns att jämföra med. Hellre för stort än för litet: rutan används för att välja vad som
 * ritas om.
 */
import type { MapSymbol, Path, PointElement, StrokeStyle } from "../model";

const pathRadius = (path: Path) => path.reduce((max, command) => Math.max(
  max, Math.hypot(command.x, command.y), command.type === "C" ? Math.max(Math.hypot(command.x1, command.y1), Math.hypot(command.x2, command.y2)) : 0
), 0);

function elementRadius(element: PointElement): number {
  switch (element.kind) {
    case "circle": return Math.hypot(element.center.x, element.center.y) + element.diameter / 2 + element.lineWidth / 2;
    case "dot": return Math.hypot(element.center.x, element.center.y) + element.diameter / 2;
    case "line": return pathRadius(element.path) + element.width / 2;
    case "area": return element.rings.reduce((max, ring) => Math.max(max, pathRadius(ring)), 0);
  }
}

const elementsRadius = (elements: readonly PointElement[] | undefined) => (elements ?? []).reduce((max, element) => Math.max(max, elementRadius(element)), 0);
const strokesExtent = (strokes: readonly StrokeStyle[] | undefined) => (strokes ?? []).reduce((max, stroke) => Math.max(max, stroke.width / 2 + Math.abs(stroke.offset ?? 0)), 0);

export function symbolExtent(symbol: MapSymbol | undefined): number {
  if (!symbol) return 0;
  switch (symbol.kind) {
    case "POINT": return elementsRadius(symbol.elements);
    case "LINE": return Math.max(
      strokesExtent(symbol.strokes), elementsRadius(symbol.repeated?.elements), elementsRadius(symbol.between?.elements),
      elementsRadius(symbol.corner?.elements) * (symbol.corner?.stretch ? 3 : 1), elementsRadius(symbol.start?.elements), elementsRadius(symbol.end?.elements)
    );
    case "AREA": return strokesExtent(symbol.border);
    case "TEXT":
    case "COMBINED": return 0;
  }
}

/** Symbolens första färg (för OCAD-indexets färgfält när ingen annan post med symbolen finns). */
export function symbolFirstColor(symbol: MapSymbol | undefined): number {
  if (!symbol) return 0;
  switch (symbol.kind) {
    case "POINT": return symbol.elements[0]?.color ?? 0;
    case "LINE": return symbol.strokes[0]?.color ?? symbol.repeated?.elements[0]?.color ?? symbol.corner?.elements[0]?.color ?? 0;
    case "AREA": return symbol.fill ?? symbol.hatches[0]?.color ?? symbol.pattern?.elements[0]?.color ?? symbol.border?.[0]?.color ?? 0;
    case "TEXT": return symbol.color;
    case "COMBINED": return 0;
  }
}
