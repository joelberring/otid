import { plural } from "./plural";
import type { LayerId, Standard } from "../lib/map-project-layer-model";

/** Ägaren 2026-11-09: kartprojektets lager efter normen, lås, nedtonat och sammanslagning av symboler. */
const STANDARD_NAMES: Record<Standard, string> = { ISOM: "ISOM 2017-2", ISSPROM: "ISSprOM 2019-2" };
export const mapProjectSymbolLayersSv = {
  title: "Lager",
  help: (standard: Standard) => `Lagren följer ${STANDARD_NAMES[standard]} (kartans skala). Släck ett lager för att se det som ligger under, `
    + "lås det för att inte råka ändra det (ett låst lager kan visas nedtonat). Öppna ett lager för dess symboler.",
  layers: {
    LANDFORMS: "Landformer (1xx)", ROCK: "Berg och stenar (2xx)", WATER: "Vatten och sankmark (3xx)", VEGETATION: "Vegetation (4xx)",
    MANMADE: "Anläggningar (5xx)", TECHNICAL: "Tekniska symboler (6xx)", COURSE: "Banpåtryck (7xx)", OTHER: "Övrigt i normen",
    OUTSIDE: "Utanför normen", MARKING: "O-Tid (ram, logga och ruta)"
  } satisfies Record<LayerId, string>,
  outsideHelp: (standard: Standard) => `Symboler som inte finns i ${STANDARD_NAMES[standard]}: en äldre norm, egna symboler eller en annan karta som `
    + "kombinerats in. Slå ihop dem med en symbol i normen nedan.",
  outsideShort: "utanför normen",
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
  mergeHeading: "Slå ihop symboler",
  mergeHelp: "Objekten med en symbol får en annan symbol (t.ex. en äldre norms symbol som blir normens, eller två kartors likadana "
    + "symboler). Varje objekt blir en ändring som går att ångra; i ett projekt med förslag blir de förslag.",
  suggestion: (from: string, count: number, to: string, reason: "SAME_CODE" | "SAME_NAME") =>
    `${from} (${plural(count, "objekt", "objekt")}) → ${to} · ${reason === "SAME_CODE" ? "samma nummer" : "samma namn"}`,
  from: "Från symbolen",
  to: "Till symbolen",
  choose: "Välj …",
  preview: (count: number, from: string, to: string) => `${plural(count, "objekt", "objekt")} med ${from} får symbolen ${to}. `
    + `${from} finns kvar i kartfilen men har inga objekt efteråt.`,
  bothStandard: (from: string, to: string) => `Obs: båda finns i normen (${from} och ${to}) och betyder olika saker. Slå bara ihop om objekten är felritade.`,
  merge: (count: number) => `Slå ihop ${plural(count, "objekt", "objekt")}`,
  merging: (done: number, total: number) => `Slår ihop ${done} av ${total} …`,
  merged: (count: number, from: string, to: string) => `${plural(count, "objekt", "objekt")} med ${from} har nu symbolen ${to}.`,
  locked: "Lagret är låst. Lås upp det under Lager för att ändra."
};
