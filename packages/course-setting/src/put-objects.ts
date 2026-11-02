/**
 * Steg 66 (ADR-0181 beslut 4): `PUT_OBJECTS` sätter hela objekt per id. Används för ångra och gör om när flera ändrar
 * samtidigt: bara de objekt som ett steg ändrade sätts tillbaka. Efteråt kontrolleras att allt pekar på det som finns.
 */
import { legKey } from "./ppen-common";
import type { CourseSettingDocument, PutObjectsEdit } from "./types";
import { CourseSettingEditError } from "./types";
import { applyTrainingPatch } from "./training-edit";

const invalid = (message: string) => new CourseSettingEditError("INVALID", message);
const gone = () => invalid("Ändringen går inte längre: något den bygger på har ändrats eller tagits bort");

function put<T extends { readonly id: string }>(target: Record<string, T>, changes: Readonly<Record<string, T | null>> | undefined, what: string) {
  for (const [id, value] of Object.entries(changes ?? {})) {
    if (value === null) { delete target[id]; continue; }
    if (typeof value !== "object" || value.id !== id) throw invalid(`${what} ${id} har fel id`);
    target[id] = value;
  }
}

/** Sätter objekten och kontrollerar att banornas kontroller, banorna, sträckorna och specialobjekten pekar rätt. */
export function putObjects(document: CourseSettingDocument, edit: PutObjectsEdit): CourseSettingDocument {
  const controls = { ...document.controls };
  const courseControls = { ...document.courseControls };
  const legs = { ...document.legs };
  put(controls, edit.controls, "Kontrollen");
  put(courseControls, edit.courseControls, "Banans kontroll");
  for (const [key, value] of Object.entries(edit.legs ?? {})) {
    if (value === null) { delete legs[key]; continue; }
    if (typeof value !== "object" || legKey(value.from, value.to) !== key) throw invalid(`Sträckan ${key} har fel nyckel`);
    legs[key] = value;
  }
  let courses = [...document.courses];
  for (const [id, value] of Object.entries(edit.courses ?? {})) {
    if (value !== null && (typeof value !== "object" || value.id !== id)) throw invalid(`Banan ${id} har fel id`);
    const index = courses.findIndex(course => course.id === id);
    if (value === null) courses = courses.filter(course => course.id !== id);
    // ADR-0190: en bana som finns behåller sin plats i listan; platsen ändras bara med `courseOrder`.
    else if (index >= 0) courses[index] = { ...value, order: courses[index]!.order };
    else courses.push(value);
  }
  if (edit.courseOrder) {
    for (const [id, order] of Object.entries(edit.courseOrder)) {
      if (!Number.isInteger(order)) throw invalid(`Banan ${id} har fel ordning`);
      const index = courses.findIndex(course => course.id === id);
      if (index < 0) throw gone();
      courses[index] = { ...courses[index]!, order };
    }
    // Ordningen 1, 2, 3 … (två banor på samma plats efter andras flyttar: den som flyttades här först).
    const placed = new Set(Object.keys(edit.courseOrder));
    const sorted = [...courses].sort((a, b) => a.order - b.order || Number(placed.has(b.id)) - Number(placed.has(a.id)) ||
      a.name.localeCompare(b.name, "sv-SE"));
    const rank = new Map(sorted.map((course, index) => [course.id, index + 1]));
    courses = courses.map(course => course.order === rank.get(course.id) ? course : { ...course, order: rank.get(course.id)! });
  }
  let specialObjects = [...document.specialObjects];
  for (const [id, value] of Object.entries(edit.specialObjects ?? {})) {
    if (value !== null && (typeof value !== "object" || value.id !== id)) throw invalid(`Specialobjektet ${id} har fel id`);
    const index = specialObjects.findIndex(special => special.id === id);
    if (value === null) specialObjects = specialObjects.filter(special => special.id !== id);
    else if (index >= 0) specialObjects[index] = value;
    else specialObjects.push(value);
  }
  const has = (id: string | undefined) => id === undefined || courseControls[id] !== undefined;
  for (const item of Object.values(courseControls)) {
    if (!controls[item.control] || !has(item.next)) throw gone();
    if (item.split && (!has(item.split.end) || item.split.branches.some(branch => !has(branch)))) throw gone();
  }
  if (courses.some(course => !has(course.first))) throw gone();
  if (new Set(courses.map(course => course.id)).size !== courses.length) throw invalid("Två banor med samma id");
  if (Object.values(legs).some(leg => !controls[leg.from] || !controls[leg.to])) throw gone();
  const courseIds = new Set(courses.map(course => course.id));
  if (specialObjects.some(special => special.courses.some(course => course !== "0" && !courseIds.has(course)))) throw gone();
  // Händelsen per fält (null = tas bort); `event` (hela) från äldre klienter och förslag gäller fortfarande.
  let event = edit.event ?? document.event;
  if (edit.eventFields) {
    const fields: Record<string, unknown> = { ...event };
    for (const [key, value] of Object.entries(edit.eventFields)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") throw invalid(`Fältet ${key} går inte att ändra`);
      if (value === null) delete fields[key]; else fields[key] = value;
    }
    if (typeof fields.title !== "string" || typeof fields.mapScale !== "number") throw invalid("Händelsen saknar titel eller skala");
    event = fields as unknown as CourseSettingDocument["event"];
  }
  const next = { ...document, event, controls, courseControls, courses, legs, specialObjects };
  return edit.training ? applyTrainingPatch(next, edit.training) : next;
}
