/**
 * Banans delar vid kartbyten (ADR-0203), som Purple Pen (QueryEvent.CountCourseParts, GetCoursePartBounds,
 * EnumCourseControlsToJoin och CourseView.CreateCourseView, BSD, Peter Golde). En banas kontroll med `map-exchange` (eller en
 * kartbyteskontroll) avslutar en del och börjar nästa: del n slutar med kartbytet och del n+1 börjar där, ritad som start.
 * Delarna räknas 0, 1, 2 … (Purple Pens `part`); i gränssnittet "Del 1, Del 2 …". Alla kontroller och en gafflad bana utan
 * vald variant har en del (Purple Pen: "All Variations" har inga delar).
 */
import { rawAttribute } from "./ppen-common";
import type { CourseSettingDocument } from "./types";
import { enumerateCourseControls, variations } from "./walk";

const flag = (value: string | undefined) => value?.toLowerCase() === "true";

/** Banans kontroll är ett kartbyte (`map-exchange`, eller kontrollen är ett kartbyte). */
export function isExchange(document: CourseSettingDocument, courseControl: string): boolean {
  const cc = document.courseControls[courseControl];
  if (!cc) return false;
  return flag(rawAttribute(cc.raw, "course-control", "map-exchange")) || document.controls[cc.control]?.kind === "MAP_EXCHANGE";
}

/** Kartbytet är en vändning av kartan (`map-flip`): delen efter står på baksidan. */
export function isFlip(document: CourseSettingDocument, courseControl: string): boolean {
  const cc = document.courseControls[courseControl];
  return cc !== undefined && isExchange(document, courseControl) && flag(rawAttribute(cc.raw, "course-control", "map-flip"));
}

function pathOf(document: CourseSettingDocument, course: string, variant: string | undefined): readonly string[] | null | undefined {
  const all = variations(document, course);
  if (all.length === 0) return null;
  if (variant === undefined || variant === "") return undefined;
  return all.find(item => item.code === variant)?.choices;
}

/** Banans kontroller (id) delade vid kartbytena; kartbytet står sist i en del och först i nästa. En del om banan saknar kartbyten. */
export function courseParts(document: CourseSettingDocument, course: string, variant?: string): string[][] {
  if (course === "ALL_CONTROLS") return [];
  const found = document.courses.find(item => item.id === course);
  if (!found || found.kind === "SCORE") return [];
  const path = pathOf(document, course, variant);
  if (path === undefined) return [enumerateCourseControls(document, course, null)];
  const all = enumerateCourseControls(document, course, path);
  const parts: string[][] = [[]];
  for (const ccId of all) {
    parts[parts.length - 1]!.push(ccId);
    if (isExchange(document, ccId) && ccId !== all[all.length - 1]) parts.push([ccId]);
  }
  return parts;
}

/** Antalet delar (1 utan kartbyten). */
export function countCourseParts(document: CourseSettingDocument, course: string, variant?: string): number {
  return Math.max(1, courseParts(document, course, variant).length);
}

/** Banor med fler än en del (för väljaren "Hela banan / Del 1 / Del 2 …"); gafflade banor räknas på första varianten. */
export function partsForChooser(document: CourseSettingDocument, course: string): number {
  if (course === "ALL_CONTROLS") return 1;
  const first = variations(document, course)[0]?.code;
  return countCourseParts(document, course, first);
}

/** Purple Pens `<part-options part="n" show-finish="true">`: målet syns också på en del som inte är den sista. */
export function partShowsFinish(document: CourseSettingDocument, course: string, part: number): boolean {
  const found = document.courses.find(item => item.id === course);
  for (const raw of found?.raw ?? []) {
    if (!raw.xml.startsWith("<part-options")) continue;
    if (raw.xml.includes(` part="${part}"`) && /show-finish="true"/i.test(raw.xml)) return true;
  }
  return false;
}

/** Kartbytet som avslutar delen (dess banans kontroll), om det finns. */
export function exchangeAfterPart(document: CourseSettingDocument, course: string, part: number, variant?: string): string | undefined {
  const parts = courseParts(document, course, variant);
  return part < parts.length - 1 ? parts[part]![parts[part]!.length - 1] : undefined;
}
