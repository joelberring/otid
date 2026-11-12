import type { CourseSettingDocument } from "./types";

/**
 * Användartestet 2026-11-12: rubriken på kartorna ({tävling}, sidhuvudet, beskrivningens titelrad) är tävlingens namn i
 * O-Tid, inte titeln i den inlästa .ppen-filen ("Gafflingsurval på kartfilen" på 200 kartor till "Natt 2"). Filens titel
 * används bara när banläggaren valt det (`event.printFileTitle`); utan tävlingens namn (t.ex. en fristående banläggning)
 * står filens titel kvar.
 */
export function printedTitle(document: Pick<CourseSettingDocument, "event">, raceTitle: string | undefined): string {
  const file = document.event.title.replace(/\|/g, " ").trim();
  const race = raceTitle?.trim() ?? "";
  if (!race || (document.event.printFileTitle === true && file)) return document.event.title;
  return race;
}

/** Filens titel skiljer sig från tävlingens namn: utskriften säger vilken rubrik kartorna får (och erbjuder filens). */
export function fileTitleDiffers(document: Pick<CourseSettingDocument, "event">, raceTitle: string | undefined): boolean {
  const file = document.event.title.replace(/\|/g, " ").trim();
  const race = raceTitle?.trim() ?? "";
  return file !== "" && race !== "" && file !== race;
}

/** Dokumentet som utskriften ser det: titeln är rubriken på kartorna (`printedTitle`). Samma objekt när inget ändras. */
export function withPrintedTitle<T extends Pick<CourseSettingDocument, "event">>(document: T, raceTitle: string | undefined): T {
  const title = printedTitle(document, raceTitle);
  return title === document.event.title ? document : { ...document, event: { ...document.event, title } };
}
