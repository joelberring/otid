import type { IntakeDecision, IntakeReason } from "../lib/map-project-folder-intake";
import { plural } from "./plural";

/** Ägaren 2026-11-10: en mapp med äldre underlag som sorteras (kartredigerarens sidopanel). */
export const mapProjectIntakeSv = {
  heading: "Läs in en mapp med äldre underlag",
  help: "Välj en mapp (eller flera filer) från ett äldre kartprojekt. Vektorfiler (GeoJSON, DXF, Shape) blir skisslager och bilder blir underlag. Allt annat laddas aldrig upp, så att projektet inte växer i onödan. Du ser listan och kan ändra innan något läggs in.",
  chooseFolder: "Välj mapp",
  chooseFiles: "Välj filer",
  sorting: "Sorterar …",
  summary: (keep: number, discard: number, bytes: string) => `${plural(keep, "fil läses in", "filer läses in")}, ${plural(discard, "slängs", "slängs")} (${bytes} laddas inte upp).`,
  decision: { SKETCH: "Skisslager", UNDERLAG: "Underlag", DISCARD: "Slängs" } as Record<IntakeDecision, string>,
  decisionLabel: (name: string) => `Vad görs med ${name}`,
  reasons: {
    MAP_FILE: "kartfil – öppna den som eget projekt",
    LASER: "laserdata – hämtas från Lantmäteriet under Laser",
    DWG: "DWG – läs in den under Vektorunderlag (görs om på geo-servern)",
    GPS: "GPS-spår – läses inte in (personuppgifter)",
    OTHER: "okänt slag",
    SIDECAR: "hör till en fil som saknas",
    DUPLICATE: "dubblett",
    SYSTEM: "systemfil",
    EMPTY: "inget att läsa i filen",
    NO_CRS: "koordinatsystemet är okänt",
    OUTSIDE: "inget inom kartan"
  } as Record<IntakeReason, string>,
  start: (count: number) => `Lägg in ${plural(count, "fil", "filer")}`,
  cancel: "Börja om",
  working: (done: number, total: number) => `Lägger in ${done} av ${total} …`,
  done: (sketches: number, layers: number) => `Klart: ${plural(sketches, "skisslager", "skisslager")} och ${plural(layers, "underlag", "underlag")}.`,
  sketched: (count: number) => `${plural(count, "skiss", "skisser")}`,
  failed: "gick inte att lägga in",
  noGeoreference: "Kartan saknar georeferens, så vektorfilerna kan inte placeras. Bilderna läggs mitt i kartan och rättas med passpunkter."
};
