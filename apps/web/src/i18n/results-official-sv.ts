/** "Resultaten är klara" (PLAN.md steg 27): en knapp i stället för fastställande i två steg. */
export const resultsOfficialSv = {
  title: "Resultaten är klara",
  help: "När alla har kommit i mål och resultaten stämmer: tryck på knappen. Listorna märks Officiella resultat och du får IOF-filen att ladda upp i Eventor. Det går att ångra.",
  mark: "Resultaten är klara",
  markAgain: "Resultaten är klara igen",
  undo: "Gör resultaten preliminära igen",
  download: "Ladda ner IOF-fil för Eventor",
  official: (when: string) => `Officiella resultat sedan ${when}.`,
  changed: (when: string) =>
    `Resultaten har ändrats sedan de blev klara ${when}. Listorna visas som preliminära tills du trycker på knappen igen.`,
  preliminary: "Listorna visas som Preliminära resultat.",
  markedOfficial: "Resultaten är klara. Listorna visar Officiella resultat.",
  markedPreliminary: "Resultaten är preliminära igen.",
  blockedTitle: "Det här måste ordnas först:",
  blockedClass: (className: string, reasons: string) => `${className}: ${reasons}`,
  missingResults: "Några har inget resultat. Läs av dem, eller markera dem som ej start under Efterarbete.",
  /** Steg 38: hindret för en löpare och vad man gör åt det; "Öppna" visar deltagarkortet. */
  entryIssue: (className: string, name: string, what: string) => `${className}: ${name} ${what}`,
  entryIssues: {
    MISSING_RESULT_REVISION: "har inget resultat och kan vara kvar i skogen. Läs av brickan, eller sätt Ej start eller Brutit i deltagarkortet.",
    WITHDRAWN_DID_NOT_START: "har inget resultat sedan beslutet togs bort. Läs av brickan eller fatta ett nytt beslut i deltagarkortet.",
    LATEST_RESULT_UNPUBLISHED: "har ett resultat som inte är publicerat. Räkna om från avläsningen i deltagarkortet.",
    INVALID_RESULT_REVISION: "har ett resultat som inte går att kontrollera mot banan. Välj variant eller räkna om från avläsningen i deltagarkortet.",
    RESULT_CLASS_MISMATCH: "har ett resultat som bygger på en annan klass. Räkna om från avläsningen i deltagarkortet.",
    RESULT_COURSE_MISMATCH: "har ett resultat som bygger på en äldre bana. Räkna om från avläsningen i deltagarkortet.",
    STALE_RESULT_SNAPSHOT: "har ett resultat som bygger på en äldre bana eller klass. Räkna om från avläsningen i deltagarkortet."
  } as Partial<Record<string, string>>,
  /** Steg 38: felstämplade som inte är bekräftade stoppar inte, men visas som information. */
  unconfirmedMispunched: (count: number) => `${count} ${count === 1 ? "felstämplad är inte bekräftad" : "felstämplade är inte bekräftade"}. Det stoppar inte att resultaten blir klara.`,
  openEntry: "Öppna",
  openEntryFor: (name: string) => `Öppna deltagarkortet för ${name}`,
  unknownCards: "Det finns okända brickor som inte är hanterade. Koppla dem till en deltagare eller direktanmäl under Avläsning → Okända brickor.",
  loading: "Läser in …",
  loadError: "Läget kunde inte läsas in.",
  conflict: "Resultaten ändrades medan du tryckte. Försök igen.",
  unreachable: "Kunde inte nå servern. Försök igen.",
  retry: "Försök igen",
  downloaded: "IOF-filen är nedladdad.",
  downloadError: "IOF-filen kunde inte laddas ner. Försök igen.",
  advanced: "Avancerat: fastställ en klass i taget",
  advancedHelp: "Behövs sällan. Fastställ en färdig klass medan andra klasser pågår. Resultaten är klara gör det för alla klasser."
} as const;
