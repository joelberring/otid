import { symbolsForBox, type CourseSettingDocument, type DescriptionBox, type DescriptionStandard } from "@o-tid/course-setting";
import type { MapPosition } from "./course-setting-geo";
import { setBox } from "./course-setting-description-picker";
import { toScreen, type Viewport } from "./course-setting-viewport";

/**
 * Fältläget, första versionen (ADR-0181 beslut 6–7): kontrollbeskrivningens F och G med stora knappar, osparade
 * ändringar i webbläsaren och positionen på kartan. Ren logik; komponenten finns i `course-setting-field.tsx`.
 */

/** Snabbknapparna för ruta F (höjd i meter, som Purple Pens mått). */
export const F_QUICK = ["0.5", "1", "1.5", "2", "3"] as const;

export type GChoice = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "FOOT" | "TOP";

/** Knapparna för ruta G med svenska etiketter, och IOF-symbolen (Purple Pens id) varje knapp ger. */
export const G_CHOICES: readonly { readonly choice: GChoice; readonly label: string; readonly ref: string }[] = [
  { choice: "N", label: "N", ref: "11.1N" }, { choice: "NE", label: "NO", ref: "11.1NE" },
  { choice: "E", label: "Ö", ref: "11.1E" }, { choice: "SE", label: "SO", ref: "11.1SE" },
  { choice: "S", label: "S", ref: "11.1S" }, { choice: "SW", label: "SV", ref: "11.1SW" },
  { choice: "W", label: "V", ref: "11.1W" }, { choice: "NW", label: "NV", ref: "11.1NW" },
  { choice: "FOOT", label: "Fot", ref: "11.13" }, { choice: "TOP", label: "Topp", ref: "11.11" }
];

/** Symbolens id för knappen, om den finns i beskrivningens standard (2004 eller 2018). */
export function gSymbolId(choice: GChoice, standard: DescriptionStandard): string | undefined {
  const ref = G_CHOICES.find(row => row.choice === choice)?.ref;
  if (!ref) return undefined;
  return symbolsForBox("G", standard).some(symbol => symbol.id === ref) ? ref : undefined;
}

/** Knappen som motsvarar rutan G:s symbol, om någon gör det. */
export const gChoiceOf = (ref: string | undefined): GChoice | undefined => G_CHOICES.find(row => row.ref === ref)?.choice;

/**
 * Rutorna med nytt F (text, tom = ingen) och G (symbolens id, null = ingen). Övriga rutor behålls. Ett F med komma
 * skrivs med punkt (som Purple Pen).
 */
export function withFieldDescription(boxes: readonly DescriptionBox[], f: string, g: string | null): DescriptionBox[] {
  const height = f.trim().replace(",", ".");
  const withF = setBox(boxes, "F", height ? { text: height } : null);
  return setBox(withF, "G", g ? { ref: g } : null);
}

// Osparade ändringar i webbläsaren (localStorage): skrivs vid varje ändring och tas bort när servern har sparat.

export interface UnsavedBackup {
  readonly formatVersion: 1;
  /** Versionen på servern som ändringarna bygger på. */
  readonly baseVersion: number;
  readonly savedAt: string;
  readonly document: CourseSettingDocument;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const backupKey = (raceId: string) => `otid:course-setting-unsaved:${raceId}`;

/** Webbläsarens localStorage, eller inget (privat fönster, blockerad lagring, servern). */
export function localStore(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}

export function readBackup(storage: Storage | undefined, raceId: string): UnsavedBackup | undefined {
  try {
    const raw = storage?.getItem(backupKey(raceId));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<UnsavedBackup>;
    if (value.formatVersion !== 1 || typeof value.baseVersion !== "number" || typeof value.savedAt !== "string" || !value.document
      || typeof value.document !== "object" || !Array.isArray(value.document.courses)) return undefined;
    return value as UnsavedBackup;
  } catch { return undefined; }
}

/** Sant om kopian skrevs (full lagring eller blockerad lagring ger falskt). */
export function writeBackup(storage: Storage | undefined, raceId: string, backup: Omit<UnsavedBackup, "formatVersion">): boolean {
  try {
    if (!storage) return false;
    storage.setItem(backupKey(raceId), JSON.stringify({ formatVersion: 1, ...backup } satisfies UnsavedBackup));
    return true;
  } catch { return false; }
}

export function clearBackup(storage: Storage | undefined, raceId: string): void {
  try { storage?.removeItem(backupKey(raceId)); } catch { /* blockerad lagring: inget att ta bort */ }
}

/** Positionen på kartan: noggrannhetscirkeln och en blå punkt med vit kant. */
export function drawPosition(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, view: Viewport, position: MapPosition) {
  const at = toScreen(view, position.at);
  const radius = position.accuracyMm * view.pxPerMm;
  ctx.save();
  if (radius > 8) {
    ctx.beginPath(); ctx.arc(at.x, at.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(26, 115, 232, 0.15)"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(26, 115, 232, 0.6)"; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(at.x, at.y, 8, 0, 2 * Math.PI);
  ctx.fillStyle = "rgb(26, 115, 232)"; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
  ctx.restore();
}
