import { codeParts } from "./map-norm";
import type { SprintNorm } from "./sprint-layers";

/**
 * «Föreslå ytor» på sprintkartor (ägaren 2026-11-13: «ytor är särskilt svårt»): vad en sluten ruta mellan kartans linjer
 * troligen är, med enkla regler som bara ser kartans egna objekt (gränsens linjer och husen i rutan). Ren funktion utan I/O.
 *
 * Reglerna är medvetet få och försiktiga. Mätningen mot en riktig sprintkarta (Älvsjö–Solberga,
 * learn-data/sprint/proto/RESULTAT.md) gav 57–62 % rätt yta för regler per yta, också med laser och ortofoto till hjälp:
 * byggnaderna stämmer bäst (F 0,76), belagt sämre (0,58) och tomtmark är osäkrast (0,40). Därför är svaret alltid ett
 * FÖRSLAG som kartritaren godkänner, aldrig något som läggs in av sig självt, och stora rutor och rutor som bara blev slutna
 * genom glappslutning får inget förslag alls.
 *
 * Reglerna själva är provade på samma område (grundkartans linjer och byggnader i en tom sprintkarta, 2026-11-13): av ytan
 * som föreslås som belagd är ungefär hälften (52 %) belagd i facit, mot en femtedel av området i stort; resten är mest
 * gräsremsor mellan två kanter (en kantlinje säger inte vilken sida som är belagd). Av tomtmarksförslagens yta är också
 * ungefär hälften tomtmark eller hus, på få rutor. Tas rutor med slutna glapp med sjunker träffen för belagt till 44 %, och de
 * får därför aldrig förslag.
 */

/** Minsta ruta som blir en kandidat (m² i terrängen): mindre är skarvar och ritrester. */
export const FACE_MIN_AREA_M2 = 20;
/** Över detta (0,5 ha) är rutan osäker: i mätningen är så stora rutor nästan alltid flera saker (gata, gård och skog i ett). */
export const FACE_UNCERTAIN_AREA_M2 = 5000;
/** Rutan ÄR en byggnad när så här stor andel av gränsen är byggnadens kontur. */
export const BUILDING_BOUNDARY_SHARE = 0.9;
/** Belagd yta: minst så här stor andel av gränsen är kant belagd yta (eller kanten på en belagd yta som redan finns). */
export const PAVED_EDGE_SHARE = 0.6;
/**
 * Belagd yta, smal och avlång: medelbredden (2 × yta / omkrets, för en lång remsa dess bredd) är högst så här många meter (en
 * gångväg, smal gata, infart eller refug). Provet på Solberga (med glappslutna rutor medräknade): under 6 m är 42–48 % av förslagens yta
 * belagd i facit, 6–8 m 32 % och bredare 14 %. Att rutan är avlång utan att vara smal hjälper inte, och inte heller att den gränsar till en belagd yta
 * som redan finns (24 % belagt, som slumpen: remsan intill en gata är oftare gräs än trottoar), så de reglerna finns inte.
 */
export const PAVED_MAX_MEAN_WIDTH_M = 6;
/** Tomtmark: av gränsen utom husens väggar är minst så här stor andel staket, mur, häck eller kant belagd yta (infart, gata). */
export const PLOT_BOUNDARY_SHARE = 0.6;
/** Tomtmark: minst så här stor andel av samma gräns är staket, mur eller häck (en gård som bara kantas av gator är ingen tomt). */
export const PLOT_BARRIER_SHARE = 0.25;
/** Tomtmark: störst så här (m²). Större inhägnade rutor (skolgårdar, industritomter) avgörs på plats. */
export const PLOT_MAX_AREA_M2 = 2500;

/** Vad ett kartobjekt är för en ruta som det begränsar. */
export type FaceBoundaryRole = "building" | "pavedEdge" | "paved" | "barrier" | "forbidden" | "other";

const LINE_ROLES: Record<SprintNorm, Readonly<Record<number, FaceBoundaryRole>>> = {
  // ISSprOM 2019-2: 501 kant belagd yta, 513/515 mur, 516/518 staket, 406–411 gröna linjer (häck), 521 byggnadens kontur.
  ISSPROM: { 501: "pavedEdge", 513: "barrier", 515: "barrier", 516: "barrier", 518: "barrier", 406: "barrier", 408: "barrier", 410: "barrier", 411: "barrier", 521: "building" },
  // ISSOM 2007: 529 kant belagd yta, 519/521 mur, 522/524 staket, 410/421 häck, 526 byggnadens kontur.
  ISSOM: { 529: "pavedEdge", 519: "barrier", 521: "barrier", 522: "barrier", 524: "barrier", 410: "barrier", 421: "barrier", 526: "building" }
};
const AREA_ROLES: Record<SprintNorm, Readonly<Record<number, FaceBoundaryRole>>> = {
  ISSPROM: { 521: "building", 501: "paved", 520: "forbidden" },
  ISSOM: { 526: "building", 529: "paved", 527: "forbidden", 528: "forbidden" }
};

