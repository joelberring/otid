/**
 * Träningsformernas namn som taggar (ADR-0192 beslut 13). Namnen är svenska och stabila: klubbarkivet (ADR-0194) föreslår
 * samma ord ur mapp- och filnamn (Korridor, Kurvbild, Fönster, Linje, Stjärna, Keps, Minnes …), så en träning som görs här
 * och en gammal fil med samma övning får samma tagg. Byt inte ett namn utan att ändra arkivets regler samtidigt.
 */
import type { CourseSettingDocument } from "./types";
import type { SymbolFilter } from "./training-types";
import { areasFor, trainingOf } from "./training-passes";
import { controlSequences } from "./training-regions";

export const TRAINING_TAGS = {
  CORRIDOR: "Korridor",
  CONTOURS: "Kurvbild",
  WINDOW: "Fönster",
  NO_MAP: "Utan karta",
  ATTACK: "Sista säkra",
  STAR: "Stjärna",
  LINE: "Linje",
  PAIRS: "Keps",
  PIECES: "Minnes",
  MIRROR: "Spegel"
} as const;

export type TrainingTag = (typeof TRAINING_TAGS)[keyof typeof TRAINING_TAGS];

const contours = (filter: SymbolFilter | undefined) => filter?.preset === "CONTOURS" || filter?.preset === "CONTOURS_WATER_ROCK";

/** Taggarna för banans träning, i `TRAINING_TAGS` ordning (tom lista = ingen träning på banan). */
export function trainingTags(document: CourseSettingDocument, course: string): TrainingTag[] {
  const training = trainingOf(document);
  const ct = training.courses[course];
  const found = new Set<TrainingTag>();
  if (ct) {
    for (const section of ct.sections) {
      if (section.form === "CORRIDOR") found.add(TRAINING_TAGS.CORRIDOR);
      if (section.form === "WINDOW") found.add(TRAINING_TAGS.WINDOW);
      if (section.form === "NO_MAP") found.add(TRAINING_TAGS.NO_MAP);
      if (contours(section.filter)) found.add(TRAINING_TAGS.CONTOURS);
    }
    if (contours(ct.filter) || (ct.outside.kind === "FILTER" && contours(ct.outside.filter))) found.add(TRAINING_TAGS.CONTOURS);
    if (ct.star) found.add(TRAINING_TAGS.STAR);
    if (ct.line) found.add(TRAINING_TAGS.LINE);
    if (ct.pairs) found.add(TRAINING_TAGS.PAIRS);
    if (ct.pieces) found.add(TRAINING_TAGS.PIECES);
    if (ct.mirror) found.add(TRAINING_TAGS.MIRROR);
  }
  if (areasFor(document, course).some(area => contours(area.filter))) found.add(TRAINING_TAGS.CONTOURS);
  // Sista säkra: på en av banans sträckor (någon variant).
  const legs = new Set(controlSequences(document, course, undefined).flatMap(sequence => {
    const controls = sequence.map(cc => document.courseControls[cc]?.control);
    return controls.slice(1).map((to, i) => `${controls[i]}-${to}`);
  }));
  if (Object.values(training.attackPoints).some(attack => legs.has(`${attack.from}-${attack.to}`))) found.add(TRAINING_TAGS.ATTACK);
  return Object.values(TRAINING_TAGS).filter(tag => found.has(tag));
}
