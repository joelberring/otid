/** Frågan när en delad kontroll flyttas långt i en bana (som i Purple Pen). */
export const moveSharedSv = {
  heading: (code: string) => `Flytta kontroll ${code}?`,
  intro: (code: string, meters: number, course: string) => `Du flyttar ${code} ${meters} m på ${course}. Kontrollen finns också på:`,
  /** Knapparna: "Flytta i alla banor (3)" och "Ny kontroll bara i Lång" (hjälpen citerar början). */
  all: "Flytta i alla banor",
  allHelp: "Samma kontroll, nytt läge för alla banor.",
  newOnly: "Ny kontroll bara i",
  newHelp: (code: string, old: string) => `Kontroll ${code} på det nya läget; ${old} står kvar för de andra banorna. Beskrivningen fylls i på nytt.`,
  cancel: "Avbryt",
  cancelHelp: "Kontrollen går tillbaka.",
  occurrencesAll: (count: number) => `Kontrollen finns ${count} gånger på banan (samma ring); alla byts.`,
  occurrencesOne: (count: number) => `Kontrollen finns ${count} gånger på banan; bara den i visad variant byts.`,
  remember: "Kom ihåg för den här sessionen",
  rememberedAll: (code: string) => `${code} flyttades i alla banor (valet du sparat för sessionen).`,
  rememberedNew: (code: string, old: string, course: string) => `Ny kontroll ${code} bara i ${course}; ${old} står kvar (valet du sparat för sessionen).`,
  created: (code: string, old: string, course: string) => `Ny kontroll ${code} i ${course}; ${old} står kvar i de andra banorna.`,
  settings: {
    heading: "Flytta delade kontroller",
    threshold: "Fråga när en kontroll som finns i flera banor flyttas mer än",
    meters: (meters: number) => `${meters} m`,
    help: (mm: string, scale: number) => `Mindre flyttar frågar aldrig. På kartan i 1:${scale.toLocaleString("sv-SE")} är det ${mm} mm. Purple Pen frågar vid 50 m.`,
    remembered: (choice: "ALL" | "NEW") => `Sparat för sessionen: ${choice === "ALL" ? "flytta i alla banor" : "ny kontroll bara i banan"}.`,
    notRemembered: "Inget val sparat: frågan visas.",
    reset: "Fråga igen"
  }
} as const;