/** Rollen för ett linje- eller ytobjekt med symbolens nummer («501.1», «521.0») i kartans norm. */
export function faceBoundaryRole(code: string, kind: "line" | "area", norm: SprintNorm): FaceBoundaryRole {
  return (kind === "area" ? AREA_ROLES : LINE_ROLES)[norm][codeParts(code).main] ?? "other";
}

/** Numren (som skogsreglerna skriver dem, ISOM 2017-2/ISSprOM) för förslagen; `sprintSymbolForCode` hittar symbolen i kartan. */
export const FACE_SUGGESTION_CODES = { paved: "501", forbidden: "520" } as const;
export type FaceSuggestionRole = keyof typeof FACE_SUGGESTION_CODES;

/** Det reglerna ser av en ruta. Längderna i meter i terrängen. */
export interface FaceFeatures {
  readonly areaM2: number;
  /** Hela gränsen: ytterkanten och hålen, slutna glapp medräknade. */
  readonly perimeterM: number;
  /** Gränsens längd per roll (en sträcka där två objekt ligger på varandra räknas till båda). */
  readonly boundaryM: Readonly<Partial<Record<FaceBoundaryRole, number>>>;
  /** Glapp som slöts för att rutan skulle bli sluten. */
  readonly closures: number;
  /** Byggnader som ligger i rutan (som hål). En byggnad i rutans kant syns i `boundaryM.building`. */
  readonly buildingsInside: number;
}

export type FaceVerdict =
  /** Ett förslag, och regeln som gav det. */
  | { readonly role: FaceSuggestionRole; readonly uncertain?: undefined; readonly rule: "pavedNarrow" | "plot" }
  /** Inget förslag. `uncertain`: rutan är för stor eller blev sluten först när glapp slöts; `rule` säger annars varför. */
  | { readonly role?: undefined; readonly uncertain?: "large" | "gaps" | undefined; readonly rule: "large" | "gaps" | "building" | "none" };

/**
 * Förslaget för en ruta. Ordningen:
 * 1. Större än 0,5 ha, eller sluten genom glappslutning → osäker, aldrig förslag.
 * 2. Gränsen är till minst 90 % en byggnads kontur → rutan är byggnaden: inget förslag.
 * 3. Inga hus i rutan, minst 60 % av gränsen är kant belagd yta (eller kanten på en belagd yta som redan finns), och rutan är
 *    smal och avlång (medelbredd högst 6 m) → belagd yta (501).
 * 4. Hus i rutan eller i dess kant, högst 2 500 m², och gränsen utom husens väggar är till minst 60 % staket, mur, häck eller kant belagd yta
 *    (infarten och gatan) varav minst 25 % staket, mur eller häck → område som inte får beträdas, tomtmark (520).
 * 5. Annars inget förslag: kartritaren väljer.
 */
export function suggestFaceRole(face: FaceFeatures): FaceVerdict {
  if (face.areaM2 > FACE_UNCERTAIN_AREA_M2) return { uncertain: "large", rule: "large" };
  if (face.closures > 0) return { uncertain: "gaps", rule: "gaps" };
  const of = (role: FaceBoundaryRole) => face.boundaryM[role] ?? 0;
  const perimeter = face.perimeterM;
  if (!(perimeter > 0) || !(face.areaM2 > 0)) return { rule: "none" };
  if (of("building") >= BUILDING_BOUNDARY_SHARE * perimeter) return { rule: "building" };
  if (face.buildingsInside === 0 && of("pavedEdge") + of("paved") >= PAVED_EDGE_SHARE * perimeter
    && 2 * face.areaM2 / perimeter <= PAVED_MAX_MEAN_WIDTH_M) return { role: "paved", rule: "pavedNarrow" };
  const open = perimeter - of("building");
  if ((face.buildingsInside > 0 || of("building") > 0) && face.areaM2 <= PLOT_MAX_AREA_M2 && open > 0
    && of("barrier") + of("pavedEdge") + of("forbidden") >= PLOT_BOUNDARY_SHARE * open && of("barrier") >= PLOT_BARRIER_SHARE * open) {
    return { role: "forbidden", rule: "plot" };
  }
  return { rule: "none" };
}
