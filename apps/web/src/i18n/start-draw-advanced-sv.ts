/** Lottningens "Avancerat" och förhandsvisningens regelbrott (PLAN.md steg 26). Tider skrivs som klockslag. */
const names = (list: readonly string[]) =>
  list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} och ${list[list.length - 1]}`;
const minutes = (count: number) => count === 1 ? "1 minut" : `${count} minuter`;

export const startDrawAdvancedSv = {
  title: "Avancerat",
  changed: "inställningar ändrade",
  help: "Inställningarna sparas med lottningen och finns kvar nästa gång. Klasser som inte är ikryssade behåller sina tider; de nya tiderna läggs runt dem.",
  selectAll: "Kryssa i alla klasser", selectUndrawn: "Kryssa i klasser utan starttider",
  rulesHeading: "Regler för hela starten",
  groupControls: "Startgrupp avgörs av de första",
  groupControlsOptions: { "1": "1 kontrollen", "2": "2 kontrollerna", "3": "3 kontrollerna" },
  groupControlsHelp: "Klasser vars banor börjar med samma kontroller startar aldrig samma minut. En gafflad klass räknas till gruppen om någon av dess varianter börjar likadant.",
  maxPerMinute: "Max starter per minut (totalt)",
  maxPerMinutePerPen: "Max starter per minut och startfålla",
  limitHelp: "Lämna tomt för ingen gräns. Vakanta tider räknas; en masstart räknas som en start.",
  penHelpSingle: "Med en kontroll startar varje fålla en klass i taget. Taket per fålla gäller när fler kontroller avgör startgruppen.",
  penHelp: "Startfålla = klasser vars banor har samma första kontroll.",
  lastStart: "Sista start (klockslag, valfritt)",
  lastStartHelp: "Förhandsvisningen varnar om starterna inte ryms.",
  orderHeading: "Startordning och senare start",
  orderHelp: "Klasserna lottas i den här ordningen: högre upp startar tidigare i sin startgrupp. En klass med senare start placeras först på sin tid och de andra fyller runt den.",
  orderAutomatic: "Automatisk ordning: masstart först, sedan största klassen.",
  orderCustom: "Egen ordning.",
  orderReset: "Använd automatisk ordning",
  position: "Ordning", className: "Klass", firstStart: "Första start",
  moveUp: (className: string) => `Flytta ${className} upp`, moveDown: (className: string) => `Flytta ${className} ned`,
  laterKind: (className: string) => `Första start ${className}`,
  laterValue: (className: string) => `Tid för första start ${className}`,
  laterKinds: { NONE: "Med de andra", CLOCK: "Klockslag", OFFSET: "Minuter efter första start" },
  laterPlaceholder: { CLOCK: "10:30", OFFSET: "60" },
  notDrawn: "Inte ikryssad",
  seedingHeading: "Seedning",
  seedingHelp: "Seedade löpare lottas efter de andra i klassen; 1 är bäst och startar sist. Övriga lottas fritt före.",
  seeding: "Seedade lottas", seedingOptions: { LAST: "Sist i klassen (bäst sist)", SPREAD: "Jämnt utspridda (bäst sist)" },
  seedClass: "Visa löpare i klassen",
  seedRank: "Seedning (1 = bäst)",
  seedLabel: (name: string) => `Seedning ${name}`,
  seededCount: (count: number) => count === 1 ? "1 seedad" : `${count} seedade`,
  noEntries: "Inga anmälda i klassen.",
  name: "Namn", club: "Klubb", card: "Bricka", none: "–",
  importLabel: "Importera ranking (CSV)",
  importHelp: "En rad per löpare: placering och namn, gärna klubb och bricka (till exempel Placering;Namn;Klubb;Bricka). Löparna matchas på bricka, annars på namn och klubb.",
  imported: (count: number) => count === 1 ? "1 löpare fick seedning från filen." : `${count} löpare fick seedning från filen.`,
  importUnmatched: (count: number) => count === 1 ? "1 rad passade ingen anmäld:" : `${count} rader passade ingen anmäld:`,
  importLine: (line: number, text: string) => `rad ${line}: ${text}`,
  importError: "Filen kunde inte läsas. Spara den som CSV (semikolon eller komma) och försök igen.",
  clearSeeds: "Ta bort seedningen i klassen",
  errors: {
    limit: "Skriv ett heltal 1–1000 eller lämna tomt.",
    lastStart: "Skriv sista start som klockslag, till exempel 12:00, eller lämna tomt.",
    lastStartBefore: "Sista start kan inte vara före första start.",
    clock: "Skriv klockslag, till exempel 10:30, efter första start.",
    offset: "Skriv minuter efter första start, 1–1440.",
    seed: "Skriv ett heltal 1–10000 eller lämna tomt.",
    summary: "Rätta fälten under Avancerat."
  },
  // Förhandsvisningen
  warningsTitle: "Regler som inte går att hålla",
  afterLastStart: (classNames: readonly string[], lastStart: string, firstAfter: string, needed: string) =>
    `Startfönstret räcker inte: ${names(classNames)} får starter efter sista start ${lastStart} (från ${firstAfter}). Sista start behöver vara ${needed}, eller höj max starter per minut.`,
  laterMoved: (className: string, wanted: string, actual: string) =>
    `${className} kan inte starta ${wanted} utan krock och startar ${actual}.`,
  existingOverLimit: (scope: "TOTAL" | "PEN", limit: number, first: string, count: number) =>
    `Befintliga tider har redan fler än ${limit} ${scope === "TOTAL" ? "starter per minut" : "starter per minut i en startfålla"} (${minutes(count)}, första ${first}).`,
  existingClash: (classNames: readonly string[], first: string, count: number) =>
    `${names(classNames)} har redan tider i samma startgrupp samma minut (${minutes(count)}, första ${first}).`,
  existingTitle: "Behåller sina tider",
  existingClass: (className: string, count: number, first: string, last: string) =>
    `${className} (${count === 1 ? "1 start" : `${count} starter`} ${first === last ? first : `${first}–${last}`})`,
  timelineTitle: "Minut för minut",
  timelineHelp: "Var de nya tiderna hamnar bland de befintliga. Nya tider är märkta Ny.",
  timelineTime: "Minut", timelineStarts: "Starter",
  newTag: "Ny", existingTag: "Befintlig",
  startCount: (count: number) => count === 1 ? "" : ` ×${count}`,
  seededSlot: (rank: number) => `seedad ${rank}`,
  sameControls: (classNames: readonly string[], codes: readonly number[]) =>
    `${names(classNames)} börjar med samma kontroller (${codes.join(", ")}) och startar aldrig samma minut.`
} as const;
