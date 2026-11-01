import { symbolsForBox, type DescriptionBox, type DescriptionStandard } from "@o-tid/course-setting";
import { POOR_ACCURACY_M, type MapPosition } from "./course-setting-geo";
import { setBox } from "./course-setting-description-picker";
import { toScreen, type Viewport } from "./course-setting-viewport";

/**
 * Fältläget (ADR-0181 beslut 6–7): kontrollbeskrivningens F och G med stora knappar och positionen på kartan med
 * kompassens kon. Ren logik; komponenten finns i `course-setting-field.tsx`. Osparade ändringar ligger i telefonen
 * (steg 67, `course-setting-offline.ts`).
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

/**
 * Positionen på kartan: noggrannhetscirkeln, kompassens kon (steg 67: riktningen telefonen pekar, 60° bred) och en blå
 * punkt med vit kant. Noggrannhet sämre än 15 m ritas streckad.
 */
export function drawPosition(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, view: Viewport, position: MapPosition,
  heading?: number) {
  const at = toScreen(view, position.at);
  const radius = position.accuracyMm * view.pxPerMm;
  ctx.save();
  if (radius > 8) {
    ctx.beginPath(); ctx.arc(at.x, at.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(26, 115, 232, 0.15)"; ctx.fill();
    if (position.accuracyM > POOR_ACCURACY_M) ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(26, 115, 232, 0.6)"; ctx.stroke();
    ctx.setLineDash([]);
  }
  if (heading !== undefined) {
    // Skärmens vinkel: 0° = uppåt, medurs (y nedåt).
    const angle = (heading - 90) * Math.PI / 180, half = Math.PI / 6, length = 44;
    const cone = ctx.createRadialGradient(at.x, at.y, 6, at.x, at.y, length);
    cone.addColorStop(0, "rgba(26, 115, 232, 0.55)"); cone.addColorStop(1, "rgba(26, 115, 232, 0)");
    ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.arc(at.x, at.y, length, angle - half, angle + half); ctx.closePath();
    ctx.fillStyle = cone; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(at.x, at.y, 8, 0, 2 * Math.PI);
  ctx.fillStyle = "rgb(26, 115, 232)"; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
  ctx.restore();
}
