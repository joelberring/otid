import type { RaceSnapshot, StartRule } from "./types";

/**
 * Redigera klass (ADR-0169 beslut 4): klassen får en annan bana och/eller ett
 * annat startsätt. Funktionen är ren och ger den ögonblicksbild som
 * resultatmotorn ska pröva avläsningarna mot innan ändringen sparas.
 *
 * Byte av startsätt tömmer klassens fasta starttider, precis som när ändringen
 * sparas (`planClassStartRuleChange`).
 */
export interface ProposedClassSetup {
  readonly classId: string;
  readonly courseVersionId: string;
  readonly startRule: StartRule;
}

export function withProposedClassSetup(snapshot: RaceSnapshot, proposed: ProposedClassSetup): RaceSnapshot {
  const current = snapshot.classes.find(raceClass => raceClass.id === proposed.classId);
  if (!current) throw new Error("Klassen saknas i ögonblicksbilden");
  if (!snapshot.courses.some(course => course.versions.some(version => version.id === proposed.courseVersionId))) {
    throw new Error("Banan saknas i ögonblicksbilden");
  }
  const startRuleChanged = current.startRule !== proposed.startRule;
  return {
    ...snapshot,
    classes: snapshot.classes.map(raceClass => raceClass.id !== proposed.classId ? raceClass
      : { ...raceClass, courseVersionId: proposed.courseVersionId, startRule: proposed.startRule }),
    entries: !startRuleChanged ? snapshot.entries : snapshot.entries.map(entry => {
      if (entry.classId !== proposed.classId || entry.fixedStartTime === undefined) return entry;
      const rest = { ...entry };
      delete (rest as { fixedStartTime?: string }).fixedStartTime;
      return rest;
    })
  };
}
