import type { RemovalBlocker } from "@o-tid/contracts";

const names = (values: readonly string[]) => values.length <= 1 ? values.join("")
  : `${values.slice(0, -1).join(", ")} och ${values[values.length - 1]}`;

/** Ta bort och stryk (PLAN.md steg 27): deltagare, klass och bana, med besked om vad som måste flyttas först. */
export const removalSv = {
  entryHeading: "Ta bort eller stryk",
  entryDelete: "Ta bort deltagare",
  entryStrike: "Stryk",
  entryDeleteHelp: "Deltagaren har inte läst ut och kan tas bort helt.",
  entryStrikeHelp: "Deltagaren har läst ut eller har ett resultat. Stryk gömmer deltagaren i alla listor men sparar avläsningen och historiken.",
  entryDeleteConsequence: (name: string) => `${name} tas bort ur tävlingen. Brickan och en lottad starttid blir lediga. Det går inte att ångra.`,
  entryStrikeConsequence: (name: string) =>
    `${name} stryks och syns inte längre i någon lista, inte heller publikt. Avläsningen och historiken sparas och brickan blir ledig.`,
  confirmDelete: "Ta bort", confirmStrike: "Stryk deltagaren", cancel: "Avbryt", retry: "Försök igen",
  entryDeleted: (name: string) => `${name} är borttagen.`,
  entryStruck: (name: string) => `${name} är struken.`,
  classDelete: "Ta bort klass",
  classDeleteLabel: (name: string) => `Ta bort klassen ${name}`,
  classDeleteConsequence: (name: string) => `Klassen ${name} tas bort. Det går inte att ångra.`,
  classDeleted: (name: string) => `Klassen ${name} är borttagen.`,
  courseDelete: "Ta bort bana",
  courseDeleteLabel: (name: string) => `Ta bort banan ${name}`,
  courseDeleteConsequence: (name: string) => `Banan ${name} tas bort. Kontrollerna finns kvar. Det går inte att ångra.`,
  courseDeleted: (name: string) => `Banan ${name} är borttagen.`,
  blocked: (blocker: RemovalBlocker, detail: { count?: number | undefined; names?: readonly string[] | undefined }) => {
    switch (blocker) {
      case "HAS_RESULT": return "Deltagaren har ett resultat och kan inte tas bort. Stryk deltagaren i stället.";
      case "RELAY_RUNNER": return "Sträcklöpare tas inte bort här. Byt sträcklöpare under Lag.";
      case "CLASS_HAS_ENTRIES": return `Klassen har ${detail.count ?? 0} anmälda. Flytta dem till en annan klass eller ta bort dem först.`;
      case "CLASS_HAS_HISTORY": return "Klassen har strukna deltagare eller lag med historik och kan inte tas bort.";
      case "COURSE_USED_BY_CLASS": return `Banan används av ${names(detail.names ?? [])}. Byt bana på ${(detail.names?.length ?? 0) === 1 ? "klassen" : "klasserna"} först.`;
      case "COURSE_HAS_RESULTS": return "Det finns resultat som bedömts mot banan, så den kan inte tas bort.";
    }
  },
  changed: "Deltagaren har ändrats sedan du öppnade kortet. Läs in och försök igen.",
  error: "Det gick inte att ta bort. Försök igen.",
  unreachable: "Kunde inte nå servern. Försök igen."
} as const;
