import { startRuleSv as rule } from "./start-rule-sv";
/** Klasser som tabell med redigering i raden (ADR-0169 beslut 4). */
export const classTableSv = {
  title: "Klasser",
  help: "Ändra klassens namn, bana eller startsätt i raden. Resultaten räknas om när du sparar.",
  className: "Klass", course: "Bana", startRule: rule.label, entries: "Anmälda", readOut: "Avlästa / resultat",
  status: "Status", action: "Ändra",
  free: rule.rules.PUNCH, fixed: rule.rules.FIXED, mass: rule.methods.MASS,
  open: "Redigera", openLabel: (name: string) => `Redigera ${name}`,
  readOutValue: (readOut: number, results: number) => `${readOut} / ${results}`,
  loading: "Läser in klasserna…", retryList: "Läs in klasserna igen",
  statusNoEntries: "Inga anmälda",
  statusMissingStartTimes: (count: number) => `${count} saknar starttid`,
  statusMissingStartTimesOpen: (name: string, count: number) => `Visa de ${count} i ${name} som saknar starttid`,
  /** ADR-0188 beslut 4: inte klar så länge någon i en gafflad klass saknar variant. */
  statusMissingVariants: (count: number) => `Inte klar: ${count} saknar variant`,
  statusAllReadOut: "Alla har läst ut",
  statusWaiting: (count: number) => `${count} har inte läst ut`,
  statusReady: "Klar för start",
  fieldName: "Klassnamn", fieldCourse: "Bana", fieldStartRule: rule.label,
  /** Maxtid (PLAN.md steg 25): tomt = ingen gräns. */
  fieldMaxTime: "Maxtid (minuter)", maxTimeHelp: "Lämna tomt för ingen maxtid.",
  maxTimeInvalid: "Maxtid: skriv hela minuter (1–1440) eller lämna tomt.",
  sourceName: (name: string) => `I Eventor/importen: ${name}. En ny hämtning ändrar inte ditt namn.`,
  sourceNameShort: (name: string) => `Importerad som ${name}`,
  useSourceName: "Använd importens namn",
  massStart: "Masstart kl.",
  massStartHelp: "Skriv klockslaget och tryck Spara ändringen. Alla i klassen får starttiden, också de som anmäler sig sent, och tiden räknas från masstarten utan startstämpling.",
  massStartPlaceholder: "tt:mm",
  /** Klasstabellens startsätt när klassen har masstart. */
  massStartAt: (clock: string) => `Masstart ${clock}`,
  massStartInvalid: "Skriv en hel minut, till exempel 19:00.",
  massStartConfirm: "Klassen har redan starttider eller avlästa löpare. Ersätta dem med masstarten?",
  massStartConfirmRecalculate: (clock: string, recalculated: number) =>
    `Byta masstarten till kl. ${clock}? ${recalculated === 1 ? "1 avläst löpare" : `${recalculated} avlästa löpare`} får resultatet omräknat med den nya starttiden.`,
  massStartSaved: (clock: string) => `Masstart kl. ${clock} är satt för klassen. Alla anmälda har starttiden ${clock}; se Anmälda.`,
  massStartSavedRecalculated: (clock: string, recalculated: number) =>
    `Masstart kl. ${clock} är satt för klassen. ${recalculated} resultat räknades om med den nya starttiden.`,
  massStartError: "Masstarten kunde inte sparas. Försök igen.",
  preview: "Visa vad som händer", save: "Spara ändringen", cancel: "Avbryt",
  invalidName: "Skriv ett klassnamn.",
  unchanged: "Inget är ändrat. Inget att spara.",
  nobodyReadOut: "Ingen i klassen har läst ut. Ändringen påverkar inga resultat.",
  clearedStartTimes: (count: number) => count === 1
    ? "1 fast starttid tas bort eftersom startsättet ändras."
    : `${count} fasta starttider tas bort eftersom startsättet ändras.`,
  confirmHelp: "Tryck på Spara ändringen för att ändra klassen och räkna om resultaten.",
  noStatusChange: "Ingen löpare får ny status. Ändringen kan sparas direkt.",
  previewError: "Det gick inte att visa vad som händer. Försök igen.",
  conflict: "Tävlingen har ändrats under tiden. Klasserna är inlästa igen; visa vad som händer en gång till.",
  rejected: "Ändringen kunde inte sparas. Kontrollera uppgifterna och försök igen.",
  duplicateName: (name: string) => `Det finns redan en klass som heter ${name} i tävlingen. Välj ett annat namn.`,
  unknown: "Kunde inte nå servern. Försök igen.",
  saved: (count: number) => count === 0 ? "Klassen är ändrad." : `Klassen är ändrad. ${count} resultat räknades om.`,
  savedLoadError: "Klassen är ändrad, men listan kunde inte uppdateras. Läs in klasserna igen."
} as const;
