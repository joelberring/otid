import {
  acceptSuggestion, courseControlOrder, lacksFeature, suggestOptionsFor, type CourseSettingDocument, type CourseSettingEdit, type DescriptionSuggestion,
  type SuggestOptions
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import type { SymbolLookup } from "./course-setting-description-draw";
import { ALL_CONTROLS } from "./course-setting-hit";
import type { SuggestPoint, SuggestionsByControl } from "./course-setting-map-protocol";

/**
 * ADR-0180 beslut 12: förslag på kontrollbeskrivning i editorn. Kartans Worker räknar förslagen (`suggestAt`) för vald
 * kontroll och för kontrollerna i vyn som saknar detalj (kolumn D). Inget skrivs in förrän någon godtar: då blir det en
 * vanlig `SET_DESCRIPTION`, så att ångra, sparandet och samarbetet fungerar som för en ruta som väljs för hand.
 */

/** Väntetid efter senaste ändringen innan förslagen räknas om (en dragning ger många ändringar). */
export const SUGGEST_DELAY_MS = 300;

/** Vanliga kontroller i vyn (banan eller alla kontroller). */
export function controlsInView(document: CourseSettingDocument, view: string, variant: string | undefined): string[] {
  if (view === ALL_CONTROLS) return Object.values(document.controls).filter(control => control.kind === "NORMAL").map(control => control.id);
  let order: readonly string[] = [];
  try { order = courseControlOrder(document, view, variant); } catch { order = []; }
  const ids = order.map(id => document.courseControls[id]?.control).filter((id): id is string => id !== undefined);
  return [...new Set(ids)].filter(id => document.controls[id]?.kind === "NORMAL");
}

/** Kontrollerna att räkna förslag för: vald kontroll och vyns kontroller utan detalj. */
export function suggestTargets(document: CourseSettingDocument, view: string, variant: string | undefined, selected: string | undefined): SuggestPoint[] {
  const ids = new Set(controlsInView(document, view, variant).filter(id => lacksFeature(document.controls[id]!.descriptions)));
  if (selected && document.controls[selected]?.kind === "NORMAL") ids.add(selected);
  return [...ids].sort().map(id => ({ id, at: document.controls[id]!.at }));
}

/** Nyckeln som ändras när en punkt eller kartans inställningar ändras (då räknas förslagen om). */
export function suggestKey(points: readonly SuggestPoint[], options: SuggestOptions): string {
  return JSON.stringify([options, points.map(point => [point.id, Math.round(point.at.x * 100), Math.round(point.at.y * 100)])]);
}

export function optionsFor(document: CourseSettingDocument): SuggestOptions {
  return suggestOptionsFor(document);
}

/** Förslagen som gäller nu: bara för punkter som inte flyttats sedan de räknades. */
export function currentSuggestions(result: { readonly points: readonly SuggestPoint[]; readonly suggestions: SuggestionsByControl } | undefined,
  document: CourseSettingDocument): SuggestionsByControl {
  if (!result) return {};
  const out: Record<string, readonly DescriptionSuggestion[]> = {};
  for (const point of result.points) {
    const now = document.controls[point.id]?.at;
    const list = result.suggestions[point.id];
    if (now && list && Math.abs(now.x - point.at.x) < 0.005 && Math.abs(now.y - point.at.y) < 0.005) out[point.id] = list;
  }
  return out;
}

/** Ändringen när ett förslag godtas för en kontroll (C, D, E, G och korsningen i F ersätts; mått och H står kvar). */
export function acceptEdit(document: CourseSettingDocument, control: string, suggestion: DescriptionSuggestion): CourseSettingEdit | undefined {
  const point = document.controls[control];
  return point ? { type: "SET_DESCRIPTION", control, boxes: acceptSuggestion(point.descriptions, suggestion) } : undefined;
}

/** "Godta alla tomma": bästa förslaget för varje kontroll i vyn som saknar detalj. */
export function acceptEmptyEdits(document: CourseSettingDocument, view: string, variant: string | undefined,
  suggestions: SuggestionsByControl): CourseSettingEdit[] {
  return controlsInView(document, view, variant).flatMap(id => {
    const best = suggestions[id]?.[0];
    if (!best || !lacksFeature(document.controls[id]!.descriptions)) return [];
    const edit = acceptEdit(document, id, best);
    return edit ? [edit] : [];
  });
}

/**
 * Beskrivningen med förslagen som förhandsvisning: kontroller utan detalj får bästa förslaget i ett dokument som bara
 * ritas (sparas aldrig). `preview` är kontrollerna som visar ett förslag.
 */
export function previewDocument(document: CourseSettingDocument, suggestions: SuggestionsByControl):
  { readonly document: CourseSettingDocument; readonly preview: ReadonlySet<string> } {
  const preview = new Set<string>();
  const controls = { ...document.controls };
  for (const [id, list] of Object.entries(suggestions)) {
    const control = controls[id];
    const best = list[0];
    if (!control || !best || !lacksFeature(control.descriptions)) continue;
    controls[id] = { ...control, descriptions: acceptSuggestion(control.descriptions, best) };
    preview.add(id);
  }
  return preview.size === 0 ? { document, preview } : { document: { ...document, controls }, preview };
}

/** Kort text för fältläget: "sten, norra sidan" (detaljen och läget med symbolernas svenska namn). */
export function shortText(suggestion: DescriptionSuggestion, symbols: SymbolLookup): string {
  const name = (box: string) => {
    const ref = suggestion.boxes.find(row => row.box === box)?.ref;
    const symbol = ref ? symbols.get(ref) : undefined;
    return symbol ? (symbol.names.sv ?? symbol.names.en ?? ref) : undefined;
  };
  const parts = [name("C"), name("D"), name("E"), name("F"), name("G")].filter((part): part is string => Boolean(part)).map(part => part.toLowerCase());
  return parts.length > 0 ? parts.join(", ") : "";
}

/** Objekten för markeringen på kartan när man pekar på ett förslag. */
export function highlightShapes(suggestion: DescriptionSuggestion | undefined): readonly (readonly Point[])[] {
  return suggestion ? suggestion.features.flatMap(feature => feature.shape) : [];
}

/**
 * Markeringen på kartan: linjer och punkter i kartans mm, ritade med `at` (kartans mm → skärmens px). Gul kant med
 * mörk mitt, så att den syns på alla kartfärger och inte förväxlas med banan (lila) eller vägvalen.
 */
export function drawSuggestionHighlight(ctx: CanvasRenderingContext2D, at: (point: Point) => { x: number; y: number },
  shapes: readonly (readonly Point[])[], pxPerMm: number): void {
  if (shapes.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [width, color] of [[Math.max(7, 0.9 * pxPerMm), "rgba(255, 196, 0, 0.85)"], [Math.max(2.5, 0.3 * pxPerMm), "#1a1a1a"]] as const) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    for (const shape of shapes) {
      if (shape.length === 1) {
        const p = at(shape[0]!);
        ctx.beginPath();
        ctx.arc(p.x, p.y, width * 0.9, 0, Math.PI * 2);
        if (color === "#1a1a1a") ctx.stroke(); else ctx.fill();
        continue;
      }
      ctx.beginPath();
      shape.forEach((point, index) => {
        const p = at(point);
        if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }
  }
  ctx.restore();
}
