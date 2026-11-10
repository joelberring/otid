import type { Texts } from "../lib/language";
import type { mapProjectIntakeSv } from "./map-project-intake-sv";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const mapProjectIntakeEn: Texts<typeof mapProjectIntakeSv> = {
  heading: "Read in a folder of older material",
  help: "Choose a folder (or several files) from an older map project. Vector files (GeoJSON, DXF, Shape) become sketch layers and images become background layers. Everything else is never uploaded, so the project does not grow needlessly. You see the list and can change it before anything is added.",
  chooseFolder: "Choose folder",
  chooseFiles: "Choose files",
  sorting: "Sorting …",
  summary: (keep, discard, bytes) => `${count(keep, "file is read in", "files are read in")}, ${count(discard, "is discarded", "are discarded")} (${bytes} not uploaded).`,
  decision: { SKETCH: "Sketch layer", UNDERLAG: "Background", DISCARD: "Discarded" },
  decisionLabel: name => `What to do with ${name}`,
  reasons: {
    MAP_FILE: "map file – open it as its own project",
    LASER: "laser data – fetched from Lantmäteriet under Laser",
    DWG: "DWG – read it in under Vector material (converted on the geo server)",
    GPS: "GPS track – not read in (personal data)",
    OTHER: "unknown kind",
    SIDECAR: "belongs to a file that is missing",
    DUPLICATE: "duplicate",
    SYSTEM: "system file",
    EMPTY: "nothing to read in the file",
    NO_CRS: "the coordinate system is unknown",
    OUTSIDE: "nothing inside the map"
  },
  start: n => `Add ${count(n, "file", "files")}`,
  cancel: "Start over",
  working: (done, total) => `Adding ${done} of ${total} …`,
  done: (sketches, layers) => `Done: ${count(sketches, "sketch layer", "sketch layers")} and ${count(layers, "background", "backgrounds")}.`,
  sketched: n => count(n, "sketch", "sketches"),
  failed: "could not be added",
  noGeoreference: "The map has no georeference, so the vector files cannot be placed. The images are put in the middle of the map and corrected with control points."
};
