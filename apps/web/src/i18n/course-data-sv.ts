import { plural } from "./plural";
/** En banfil (IOF XML) utan .ppen i banläggningen, och besked när en ändring i banläggningen inte sparades. */
export const courseDataSv = {
  /** Banor → Banfil, efter att banfilen lästs in i tävlingen. */
  offer: {
    heading: "Banläggningen",
    empty: "Banläggningen har inga banor än. Lägg banfilens banor där, så kan du flytta starten och kontrollerna på kartan.",
    create: "Lägg banorna i banläggningen",
    existing: "Banläggningen har redan banor. Banfilens banor kan ersätta dem.",
    replace: "Ersätt banläggningens banor …",
    confirm: "Ersätt banläggningens banor med banfilens? Den nuvarande banläggningen sparas som en tidigare version och går att återställa under Fil → Tidigare versioner.",
    confirmYes: "Ja, ersätt",
    cancel: "Avbryt",
    working: "Lägger banorna i banläggningen …",
    done: "Banorna finns i banläggningen.",
    open: "Öppna banläggningen"
  },
  problems: {
    invalid: "Banfilen kunde inte läsas som banor på kartan.",
    noScale: "Banfilen säger inte kartans skala.",
    notPlaced: (detail: string) => `${detail.replace(/\.$/, "")}. Banorna kan inte läggas på kartan.`
  },
  /** Beskedet i editorn efter Använd igen eller Banfil. */
  fromCourseData: (courses: number, controls: number) =>
    `Banorna kommer från banfilen (${plural(courses, "bana", "banor")}, ${plural(controls, "kontroll", "kontroller")}). Kontrollbeskrivningarna är tomma.`,
  /** Ett sparande som servern inte tog emot (efter ett tyst nytt försök). */
  saveFailed: "Ändringen sparades inte – försök igen.",
  retry: "Försök igen",
  startConflict: "Någon annan började banläggningen samtidigt, så filen lästes inte in. Läs in den under Fil om den ska ersätta banorna."
};

/** Banläggningen i rogaining och fest (ägaren 2026-11-03: Banläggning syns för alla tävlingstyper). */
export const courseSettingRaceTypeSv = {
  ROGAINING: "Rogaining: nya banor blir poängbanor. Utan satta poäng ger kontrollkodens första siffra poängen (IRF:s regel C9). Poängen följer med när du överför till tävlingen.",
  PARTY: "Fest: banläggningen ger kartor att skriva ut. Festen har inga banor i tävlingen, så Överför till tävlingen finns inte här."
} as const;
