import type { Texts } from "../lib/language";
import type { trainingMomentsSv } from "./training-moments-sv";

/** ADR-0222: the training's elements and levels (club archive and term planning). */
export const trainingMomentsEn: Texts<typeof trainingMomentsSv> = {
  moments: "Elements",
  momentsHelp: "Choose what the training practises. Write your own words under Own words.",
  levels: "Level",
  levelsHelp: "The Swedish Orienteering Federation's colours. A training with several courses can have several levels.",
  tags: "Own words",
  tagsHelp: "Separate with commas, e.g. Half-term, Youth.",
  suggested: (levels: string) => `Suggested from the courses: ${levels}`,
  useSuggested: "Use the suggestion",
  filterMoments: "Elements",
  filterMomentsHelp: "Trainings with all the chosen elements.",
  filterLevels: "Level",
  filterLevelsHelp: "Trainings with any of the chosen levels.",
  momentNames: {
    KARTLASNING: "Map reading", LEDSTANG: "Handrails", KOMPASS: "Compass", AVSTAND: "Distance judgement", KURVBILD: "Contours",
    VAGVAL: "Route choice", ANGREPPSPUNKT: "Attack point", DETALJ: "Fine detail", FORENKLING: "Simplification", KONTROLLTAGNING: "Control taking",
    KARTMINNE: "Map memory", STRAK: "Line orienteering", KORRIDOR: "Corridor", FONSTER: "Window", NATT: "Night", SPRINT: "Sprint", GAFFLING: "Forking",
    FYSISK: "Fitness"
  },
  levelNames: { GRON: "Green", VIT: "White", GUL: "Yellow", ORANGE: "Orange", VIOLETT: "Violet", BLA: "Blue", SVART: "Black" }
};
