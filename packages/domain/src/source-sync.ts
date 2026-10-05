import type { Course, RaceClass, RaceSnapshot } from "./types";

/**
 * Uppdatering från Eventor eller en ny banfil (ADR-0170 beslut 4): ändringar som påverkar
 * resultat prövas med samma resultatmotor som "Redigera bana" innan de sparas. Funktionerna
 * här är rena och bygger den föreslagna ögonblicksbilden; applikationslagret läser och sparar.
 */

/** Deltagare byter klass. Fast starttid och variant följer med (variant utan bana bedöms efter bästa passning). */
export function withProposedEntryClasses(snapshot: RaceSnapshot, moves: ReadonlyMap<string, string>): RaceSnapshot {
  if (moves.size === 0) return snapshot;
  const classIds = new Set(snapshot.classes.map(raceClass => raceClass.id));
  for (const classId of moves.values()) if (!classIds.has(classId)) throw new Error("Klassen saknas i ögonblicksbilden");
  return { ...snapshot, entries: snapshot.entries.map(entry => moves.has(entry.id) ? { ...entry, classId: moves.get(entry.id)! } : entry) };
}

/** En klass som ännu inte finns (skapas av uppdateringen). */
export function withProposedClass(snapshot: RaceSnapshot, raceClass: RaceClass): RaceSnapshot {
  if (snapshot.classes.some(row => row.id === raceClass.id)) throw new Error("Klassen finns redan");
  if (!snapshot.courses.some(course => course.versions.some(version => version.id === raceClass.courseVersionId))) {
    throw new Error("Banan saknas i ögonblicksbilden");
  }
  return { ...snapshot, classes: [...snapshot.classes, raceClass] };
}

/** En bana som ännu inte finns, utan versioner. Versionen läggs till med `withProposedCourseVersion`. */
export function withProposedCourse(snapshot: RaceSnapshot, course: Pick<Course, "id" | "raceId" | "name">): RaceSnapshot {
  if (snapshot.courses.some(row => row.id === course.id)) throw new Error("Banan finns redan");
  return { ...snapshot, courses: [...snapshot.courses, { ...course, versions: [] }] };
}
