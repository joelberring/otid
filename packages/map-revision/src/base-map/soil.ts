/**
 * Ägaren 2026-11-13 («är det möjligt att synka mot jordartskartor för att få bort sankmarker på flacka sandhedar?»): SGU:s
 * jordarter 1:25 000–1:100 000 klassas här som torr, blöt eller annan mark. Fuktsteget ser bara höjdmodellen, så på flack mark
 * blir sand som dränerar lika blöt som torv; jordartskartan avgör (regeln finns i `soil-marsh.ts`).
 *
 * - `dry`: sand och grus som dränerar: isälvssediment (alla), svallsediment, klapper, flygsand, postglacial sand och finsand.
 *   Svämsediment och älvsediment räknas medvetet inte hit (översvämningsmark). Inte heller berg, blockmark, talus eller
 *   vittringsjord: i skärgården ligger små myrar i bergsvackor inom bergpolygonerna, för små för att synas i jordartskartan.
 * - `wet`: torv (mossetorv, kärrtorv, torv), gyttja och gyttjelera.
 * - `other`: allt annat (morän, lera, silt, svämsediment, älvsediment, skaljord, fyllning, vatten, oklassat, berg).
 */
export type SoilClass = "dry" | "wet" | "other";
/** SGU:s kod för vatten; vattnet ger strandkärren i regeln skydd. */
export const SOIL_WATER_CODE = 91;

const DRY_CODES: ReadonlySet<number> = new Set([50, 51, 55, 57, 33, 34, 13, 31, 28]);
const WET_CODES: ReadonlySet<number> = new Set([1, 5, 6, 75, 16]);
const DRY_TEXT = /^(isälvssediment|svallsediment|klapper|flygsand|postglacial (fin)?sand)\b/i;
const WET_TEXT = /torv|gyttj[ae]/i;

/** Klassen för en jordart; texten (`jg2_tx`) avgör och koden (`jg2`) används bara när texten saknas. */
export function classifySoil(code: number | null | undefined, text: string | null | undefined): SoilClass {
  const name = (text ?? "").trim();
  if (name) return WET_TEXT.test(name) ? "wet" : DRY_TEXT.test(name) ? "dry" : "other";
  if (code === null || code === undefined) return "other";
  return WET_CODES.has(code) ? "wet" : DRY_CODES.has(code) ? "dry" : "other";
}

/** En jordartsyta i SWEREF 99 TM (ytterring, sedan hål). */
export interface SoilArea {
  readonly rings: readonly (readonly (readonly [number, number])[])[];
  readonly cls: SoilClass;
  readonly code: number | null;
  readonly text: string;
}
/** Vatten i jordartskartan (kod 91 eller texten «Vatten»). */
export const isSoilWater = (area: Pick<SoilArea, "code" | "text">) => area.code === SOIL_WATER_CODE || /^vatten$/i.test(area.text.trim());
/** Det regeln behöver av jordarterna (torr mark och vatten); resten behöver inte skickas vidare. */
export const soilForMarsh = <T extends Pick<SoilArea, "cls" | "code" | "text">>(areas: readonly T[]): T[] =>
  areas.filter(area => area.cls === "dry" || isSoilWater(area));
