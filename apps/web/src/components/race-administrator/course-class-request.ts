import type { RaceType } from "@o-tid/contracts";
import type { CourseClassRequest } from "./types";

/**
 * Användartest 2026-11-12: i Träning får en ny bana alltid en klass, så att banan går att välja vid anmälan,
 * självregistrering och okänd bricka. Tomt klassnamn ger klassen banans namn. Övriga typer: klassen är valfri.
 */
export function courseGetsClass(raceType: RaceType | undefined, className: string): boolean {
  return className.trim() !== "" || raceType === "TRAINING";
}

/** Begäran för "Ny bana". Startsätt och rogainingens regler gäller klassen och skickas bara med en klass (steg 55). */
export function courseClassRequestFrom(input: {
  requestId: string; raceType: RaceType | undefined; courseName: string; className: string; controlCodes: number[];
  startRuleChoice: boolean; startRule: NonNullable<CourseClassRequest["startRule"]>;
  rogaining?: { timeLimitMinutes: number; penaltyPoints: number } | undefined;
}): CourseClassRequest {
  const course = input.courseName.trim();
  const head = { formatVersion: 1 as const, requestId: input.requestId, courseName: course };
  if (!courseGetsClass(input.raceType, input.className)) return { ...head, controlCodes: input.controlCodes };
  const className = input.className.trim() || course;
  // Nycklarnas ordning är kontraktets (courseName, className, startRule, controlCodes, rogaining): kvittot jämförs som text
  // mot begäran (`course-preparation.ts`), så en annan ordning läses som att servern inte svarade.
  // ADR-0170: typer utan val av startsätt (Träning, Rogaining) har alltid fri start.
  return { ...head, className, startRule: input.startRuleChoice ? input.startRule : "PUNCH", controlCodes: input.controlCodes,
    ...(input.rogaining ? { rogaining: input.rogaining } : {}) };
}
