/**
 * Träningen i .ppen (ADR-0192 beslut 10): ett eget element sist i filen i O-Tid:s namnrymd med träningen som JSON. Purple Pen
 * hoppar över element det inte känner till (EventDB.Load läser bara sina egna namn), så filen går att öppna där.
 */
import type { CourseSettingDocument } from "./types";
import { applyTrainingPatch } from "./training-edit";
import type { TrainingSettings } from "./training-types";
import { attr, el, textOf, type XmlElement } from "./xml";

export const TRAINING_ELEMENT = "otid:training";
export const TRAINING_NAMESPACE = "https://o-tid.se/ns/ppen-training/1";

/** Träningen ur elementet (formen kontrolleras som en ändring); kastar om versionen eller innehållet är fel. */
export function readTrainingElement(element: XmlElement, document: CourseSettingDocument): CourseSettingDocument {
  if (attr(element, "schema-version") !== "1") throw new Error("okänd version av träningen");
  const parsed = JSON.parse(textOf(element)) as Partial<TrainingSettings>;
  if (typeof parsed !== "object" || parsed === null || parsed.schemaVersion !== 1) throw new Error("träningen har fel form");
  const courseIds = new Set(document.courses.map(course => course.id));
  // Delar för banor eller kontroller som inte finns i filen tas inte med.
  const courses = Object.fromEntries(Object.entries(parsed.courses ?? {}).filter(([id]) => courseIds.has(id)));
  const attackPoints = Object.fromEntries(Object.entries(parsed.attackPoints ?? {})
    .filter(([, attack]) => document.controls[attack.from] !== undefined && document.controls[attack.to] !== undefined));
  return applyTrainingPatch(document, { courses, areas: parsed.areas ?? {}, attackPoints, ...(parsed.attackStyle ? { attackStyle: parsed.attackStyle } : {}) });
}

/** Elementet för filen, eller `undefined` utan träning. Delar för banor och kontroller som inte finns skrivs inte. */
export function trainingElement(document: CourseSettingDocument): XmlElement | undefined {
  const training = document.training;
  if (!training) return undefined;
  const courseIds = new Set(document.courses.map(course => course.id));
  const out: TrainingSettings = {
    schemaVersion: 1,
    courses: Object.fromEntries(Object.entries(training.courses).filter(([id]) => courseIds.has(id))),
    areas: Object.fromEntries(Object.entries(training.areas).map(([id, area]) => [id, { ...area, courses: area.courses.filter(course => courseIds.has(course)) }])),
    attackPoints: Object.fromEntries(Object.entries(training.attackPoints)
      .filter(([, attack]) => document.controls[attack.from] !== undefined && document.controls[attack.to] !== undefined)),
    ...(training.attackStyle ? { attackStyle: training.attackStyle } : {})
  };
  return el(TRAINING_ELEMENT, [["xmlns:otid", TRAINING_NAMESPACE], ["schema-version", "1"]], [JSON.stringify(out)]);
}
