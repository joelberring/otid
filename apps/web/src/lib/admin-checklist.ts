import type { EntryTransferCandidates } from "@o-tid/contracts";

/** Arbetsytans checklista (ADR-0169 beslut 4): Banor → Klasser → Anmälda → Start → Avläsning → Resultat. */
export const checklistSteps = ["COURSES", "CLASSES", "ENTRIES", "START", "READOUT", "RESULTS"] as const;
export type ChecklistStep = typeof checklistSteps[number];

/** DONE = klart, ATTENTION = något att titta på, OPEN = inte påbörjat eller pågår. */
export type ChecklistTone = "DONE" | "ATTENTION" | "OPEN";

export type ChecklistFacts = {
  courses: number; classes: number; entries: number;
  fixedStartClasses: number; missingStartTimes: number;
  readOut: number; inForest: number; unknownCards: number | undefined;
  results: number; mispunched: number;
};

type Entry = EntryTransferCandidates["entries"][number];

function activeStatus(entry: Entry) {
  return entry.effectiveResult.state === "ACTIVE_RESULT" ? entry.effectiveResult.result.status : undefined;
}

/** ADR-0168: kvar i skogen = anmälda som varken är avlästa/återkomna eller ej startande (ur skogsrapporten). */
export function inForest<T extends { forestState: string }>(entries: readonly T[]): T[] {
  return entries.filter(row => row.forestState !== "RETURNED" && row.forestState !== "NOT_STARTED");
}

/** Löpare vars gällande resultat är felstämplat (MP). */
export function mispunchedEntries(data: Pick<EntryTransferCandidates, "entries">): Entry[] {
  return data.entries.filter(entry => activeStatus(entry) === "MP");
}

/**
 * Räknar fram checklistans underlag ur det arbetsytan redan har läst. Banor räknas ur bantabellen när den är
 * inläst, annars ur klassernas banor. Kvar i skogen tas ur skogsrapporten när den finns, annars är det anmälda
 * utan resultat (ej start räknas som resultat).
 */
export function checklistFacts(data: Pick<EntryTransferCandidates, "classes" | "entries">, extra: {
  courseCount?: number | undefined; inForest?: number | undefined; unknownCards?: number | undefined;
}): ChecklistFacts {
  const fixedClasses = new Set(data.classes.filter(row => row.startRule === "FIXED").map(row => row.id));
  const statuses = data.entries.map(activeStatus);
  return {
    courses: extra.courseCount ?? new Set(data.classes.map(row => row.courseName)).size,
    classes: data.classes.length,
    entries: data.entries.length,
    fixedStartClasses: fixedClasses.size,
    missingStartTimes: data.entries.filter(entry => fixedClasses.has(entry.classId) && entry.fixedStartTime === null).length,
    readOut: statuses.filter(status => status !== undefined && status !== "DNS").length,
    inForest: extra.inForest ?? statuses.filter(status => status === undefined).length,
    unknownCards: extra.unknownCards,
    results: statuses.filter(status => status !== undefined).length,
    mispunched: statuses.filter(status => status === "MP").length
  };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Stegets status i ord. Symbolen visas bredvid men bär aldrig ensam betydelsen. */
export function checklistStatus(step: ChecklistStep, facts: ChecklistFacts): { tone: ChecklistTone; text: string } {
  switch (step) {
    case "COURSES": return facts.courses === 0 ? { tone: "OPEN", text: "Ingen bana ännu" }
      : { tone: "DONE", text: plural(facts.courses, "bana", "banor") };
    case "CLASSES": return facts.classes === 0 ? { tone: "OPEN", text: "Ingen klass ännu" }
      : { tone: "DONE", text: plural(facts.classes, "klass", "klasser") };
    case "ENTRIES": return facts.entries === 0 ? { tone: "OPEN", text: "Inga anmälda ännu" }
      : { tone: "DONE", text: plural(facts.entries, "anmäld", "anmälda") };
    case "START":
      if (facts.classes === 0) return { tone: "OPEN", text: "Inga klasser ännu" };
      if (facts.missingStartTimes > 0) return { tone: "ATTENTION", text: `${facts.missingStartTimes} saknar starttid` };
      return { tone: "DONE", text: facts.fixedStartClasses === 0 ? "Fri start" : "Starttider klara" };
    case "READOUT": {
      const parts = [`${facts.readOut} avlästa`, `${facts.inForest} kvar i skogen`];
      if (facts.unknownCards) parts.push(plural(facts.unknownCards, "okänd bricka", "okända brickor"));
      return { tone: facts.unknownCards ? "ATTENTION" : facts.entries > 0 && facts.inForest === 0 ? "DONE" : "OPEN",
        text: parts.join(" · ") };
    }
    case "RESULTS":
      if (facts.mispunched > 0) return { tone: "ATTENTION",
        text: `${plural(facts.mispunched, "felstämplad", "felstämplade")} att titta på` };
      return facts.results === 0 ? { tone: "OPEN", text: "Inga resultat ännu" }
        : { tone: "DONE", text: plural(facts.results, "resultat", "resultat") };
  }
}
