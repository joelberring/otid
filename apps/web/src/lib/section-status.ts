import type { EntryTransferCandidates, RaceType } from "@o-tid/contracts";
import { awaitingScheduledStart, raceDayStarted, remainsInForest } from "@o-tid/domain";
import { raceTypeSv } from "../i18n/race-type-sv";
import { sectionStatusSv } from "../i18n/race-workspace-navigation-sv";
import { raceTypeEn, sectionStatusEn } from "../i18n/workspace-en";
import { pickTexts, type Language } from "./language";
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

type ForestRow = { forestState: string; entryId?: string; startState?: string; fixedStartTime?: string | null };
type ForestRace = { readonly raceDate?: string; readonly timeZone?: string; readonly radioPunched?: readonly string[] };

/**
 * Domänens fakta för en rad i skogsrapporten. Utan uppgift om radiostämplingar (`radioPunched` saknas) räknas varje
 * löpare som radiostämplad, så att ingen tas bort ur listan på för svagt underlag.
 */
function forestFacts(row: ForestRow, radioPunched: ReadonlySet<string> | undefined) {
  return { forestState: row.forestState, startState: row.startState, fixedStartTime: row.fixedStartTime,
    radioPunched: radioPunched === undefined || row.entryId === undefined || radioPunched.has(row.entryId) };
}

/**
 * ADR-0168: kvar i skogen = anmälda som varken är avlästa/återkomna eller ej startande (ur skogsrapporten).
 * Före tävlingsdagen (i tävlingens tidszon) är ingen kvar i skogen (PLAN.md steg 22): rapporten tas med
 * `raceDate` och `timeZone` så att listan är tom tills tävlingen kan ha börjat. Användartestet 2026-11-12: inte heller en
 * löpare vars lottade starttid ligger framåt i tiden och som inte har några andra uppgifter (domänens `remainsInForest`).
 */
export function inForest<T extends ForestRow>(entries: readonly T[], race?: ForestRace, now = new Date()): T[] {
  if (race?.raceDate !== undefined && race.timeZone !== undefined && !raceDayStarted(race.raceDate, race.timeZone, now)) return [];
  const radio = race?.radioPunched ? new Set(race.radioPunched) : undefined;
  return entries.filter(row => remainsInForest(forestFacts(row, radio), now));
}

/** Löpare som väntar på sin lottade start ("Inte startat"): det `inForest` lämnar utanför av det skälet. */
export function awaitingStart<T extends ForestRow>(entries: readonly T[], race?: ForestRace, now = new Date()): T[] {
  const radio = race?.radioPunched ? new Set(race.radioPunched) : undefined;
  return entries.filter(row => awaitingScheduledStart(forestFacts(row, radio), now));
}

/**
 * Felstämplade att titta på: gällande resultat felstämplat (MP) och inte kontrollerat. Steg 38: en bekräftad felstämpling
 * (eller manuell tid som felstämplad) står kvar som felstämplad men räknas inte här.
 */
export function mispunchedEntries(data: Pick<EntryTransferCandidates, "entries">): Entry[] {
  return data.entries.filter(entry => activeStatus(entry) === "MP" && !entry.mispunchConfirmed);
}

/**
 * Räknar fram checklistans underlag ur det arbetsytan redan har läst. Banor räknas ur bantabellen när den är
 * inläst, annars ur klassernas banor. Kvar i skogen tas ur skogsrapporten när den finns, annars är det anmälda
 * utan resultat (ej start räknas som resultat).
 */
