import {
  BUILT_IN_PRINT_PROFILES, gridTemplate, mapColorAdjust, type Cmyk100, type MapColorAdjust, type MapColorSetting, type PaperName, type PrintProfile, type SheetLayout
} from "@o-tid/course-setting";
import type { MapColor } from "@o-tid/map-file";

/** Steg 64 (ADR-0183): hjälpfunktionerna för utskriftsprofilen och layoutmallen på utskriftssidan. */

const MAX_PROFILE_ID = 64;

/** "35/95/0/0" som CMYK 0–100, annars undefined. */
export function parseCmyk(value: string): Cmyk100 | undefined {
  const parts = value.split(/[/,; ]+/).filter(Boolean).map(Number);
  if (parts.length !== 4 || !parts.every(part => Number.isFinite(part) && part >= 0 && part <= 100)) return undefined;
  return { c: parts[0]!, m: parts[1]!, y: parts[2]!, k: parts[3]! };
}

/** Raden för en kartfärg (OCAD-id) i profilen, eller undefined. */
export const rowFor = (profile: PrintProfile, id: number) => profile.mapColors.find(row => row.match.ocadIds?.length === 1 && row.match.ocadIds[0] === id);

/** Justeringen från profilens övriga rader (utan färgens egen OCAD-id-rad), t.ex. mönsterregler i kontorsprofilen. */
export function fallbackColorAdjust(profile: PrintProfile, color: Pick<MapColor, "id" | "name">): MapColorAdjust | undefined {
  const withoutOwn = { ...profile, mapColors: profile.mapColors.filter(row => !(row.match.ocadIds?.length === 1 && row.match.ocadIds[0] === color.id)) };
  return mapColorAdjust(withoutOwn, [color])[color.id];
}

/**
 * Profilen med raden för kartfärgen ändrad (egna rader per färg före mönsterraderna).
 * Behåller explicit `lighten: 0` (upphäver mönsterregel) och `spot: null` (stänger av filens dekorfärg),
 * och tar bort hela raden (inga tomma zombierader) när alla override-fält är återställda.
 */
export function withColorRow(profile: PrintProfile, id: number, change: Partial<Omit<MapColorSetting, "match">> | null): PrintProfile {
  const others = profile.mapColors.filter(row => !(row.match.ocadIds?.length === 1 && row.match.ocadIds[0] === id));
  if (change === null) return { ...profile, mapColors: others };
  const current = rowFor(profile, id) ?? { match: { ocadIds: [id] } };
  const merged = { ...current, ...change };
  const next = Object.fromEntries(Object.entries(merged).filter(([key, value]) => {
    if (value === undefined) return false;
    if (key === "hidden" && value === false) return false;
    return true;
  })) as unknown as MapColorSetting;
  if (Object.keys(next).length <= 1) return { ...profile, mapColors: others };
  return { ...profile, mapColors: [next, ...others] };
}

/** Ett unikt profil-id (högst 64 tecken) som inte krockar med inbyggda eller befintliga profiler. */
export function uniqueProfileId(stem: string, existingIds: ReadonlySet<string>, now = Date.now()): string {
  const clean = (stem.trim() || "egen").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "egen";
  const suffix = `-${now}`;
  const base = `${clean.slice(0, Math.max(1, MAX_PROFILE_ID - suffix.length))}${suffix}`;
  if (!existingIds.has(base)) return base;
  for (let n = 2; n < 10_000; n += 1) {
    const extra = `-${n}`;
    const candidate = `${base.slice(0, Math.max(1, MAX_PROFILE_ID - extra.length))}${extra}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `egen-${now}`.slice(0, MAX_PROFILE_ID);
}

/** Gör en JSON-importerad profil sparningsbar: inbyggda eller för långa id:n får ett nytt unikt id (≤ 64 tecken). */
export function prepareImportedProfile(profile: PrintProfile, existingIds: ReadonlySet<string>,
  builtIn: readonly PrintProfile[] = BUILT_IN_PRINT_PROFILES, now = Date.now()): PrintProfile {
  const isBuiltIn = builtIn.some(item => item.id === profile.id);
  if (!isBuiltIn && profile.id.length <= MAX_PROFILE_ID) return profile;
  const taken = new Set([...existingIds, ...builtIn.map(item => item.id)]);
  const id = uniqueProfileId(isBuiltIn ? `${profile.id}-import` : profile.id, taken, now);
  return { ...profile, id, ...(isBuiltIn ? { basedOn: profile.basedOn ?? profile.id } : {}) };
}

/**
 * Serialiserar snabba ändringar i utskriftsprofilen mot det senaste lokala utkastet så att två snabba klick
 * i `ColorTable` aldrig skriver över varandra eller skapar dubbletter av `egen-*`-profiler.
 */
export class ProfileDraftTracker {
  private draft: PrintProfile;
  private prop: PrintProfile;
  private pending = 0;

  constructor(initial: PrintProfile) {
    this.draft = initial;
    this.prop = initial;
  }

  sync(profile: PrintProfile): boolean {
    if (this.prop === profile) return false;
    this.prop = profile;
    if (this.pending === 0) {
      this.draft = profile;
      return true;
    }
    return false;
  }

  isIdle(): boolean { return this.pending === 0; }

  begin(existingIds: ReadonlySet<string>, next: (current: PrintProfile) => PrintProfile,
    copyOf: (current: PrintProfile, existingIds: ReadonlySet<string>) => PrintProfile): PrintProfile {
    const ids = new Set([...existingIds, this.draft.id]);
    const copy = next(copyOf(this.draft, ids));
    this.draft = copy;
    this.pending += 1;
    return copy;
  }

  finish(ok: boolean): { reverted: boolean } {
    const wasLast = this.pending <= 1;
    this.pending = Math.max(0, this.pending - 1);
    if (!ok && wasLast) {
      this.draft = this.prop;
      return { reverted: true };
    }
    return { reverted: false };
  }

  reset(profile = this.prop): void {
    if (this.pending === 0) this.draft = profile;
  }
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
