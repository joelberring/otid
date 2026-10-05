import type { EntryTransferCandidates, RaceType } from "@o-tid/contracts";
import { raceTypeSv } from "../i18n/race-type-sv";
import { publicRaceSv } from "../i18n/public-race-sv";
import type { Section } from "./race-sections";

/**
 * Status per del i sidopanelen (ADR-0169 beslut 4, ADR-0170 beslut 2): en kort rad i ord, t.ex.
 * "7 avlästa · 3 kvar i skogen". Symbolen eller färgen bredvid bär aldrig ensam betydelsen.
 */

/** DONE = klart, ATTENTION = något att titta på, OPEN = inte påbörjat eller pågår. */
export type SectionTone = "DONE" | "ATTENTION" | "OPEN";

export type SectionFacts = {
  courses: number; classes: number; entries: number; teams: number;
  fixedStartClasses: number; missingStartTimes: number;
  readOut: number; inForest: number; unknownCards: number | undefined;
  results: number; mispunched: number;
  /** ADR-0172 beslut 4: publicerad, inte publicerad eller dold av superadmin. */
  publication: "PUBLISHED" | "UNPUBLISHED" | "HIDDEN";
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
export function checklistFacts(data: Pick<EntryTransferCandidates, "classes" | "entries"> &
  Partial<Pick<EntryTransferCandidates, "publication">>, extra: {
  courseCount?: number | undefined; inForest?: number | undefined; unknownCards?: number | undefined;
}): SectionFacts {
  const fixedClasses = new Set(data.classes.filter(row => row.startRule === "FIXED").map(row => row.id));
  const statuses = data.entries.map(activeStatus);
  return {
    courses: extra.courseCount ?? new Set(data.classes.map(row => row.courseName)).size,
    classes: data.classes.length,
    entries: data.entries.length,
    teams: new Set(data.entries.flatMap(entry => entry.relay ? [entry.relay.teamId] : [])).size,
    fixedStartClasses: fixedClasses.size,
    missingStartTimes: data.entries.filter(entry => fixedClasses.has(entry.classId) && entry.fixedStartTime === null &&
      entry.relay === undefined).length,
    readOut: statuses.filter(status => status !== undefined && status !== "DNS").length,
    inForest: extra.inForest ?? statuses.filter(status => status === undefined).length,
    unknownCards: extra.unknownCards,
    results: statuses.filter(status => status !== undefined).length,
    mispunched: statuses.filter(status => status === "MP").length,
    publication: data.publication?.hiddenBySuperadmin ? "HIDDEN" : data.publication?.publishedAt ? "PUBLISHED" : "UNPUBLISHED"
  };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Delens status i ord. Namnet på delen (t.ex. "Lag" i stället för "Anmälda") avgör hur antalet skrivs. */
export function sectionStatus(section: Pick<Section, "id" | "label">, facts: SectionFacts, raceType: RaceType): { tone: SectionTone; text: string } {
  switch (section.id) {
    case "COURSES":
      if (section.label === "COURSES") return facts.courses === 0 ? { tone: "OPEN", text: "Ingen bana ännu" }
        : { tone: "DONE", text: plural(facts.courses, "bana", "banor") };
      return facts.courses === 0 ? { tone: "OPEN", text: "Ingen bana ännu" } : {
        tone: facts.classes === 0 ? "OPEN" : "DONE",
        text: `${plural(facts.courses, "bana", "banor")} · ${plural(facts.classes, "klass", "klasser")}` };
    case "CLASSES": return facts.classes === 0 ? { tone: "OPEN", text: "Ingen klass ännu" }
      : { tone: "DONE", text: plural(facts.classes, "klass", "klasser") };
    case "ENTRIES":
      if (section.label === "TEAMS") return facts.teams === 0 ? { tone: "OPEN", text: "Inga lag ännu" }
        : { tone: "DONE", text: `${plural(facts.teams, "lag", "lag")} · ${plural(facts.entries, "löpare", "löpare")}` };
      if (section.label === "PARTICIPANTS") return facts.entries === 0 ? { tone: "OPEN", text: "Inga deltagare ännu" }
        : { tone: "DONE", text: plural(facts.entries, "deltagare", "deltagare") };
      return facts.entries === 0 ? { tone: "OPEN", text: "Inga anmälda ännu" }
        : { tone: "DONE", text: plural(facts.entries, "anmäld", "anmälda") };
    case "START":
      if (facts.classes === 0) return { tone: "OPEN", text: "Inga klasser ännu" };
      if (facts.missingStartTimes > 0) return { tone: "ATTENTION", text: `${facts.missingStartTimes} saknar starttid` };
      return { tone: "DONE", text: facts.fixedStartClasses === 0 ? "Fri start" : "Starttider klara" };
    case "PUBLISH": {
      const text = publicRaceSv.publish.status;
      return facts.publication === "PUBLISHED" ? { tone: "DONE", text: text.published }
        : facts.publication === "HIDDEN" ? { tone: "ATTENTION", text: text.hidden } : { tone: "OPEN", text: text.unpublished };
    }
    case "READOUT": {
      const parts = [`${facts.readOut} avlästa`, `${facts.inForest} kvar`];
      if (facts.unknownCards) parts.push(plural(facts.unknownCards, "okänd bricka", "okända brickor"));
      return { tone: facts.unknownCards ? "ATTENTION" : facts.entries > 0 && facts.inForest === 0 ? "DONE" : "OPEN",
        text: parts.join(" · ") };
    }
    case "RESULTS":
      if (facts.mispunched > 0) return { tone: "ATTENTION",
        text: `${plural(facts.mispunched, "felstämplad", "felstämplade")} att titta på` };
      return facts.results === 0 ? { tone: "OPEN", text: "Inga resultat ännu" }
        : { tone: "DONE", text: plural(facts.results, "resultat", "resultat") };
    case "SETTINGS": return { tone: "DONE", text: raceTypeSv.types[raceType].name };
  }
}
