import {
  applyEdit, emptyDocument, figureBounds, layoutOverprint, type CourseSettingDocument, type CourseSettingEdit, type MapRect, type OverprintPrimitive,
  type SpecialKind
} from "@o-tid/course-setting";
import type { Tool } from "./course-setting-editor";
import { ALL_CONTROLS } from "./course-setting-hit";
import { specialInput } from "./course-setting-specials";

/**
 * ADR-0180 beslut 14: paletten med objekt. Varje slag har en ikon som räknas fram med paketets banpåtryck
 * (`layoutOverprint`) på ett litet dokument med bara det objektet, och ritas med kartans ritare (`drawOverprint`), så
 * att ikonen ser ut som objektet gör på kartan. Obligatorisk passage och kartbyte är kontroller på banan (verktyg),
 * resten är Purple Pens specialobjekt. Kontrollbeskrivningen är inget kartobjekt: den placeras på papperet i utskriften.
 */
export type PaletteItem =
  | { readonly kind: "tool"; readonly tool: Extract<Tool, "ADD_CROSSING" | "ADD_MAP_EXCHANGE"> }
  | { readonly kind: "special"; readonly special: SpecialKind };

export type PaletteGroup = "passages" | "barriers" | "service" | "graphics";

export const PALETTE: readonly { readonly group: PaletteGroup; readonly items: readonly PaletteItem[] }[] = [
  { group: "passages", items: [{ kind: "tool", tool: "ADD_CROSSING" }, { kind: "special", special: "optional-crossing-point" },
    { kind: "tool", tool: "ADD_MAP_EXCHANGE" }] },
  { group: "barriers", items: (["out-of-bounds", "forbidden-route", "boundary", "dangerous-area", "temporary-construction"] as const)
    .map(special => ({ kind: "special", special })) },
  { group: "service", items: (["water", "first-aid"] as const).map(special => ({ kind: "special", special })) },
  { group: "graphics", items: (["text", "image", "line", "rectangle", "ellipse", "white-out", "registration-mark"] as const)
    .map(special => ({ kind: "special", special })) }
];

export const paletteKey = (item: PaletteItem) => item.kind === "tool" ? item.tool : item.special;

/** Ikonens figurer (kartans mm) och ytan de ska passas in i. */
export interface PaletteIcon {
  readonly primitives: readonly OverprintPrimitive[];
  readonly bounds: MapRect;
}

const AREA = [{ x: -4, y: -3 }, { x: 4, y: -3.5 }, { x: 3.5, y: 3.5 }, { x: -3.5, y: 3 }];

/** Punkterna för ikonens objekt (kartans mm vid 1:10 000, ungefär lika stora som på kartan). */
function iconPoints(kind: SpecialKind) {
  switch (kind) {
    case "boundary": case "line": return [{ x: -5, y: -2 }, { x: 0, y: 1.5 }, { x: 5, y: -1 }];
    case "forbidden-route": case "water": case "first-aid": case "optional-crossing-point": case "registration-mark": return [{ x: 0, y: 0 }];
    case "rectangle": case "ellipse": case "image": return [{ x: -4, y: 3 }, { x: 4, y: -3 }];
    default: return AREA;
  }
}

let cache: Map<string, PaletteIcon> | undefined;

function compute(item: PaletteItem): PaletteIcon {
  let document: CourseSettingDocument = emptyDocument({ title: "", mapScale: 10000 });
  let edit: CourseSettingEdit;
  if (item.kind === "tool") {
    edit = { type: "ADD_CONTROL", kind: item.tool === "ADD_CROSSING" ? "CROSSING_POINT" : "MAP_EXCHANGE", at: { x: 0, y: 0 } };
  } else if (item.special === "image") {
    // En bild utan data: ram och ett berg, ritade som figurer.
    const frame: OverprintPrimitive = { kind: "polyline", role: "SPECIAL", color: "BLACK", width: 0.35, closed: true,
      points: [{ x: -4, y: 3 }, { x: 4, y: 3 }, { x: 4, y: -3 }, { x: -4, y: -3 }] };
    const hill: OverprintPrimitive = { kind: "polyline", role: "SPECIAL", color: "BLACK", width: 0.35,
      points: [{ x: -3, y: -2 }, { x: -1, y: 1 }, { x: 0.5, y: -0.5 }, { x: 1.5, y: 0.5 }, { x: 3, y: -2 }] };
    return { primitives: [frame, hill], bounds: { minX: -5, minY: -4, maxX: 5, maxY: 4 } };
  } else if (item.special === "text") {
    // Texten som Purple Pen ritar den (lila, Arial), mitt i rutan.
    return { primitives: [{ kind: "text", role: "SPECIAL", color: "COURSE", at: { x: 0, y: 0 }, text: "Aa", heightMm: 6, align: "center",
      font: { family: "Arial", bold: false, italic: false } }], bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 } };
  } else {
    edit = { type: "ADD_SPECIAL", special: specialInput(document, ALL_CONTROLS, item.special, iconPoints(item.special)) };
  }
  document = applyEdit(document, edit).document;
  const primitives = layoutOverprint(document, { course: ALL_CONTROLS });
  const box = figureBounds(primitives) ?? { minX: -5, minY: -5, maxX: 5, maxY: 5 };
  // Kvadratisk yta med lite luft, minst 8 mm (små symboler som vattnet blir inte jättestora).
  const side = Math.max(8, box.maxX - box.minX, box.maxY - box.minY) * 1.15;
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
  return { primitives, bounds: { minX: cx - side / 2, maxX: cx + side / 2, minY: cy - side / 2, maxY: cy + side / 2 } };
}

/** Ikonen för ett slag (räknas en gång). */
export function paletteIcon(item: PaletteItem): PaletteIcon {
  cache ??= new Map();
  const key = paletteKey(item);
  let icon = cache.get(key);
  if (!icon) {
    try { icon = compute(item); } catch (error) {
      console.error(`Ikonen för ${key} gick inte att rita`, error);
      icon = { primitives: [], bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 } };
    }
    cache.set(key, icon);
  }
  return icon;
}