export function checklistFacts(data: Pick<EntryTransferCandidates, "classes" | "entries"> &
  Partial<Pick<EntryTransferCandidates, "publication" | "raceDate" | "timeZone">>, extra: {
  courseCount?: number | undefined; inForest?: number | undefined; unknownCards?: number | undefined; now?: Date;
}): SectionFacts {
  const fixedClasses = new Set(data.classes.filter(row => row.startRule === "FIXED").map(row => row.id));
  const statuses = data.entries.map(activeStatus);
  const started = data.raceDate === undefined || data.timeZone === undefined || raceDayStarted(data.raceDate, data.timeZone, extra.now ?? new Date());
  return {
    courses: extra.courseCount ?? new Set(data.classes.map(row => row.courseName)).size,
    classes: data.classes.length,
    entries: data.entries.length,
    teams: new Set(data.entries.flatMap(entry => entry.relay ? [entry.relay.teamId] : [])).size,
    fixedStartClasses: fixedClasses.size,
    missingStartTimes: data.entries.filter(entry => fixedClasses.has(entry.classId) && entry.fixedStartTime === null &&
      entry.relay === undefined).length,
    readOut: statuses.filter(status => status !== undefined && status !== "DNS").length,
    inForest: extra.inForest ?? (started ? statuses.filter(status => status === undefined).length : 0),
    unknownCards: extra.unknownCards,
    results: statuses.filter(status => status !== undefined).length,
    mispunched: mispunchedEntries(data).length,
    publication: data.publication?.hiddenBySuperadmin ? "HIDDEN" : data.publication?.publishedAt ? "PUBLISHED" : "UNPUBLISHED"
  };
}

/** Delens status i ord. Namnet på delen (t.ex. "Lag" i stället för "Anmälda") avgör hur antalet skrivs. */
export function sectionStatus(section: Pick<Section, "id" | "label">, facts: SectionFacts, raceType: RaceType,
  language: Language = "sv"): { tone: SectionTone; text: string } {
  const text = pickTexts(language, sectionStatusSv, sectionStatusEn);
  switch (section.id) {
    case "COURSES":
      if (section.label === "COURSES") return facts.courses === 0 ? { tone: "OPEN", text: text.noCourses }
        : { tone: "DONE", text: text.courses(facts.courses) };
      if (facts.courses === 0) return { tone: "OPEN", text: section.label === "CONTROLS_POINTS" ? text.noControls : text.noCourses };
      return { tone: facts.classes === 0 ? "OPEN" : "DONE", text: `${text.courses(facts.courses)} · ${text.classes(facts.classes)}` };
    case "CLASSES": return facts.classes === 0 ? { tone: "OPEN", text: text.noClasses } : { tone: "DONE", text: text.classes(facts.classes) };
    case "ENTRIES":
      if (section.label === "TEAMS") return facts.teams === 0 ? { tone: "OPEN", text: text.noTeams }
        : { tone: "DONE", text: text.teams(facts.teams, facts.entries) };
      if (section.label === "PARTICIPANTS") return facts.entries === 0 ? { tone: "OPEN", text: text.noParticipants }
        : { tone: "DONE", text: text.participants(facts.entries) };
      return facts.entries === 0 ? { tone: "OPEN", text: text.noEntries } : { tone: "DONE", text: text.entries(facts.entries) };
    case "START":
      if (facts.classes === 0) return { tone: "OPEN", text: text.noClassesPlural };
      if (facts.missingStartTimes > 0) return { tone: "ATTENTION", text: text.missingStartTimes(facts.missingStartTimes) };
      return { tone: "DONE", text: facts.fixedStartClasses === 0 ? text.freeStart : text.startTimesReady };
    case "PUBLISH":
      return facts.publication === "PUBLISHED" ? { tone: "DONE", text: text.published }
        : facts.publication === "HIDDEN" ? { tone: "ATTENTION", text: text.hidden } : { tone: "OPEN", text: text.unpublished };
    case "READOUT": {
      const parts = [text.readOut(facts.readOut), text.inForest(facts.inForest)];
      if (facts.unknownCards) parts.push(text.unknownCards(facts.unknownCards));
      return { tone: facts.unknownCards ? "ATTENTION" : facts.entries > 0 && facts.inForest === 0 ? "DONE" : "OPEN",
        text: parts.join(" · ") };
    }
    case "RESULTS":
      if (facts.mispunched > 0) return { tone: "ATTENTION", text: text.mispunched(facts.mispunched) };
      return facts.results === 0 ? { tone: "OPEN", text: text.noResults } : { tone: "DONE", text: text.results(facts.results) };
    case "PARTY": return { tone: "OPEN", text: text.party };
    case "SETTINGS": return { tone: "DONE", text: pickTexts(language, raceTypeSv, raceTypeEn).types[raceType].name };
  }
}
