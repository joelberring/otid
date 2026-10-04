/** Lottning i arbetsytans Start-steg (PLAN.md steg 9). Tider skrivs som klockslag. */
const names = (list: readonly string[]) =>
  list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} och ${list[list.length - 1]}`;

export const startDrawSv = {
  title: "Lottning",
  help: "Välj startsätt för klasserna och kryssa i de som ska lottas. Klasser vars banor har samma första kontroll startar aldrig samma minut. Vakanser sprids i klassen och efteranmälda får första lediga vakanta tid.",
  load: "Visa klasserna", loading: "Läser klasserna…",
  first: "Första start (klockslag)", firstExample: "10:00",
  clubSeparation: "Klubbseparering: två från samma klubb startar inte efter varandra",
  className: "Klass", method: "Startsätt", interval: "Intervall (min)", vacancies: "Vakanser", draw: "Lotta", entries: "Anmälda",
  methods: { FREE: "Fri start", MINUTE: "Lottad minutstart", MASS: "Masstart" },
  vacancyKinds: { COUNT: "st", PERCENT: "%" },
  vacancyKind: "Vakanser som",
  hasTimes: "Har starttider",
  drawClass: (className: string) => `Lotta ${className}`,
  preview: "Visa lottning", save: "Spara lottningen", replaceAndSave: "Ersätt starttiderna och spara", cancel: "Ändra inställningarna",
  noneSelected: "Kryssa i minst en klass att lotta.",
  invalid: "Skriv första start som klockslag (till exempel 10:00), intervall 1–60 minuter och vakanser som ett heltal (högst 100 %).",
  error: "Kunde inte visa lottningen. Försök igen.",
  saveError: "Lottningen kunde inte sparas. Visa lottningen igen.",
  unknown: "Kunde inte nå servern. Appen försöker igen när du trycker på knappen.",
  conflict: "Något har ändrats sedan lottningen visades. Visa lottningen igen.",
  saved: "Lottningen är sparad. Har startlistan redan publicerats behöver den publiceras igen.",
  previewTitle: "Så blir startlistan",
  vacant: "Vakant",
  time: "Start", name: "Namn", club: "Klubb", card: "Bricka", none: "–",
  freeStart: "Fri start: löparna stämplar start. Klassen får inga starttider.",
  massStart: (time: string) => `Masstart ${time}: alla i klassen startar samtidigt.`,
  minuteStart: (time: string, interval: number, vacancies: number) =>
    `Första start ${time}, ${interval} min mellan starterna${vacancies === 1 ? ", 1 vakant tid" : vacancies > 1 ? `, ${vacancies} vakanta tider` : ""}.`,
  empty: "Inga anmälda.",
  alternating: (classNames: readonly string[]) => `${names(classNames)} har samma första kontroll och startar varannan minut.`,
  sameFirstControl: (classNames: readonly string[], code: number) =>
    `${names(classNames)} har samma första kontroll (${code}) och startar aldrig samma minut.`,
  replaces: (classNames: readonly string[]) => `${names(classNames)} har redan starttider. De ersätts av den nya lottningen.`,
  readOut: (count: number) => `${count} har läst ut och får resultatet omräknat med den nya starttiden.`,
  statusChanges: (count: number) => `${count} byter status (godkänd eller felstämplad) när resultatet räknas om.`
} as const;
