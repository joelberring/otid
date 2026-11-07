import { gridTemplate, type Cmyk100, type SheetLayout, type MapColorSetting, type PaperName, type PrintProfile } from "@o-tid/course-setting";

/** Steg 64 (ADR-0183): hjälpfunktionerna för utskriftsprofilen och layoutmallen på utskriftssidan. */

/** "35/95/0/0" som CMYK 0–100, annars undefined. */
export function parseCmyk(value: string): Cmyk100 | undefined {
  const parts = value.split(/[/,; ]+/).filter(Boolean).map(Number);
  if (parts.length !== 4 || !parts.every(part => Number.isFinite(part) && part >= 0 && part <= 100)) return undefined;
  return { c: parts[0]!, m: parts[1]!, y: parts[2]!, k: parts[3]! };
}

/** Raden för en kartfärg (OCAD-id) i profilen, eller undefined. */
export const rowFor = (profile: PrintProfile, id: number) => profile.mapColors.find(row => row.match.ocadIds?.length === 1 && row.match.ocadIds[0] === id);

/** Profilen med raden för kartfärgen ändrad (egna rader per färg före mönsterraderna). */
export function withColorRow(profile: PrintProfile, id: number, change: Partial<Omit<MapColorSetting, "match">> | null): PrintProfile {
  const others = profile.mapColors.filter(row => !(row.match.ocadIds?.length === 1 && row.match.ocadIds[0] === id));
  if (change === null) return { ...profile, mapColors: others };
  const current = rowFor(profile, id) ?? { match: { ocadIds: [id] } };
  const next = Object.fromEntries(Object.entries({ ...current, ...change }).filter(([, value]) => value !== undefined && value !== false && value !== 0)) as unknown as MapColorSetting;
  return { ...profile, mapColors: [next, ...others] };
}

/** Ramarnas rutnät ur mallen (rader och kolumner gissas ur ramarnas lägen). */
export function gridOf(template: SheetLayout): { rows: number; columns: number } {
  const rows = new Set(template.frames.map(frame => Math.round(frame.y))).size || 1;
  const columns = new Set(template.frames.map(frame => Math.round(frame.x))).size || 1;
  return { rows, columns };
}

/** Mallen med nytt papper eller rutnät; texter, logotyper och remsor står kvar, beskrivningen följer första ramen. */
export function regrid(template: SheetLayout, change: { paper?: PaperName; landscape?: boolean; marginMm?: number; rows?: number; columns?: number; gapMm?: number }): SheetLayout {
  const grid = gridOf(template);
  const paper = change.paper ?? (template.paper.name === "CUSTOM" ? "A4" : template.paper.name);
  // Rubriker per ram (de färdiga mallarna) läggs om med ramarna; övriga texter står kvar.
  const title = template.texts.some(text => text.frame !== undefined);
  const next = gridTemplate(template.id, template.name, paper, change.landscape ?? template.paper.landscape, change.rows ?? grid.rows, change.columns ?? grid.columns,
    { marginMm: change.marginMm ?? template.marginMm, title, ...(change.gapMm !== undefined ? { gapMm: change.gapMm } : {}) });
  const texts = title ? [...template.texts.filter(text => text.frame === undefined), ...next.texts] : template.texts;
  return { ...template, paper: next.paper, marginMm: next.marginMm, frames: next.frames, texts, cutMarks: next.frames.length > 1 ? template.cutMarks || next.cutMarks : template.cutMarks };
}
