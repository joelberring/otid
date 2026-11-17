import type { MapProjectView } from "@o-tid/contracts";

/**
 * Översynen 2026-11-17: «Nästa steg» på kartprojektets sida, i ordning: underlaget (grundkartan ur laser m.m.), rita kartan,
 * kontrollera och exportera, och lägga banor på den. Stegen läses ur `MapProjectView` (ingen egen fråga till servern), som
 * klubbytans «Kom igång».
 * - Underlaget är klart när projektet startade från en befintlig karta, eller när en ny karta har fått objekt.
 * - Ritandet är påbörjat när kartan har ändrade objekt.
 * - Exporten är klar när projektet har en ny kartversion (översynen av kartstegen 2026-11-17).
 * - Banorna läggs i en tävlings banläggning, som väljer kartprojektet; projektet vet inte om det, så steget blir aldrig klart här.
 */
export type MapProjectStep = "base" | "draw" | "export" | "courses";
export const MAP_PROJECT_STEPS: readonly MapProjectStep[] = ["base", "draw", "export", "courses"];

export interface MapProjectStepStatus {
  done: Record<MapProjectStep, boolean>;
  /** Första steget som inte är klart. */
  next: MapProjectStep;
}

export function mapProjectSteps(view: Pick<MapProjectView, "base" | "changedObjects" | "outputs">): MapProjectStepStatus {
  const drawn = view.changedObjects > 0;
  const done: Record<MapProjectStep, boolean> = {
    base: view.base.source !== "NEW" || drawn, draw: drawn, export: view.outputs.length > 0, courses: false
  };
  return { done, next: MAP_PROJECT_STEPS.find(step => !done[step]) ?? "courses" };
}
