import { plural } from "./plural";
import type { LayerId, MergeSuggestion, Standard } from "../lib/map-project-layer-model";

type MergeReason = MergeSuggestion["reason"];
const REASONS: Record<MergeReason, string> = { SAME_CODE: "samma nummer", SAME_NAME: "samma namn", CODE_SUFFIX: "samma nummer efter prefixet",
  NAME_CORE: "samma namn efter kolon", SAME_LOOK: "samma utseende", LAYER: "lagrets namn" };

/** Ägaren 2026-11-09: kartprojektets lager efter normen, lås, nedtonat och sammanslagning av symboler. */
const STANDARD_NAMES: Record<Standard, string> = { ISOM: "ISOM 2017-2", ISSPROM: "ISSprOM 2019-2" };
export const mapProjectSymbolLayersSv = {
  title: "Lager",
  help: (standard: Standard) => `Kartan räknas som ${standard === "ISSPROM" ? "sprintkarta" : "skogskarta"} efter skalan (1:5 000 och större är sprint), `
    + `och lagren följer ${STANDARD_NAMES[standard]}. Släck ett lager för att se det som ligger under, `
    + "lås det för att inte råka ändra det (ett låst lager kan visas nedtonat). Öppna ett lager för dess symboler.",
  layers: {
    LANDFORMS: "Landformer (1xx)", ROCK: "Berg och stenar (2xx)", WATER: "Vatten och sankmark (3xx)", VEGETATION: "Vegetation (4xx)",
    MANMADE: "Anläggningar (5xx)", TECHNICAL: "Tekniska symboler (6xx)", COURSE: "Banpåtryck (7xx)", OTHER: "Övrigt i normen",
    OUTSIDE: "Utanför normen", FILE: "Skisslager ur kartfilen", MARKING: "O-Tid (ram, logga och ruta)"
  } satisfies Record<LayerId, string>,
  outsideHelp: (standard: Standard) => `Symboler som inte finns i ${STANDARD_NAMES[standard]}: en äldre norm, egna symboler eller en annan karta som `
    + "kombinerats in. Slå ihop dem med en symbol i normen nedan.",
  outsideShort: "utanför normen",
  fileHelp: "Symboler som är dolda i kartfilen (Mappers «dölj symbol»), t.ex. en grundkarta från CAD. De ritas med filens eget utseende "
    + "när lagret är tänt, ingår inte i normkontrollen eller generaliseringen och går inte att markera. För över dem till en symbol i normen nedan.",
  fileShort: "skisslager",
  count: (count: number) => plural(count, "objekt", "objekt"),
  groupKey: (digit: number) => `Tangenten ${digit} tänder och släcker gruppen, Skift+${digit} visar bara den, 0 tänder allt.`,
  multiHelp: "Skift+klick på ett öga eller lås sätter samma val på alla rader emellan; Alt+klick på ögat visar bara den raden. 1–6 tänder och släcker normens grupper.",
  viewsHeading: "Sparade vyer",
  viewsHelp: "Spara lagrens val under ett namn (t.ex. ”bara kurvor” eller ”rekning”) och växla mellan dem. Vyerna sparas i den här webbläsaren.",
  viewName: "Namn",
  viewSave: "Spara vyn",
  viewUse: "Använd",
  viewRemove: "Ta bort",
  show: (name: string) => `Tänd ${name}`,
  hide: (name: string) => `Släck ${name}`,
  lock: (name: string) => `Lås ${name}`,
  unlock: (name: string) => `Lås upp ${name}`,
  dim: (name: string) => `Visa ${name} nedtonat när det är låst`,
  mergeHeading: "Slå ihop och för över symboler",
  mergeHelp: "Objekten med en symbol får en annan symbol (t.ex. en äldre norms symbol som blir normens, eller två kartors likadana "
    + "symboler). Varje objekt blir en ändring som går att ångra; i ett projekt med förslag blir de förslag.",
  suggestion: (from: string, count: number, to: string, reason: MergeReason, layer?: string) =>
    `${from}${layer ? ` · lagret ${layer}` : ""} (${plural(count, "objekt", "objekt")}) → ${to} · ${REASONS[reason]}`,
  layer: "Bara lagret (från DWG-filen)",
  allLayers: "Alla lager",
  skipCovered: "Hoppa över det som redan är ritat med målsymbolen (inom 1,5 m)",
  from: "Från symbolen",
  to: "Till symbolen",
  choose: "Välj …",
  preview: (count: number, from: string, to: string) => `${plural(count, "objekt", "objekt")} med ${from} får symbolen ${to}. `
    + `${from} finns kvar i kartfilen men har inga objekt efteråt.`,
  bothStandard: (from: string, to: string) => `Obs: båda finns i normen (${from} och ${to}) och betyder olika saker. Slå bara ihop om objekten är felritade.`,
  merge: (count: number) => `Slå ihop ${plural(count, "objekt", "objekt")}`,
  transfer: (count: number) => `För över upp till ${plural(count, "objekt", "objekt")}`,
  merging: (done: number, total: number) => `Slår ihop ${done} av ${total} …`,
  merged: (count: number, from: string, to: string) => `${plural(count, "objekt", "objekt")} med ${from} har nu symbolen ${to}.`,
  locked: "Lagret är låst. Lås upp det under Lager för att ändra."
};
