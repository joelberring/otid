import type { RaceType } from "@o-tid/contracts";

/**
 * ADR-0170 beslut 1: tävlingstypen styr vilka delar av arbetsytan som syns och vilka förval som gäller.
 * Det här är den enda platsen som avgör det. Typen är en vy: funktionerna och data finns kvar i den
 * gemensamma kärnan, bara synligheten skiljer.
 */

/** Delarna i sidopanelen, i banans ordning. Inställningar ligger alltid sist, utanför banan. */
export type SectionId = "COURSES" | "CLASSES" | "ENTRIES" | "START" | "READOUT" | "RESULTS" | "SETTINGS";

/** Det innehåll som en del visar. En del kan visa flera (Träning: banor och klasser på samma ställe). */
export type Panel = "COURSES" | "CLASSES" | "ROGAINING_NOTE" | "ENTRIES" | "START" | "READOUT" | "RESULTS" | "SETTINGS";

/** Delens namn; texterna finns i i18n (`raceTypeSv.sections`). */
export type SectionLabel = "COURSES" | "COURSES_CLASSES" | "CONTROLS_POINTS" | "CLASSES" | "CLASSES_LEGS" | "ENTRIES" |
  "PARTICIPANTS" | "TEAMS" | "START" | "READOUT" | "RESULTS" | "SETTINGS";

export type Section = { id: SectionId; label: SectionLabel; panels: readonly Panel[] };

export type RaceTypeFeatures = {
  /** Lottning i Start. */ draw: boolean;
  /** Egen speakersida. */ speaker: boolean;
  /** Import (IOF XML, Eventor i steg 14) under Inställningar. */ import: boolean;
  /** Fastställande i Resultat. */ finalization: boolean;
  /** Stafettklasser, lag och sträckor. */ relay: boolean;
  /** Banvarianter (gafflingar). */ variants: boolean;
  /** Banor visar varianterna och gafflingskontrollen utfällda. */ variantsProminent: boolean;
  /** Arrangören väljer startsätt per klass. Annars alltid fri start; nya klasser får fri start och lottningen sätter minutstart. */
  startRuleChoice: boolean;
};

export type RaceTypeProfile = {
  type: RaceType;
  /** Delarna längs banan, från start till mål (Resultat). */
  course: readonly Section[];
  settings: Section;
  features: RaceTypeFeatures;
};

const section = (id: SectionId, label: SectionLabel, panels: readonly Panel[] = [id as Panel]): Section => ({ id, label, panels });
const courses = section("COURSES", "COURSES");
const classes = section("CLASSES", "CLASSES");
const entries = section("ENTRIES", "ENTRIES");
const start = section("START", "START");
const readout = section("READOUT", "READOUT");
const results = section("RESULTS", "RESULTS");
const settings = section("SETTINGS", "SETTINGS");

const none: RaceTypeFeatures = { draw: false, speaker: false, import: false, finalization: false, relay: false, variants: false,
  variantsProminent: false, startRuleChoice: false };
const competition: RaceTypeFeatures = { ...none, draw: true, speaker: true, import: true, finalization: true, startRuleChoice: true };

const profiles: Record<RaceType, Omit<RaceTypeProfile, "type" | "settings">> = {
  TRAINING: {
    course: [section("COURSES", "COURSES_CLASSES", ["COURSES", "CLASSES"]), section("ENTRIES", "PARTICIPANTS"), readout, results],
    features: none
  },
  SMALL: {
    course: [courses, classes, entries, start, readout, results],
    features: { ...none, startRuleChoice: true }
  },
  STANDARD: {
    course: [courses, classes, entries, start, readout, results],
    features: competition
  },
  FORKED: {
    course: [courses, classes, entries, start, readout, results],
    features: { ...competition, variants: true, variantsProminent: true }
  },
  RELAY: {
    course: [courses, section("CLASSES", "CLASSES_LEGS"), section("ENTRIES", "TEAMS"), start, readout, results],
    features: { ...none, speaker: true, finalization: true, relay: true, variants: true, startRuleChoice: true }
  },
  ROGAINING: {
    course: [section("COURSES", "CONTROLS_POINTS", ["ROGAINING_NOTE", "COURSES", "CLASSES"]), section("ENTRIES", "PARTICIPANTS"),
      readout, results],
    features: none
  }
};

export function raceTypeProfile(type: RaceType): RaceTypeProfile {
  return { type, settings, ...profiles[type] };
}

/** Alla delar som typen visar: banans delar och Inställningar. */
export function visibleSections(profile: RaceTypeProfile): readonly Section[] {
  return [...profile.course, profile.settings];
}

/** Delen med ett visst id, eller undefined om typen inte visar den. */
export function sectionById(profile: RaceTypeProfile, id: SectionId): Section | undefined {
  return visibleSections(profile).find(row => row.id === id);
}

/** Den del som visar ett visst innehåll (t.ex. klasserna ligger i "Banor & klasser" för Träning). */
export function sectionForPanel(profile: RaceTypeProfile, panel: Panel): Section | undefined {
  return visibleSections(profile).find(row => row.panels.includes(panel));
}

/** Delen som ska visas: den valda om typen har den, annars banans första del. */
export function activeSection(profile: RaceTypeProfile, id: SectionId): Section {
  return sectionById(profile, id) ?? profile.course[0]!;
}
