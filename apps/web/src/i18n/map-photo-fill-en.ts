import type { Texts } from "../lib/language";
import type { mapPhotoFillSv } from "./map-photo-fill-sv";

/** Fill areas from the aerial photo (the spaces between the map's lines are classified from the orthophoto). */
export const mapPhotoFillEn: Texts<typeof mapPhotoFillSv> = {
  heading: "Fill areas from the aerial photo",
  help: "The spaces between the map's lines and hard areas (as in Fill over) are classified from the orthophoto: paved, grass, trees or water. Coloured = confident, dashed = unsure. The image never leaves the browser.",
  noPhoto: "Add an orthophoto under Sources (step 1) first.",
  infrared: "The infrared image is used (NDVI).",
  noInfrared: "No infrared image: grass and gravel are harder to tell apart.",
  scopeView: "The visible view",
  scopeMap: "The whole map in stages",
  includeGround: "Also spaces that already have the base map's ground areas (they are cut when the space is added)",
  run: "Classify the spaces",
  busy: (done, total) => total > 1 ? `Classifying … stage ${done} of ${total}` : "Classifying …",
  zoomIn: "The view is too large or has too many lines – zoom in or choose the whole map in stages.",
  noView: "The map is not shown yet.",
  result: (count, seconds, km2) => `${count} spaces in ${seconds} s (${km2} km²).`,
  classes: { paved: "Paved", grass: "Grass/open land", trees: "Trees/forest", water: "Water", unsure: "Unsure" },
  row: (count, hectares) => `${count} spaces, ${hectares} ha`,
  missingSymbol: "the symbol is missing in the map",
  unsure: (count, large) => `${count} unsure spaces${large ? ` (${large} of them larger than 2 ha)` : ""} are not added.`,
  takeUnsure: "Also add unsure spaces by best guess (not the large ones)",
  commit: count => `Add ${count} areas`,
  committed: (count, cut) => `${count} areas added${cut ? `, ${cut} objects under them were cut or removed` : ""}. Undo brings everything back.`,
  notSaved: "The areas could not be added.",
  clear: "Drop the draft",
  ai: "Ask AI about unsure spaces",
  aiHelp: "O-Tid does not call Claude itself. Copy the task and paste it into your Claude conversation with O-Tid's AI connection: Claude looks at the unsure spaces with the tool classify_cells and leaves the answers as proposals (or adds them directly in autonomous mode).",
  aiCopied: "The task is copied.",
  aiPrompt: (name, box, ground) => `Use O-Tid's tool classify_cells in the map project «${name}» for the area ${box} (map mm)${ground ? " with include_ground: true" : ""}. Look at the images of the unsure spaces and answer with a class per space (paved, grass, trees, water or skip), in batches, and submit the answers with answers.`
};
