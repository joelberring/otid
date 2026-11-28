import { startRuleSv as rule } from "./start-rule-sv";
/** Lottning i arbetsytans Start-steg (PLAN.md steg 9). Tider skrivs som klockslag. */
const names = (list: readonly string[]) =>
  list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} och ${list[list.length - 1]}`;

export const startDrawSv = {
  title: "Lottning",
  help: "Ställ in startsätt, intervall och vakanser en gång för alla klasser och tryck på Använd för alla. Ändra sedan bara de klasser som ska avvika. Klasser vars banor har samma första kontroll startar aldrig samma minut. Vakanser sprids i klassen och efteranmälda får första lediga vakanta tid.",
  load: "Visa klasserna", loading: "Läser klasserna…",
  first: "Första start (klockslag)", firstExample: "10:00",
  /** ADR-0188 beslut 2: en enda första start för tävlingen; Inställningar visar den och länkar hit. */
  firstHelp: "Tävlingens första start. Sparas med lottningen och visas för löparna (står också under Inställningar).",
  common: {
    title: "Gemensamt för klasserna",
    help: "Värdena läggs på alla klasser, eller bara på de ikryssade. Ändra sedan enstaka klasser i tabellen.",
    methodLabel: "Startsätt för klasserna", intervalLabel: "Intervall (min) för klasserna", vacanciesLabel: "Vakanser för klasserna",
    vacancyKindLabel: "Vakanser för klasserna som",
    laterStart: "Klassernas första start (valfritt)",
    laterStartHelp: "Klockslag om klasserna ska börja senare än tävlingens första start. Tomt = som förut.",
    applyAll: "Använd för alla",
    applySelected: (count: number) => `Använd för valda (${count})`,
    applied: (count: number) => `${count === 1 ? "Inställningarna är ifyllda för 1 klass" : `Inställningarna är ifyllda för ${count} klasser`}. Inget är sparat än: tryck Visa lottning och sedan Spara lottningen.`,
    noneSelected: "Kryssa i klasserna först, eller använd för alla."
  },
  selectAll: "Lotta alla klasser",
  laterStartShort: (time: string) => `Första start ${time}`,
  massStartClock: "Masstart kl.",
  massStartSavedShort: (time: string) => `Masstart ${time}`,
  massStartInvalid: "Skriv en hel minut, till exempel 19:10.",
  waves: {
    title: "Masstartstider",
    help: "Skjuts en masstart upp på tävlingsdagen? Flytta hela starten på en gång. Alla i klasserna, efteranmälda och eventuella avlästa resultat uppdateras automatiskt.",
    entries: (count: number) => `${count} anmälda`,
    shift: "Flytta masstart",
    shiftLabel: (clock: string) => `Flytta masstart ${clock}`,
    newTime: "Ny masstart kl.",
    nudge: (delta: number) => `${delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`} min`,
    nudgeLabel: (delta: number, clock: string) => `${delta > 0 ? "Senarelägg" : "Tidigarelägg"} ${clock} med ${Math.abs(delta)} min`,
    delta: (from: string, to: string, delta: number) => `${from} → ${to} (${delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`} min)`,
    apply: "Flytta masstart",
    applyAt: (clock: string) => `Flytta till ${clock}`,
    cancel: "Avbryt",
    invalid: "Skriv en hel minut, till exempel 19:14.",
    unchanged: "Välj en annan tid än den nuvarande.",
    error: "Masstarten kunde inte flyttas. Försök igen.",
    confirmTitle: "Flytta masstart",
    confirmMove: (classNames: readonly string[], from: string, to: string, delta: number) =>
      `Flytta ${names(classNames)} från ${from} till ${to} (${delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`} min)?`,
    confirmEntries: (count: number, clock: string) =>
      count === 0 ? `Klassen har inga anmälda än. Efteranmälda får starttid ${clock}.`
        : `${count === 1 ? "1 anmäld" : `${count} anmälda`} får starttid ${clock} (även efteranmälda).`,
    confirmAction: "Flytta och spara",
    shifted: (classNames: readonly string[], from: string, to: string, recalculated: number) =>
      `Masstarten flyttad från ${from} till ${to} för ${names(classNames)}.` +
      (recalculated > 0 ? ` ${recalculated} resultat räknades om.` : "")
  },
  clubSeparation: "Klubbseparering: två från samma klubb startar inte efter varandra",
  className: "Klass", method: rule.label, interval: "Intervall (min)", vacancies: "Vakanser", draw: "Lotta", entries: "Anmälda",
  methods: rule.methods,
  vacancyKinds: { COUNT: "st", PERCENT: "%" },
  vacancyKind: "Vakanser som",
  hasTimes: "Har starttider",
  drawClass: (className: string) => `Lotta ${className}`,
  /** Ägaren 2026-11-15: valen i tabellen såg ut att gälla fast lottningen inte var sparad. */
  unsaved: (count: number) => `Inte sparat: ${count === 1 ? "1 klass har" : `${count} klasser har`} ett annat startsätt här än det som gäller nu. Löparna får startsättet och tiderna först när du trycker Visa lottning och sedan Spara lottningen.`,
  unsavedAction: "Förhandsvisa",
  preview: "Visa lottning", save: "Spara lottningen", replaceAndSave: "Ersätt starttiderna och spara", cancel: "Ändra inställningarna",
  noneSelected: "Kryssa i minst en klass att lotta.",
  invalid: "Skriv första start som klockslag (till exempel 10:00), intervall 1–60 minuter och vakanser som ett heltal (högst 100 %).",
  error: "Kunde inte visa lottningen. Försök igen.",
  saveError: "Lottningen kunde inte sparas. Visa lottningen igen.",
  unknown: "Kunde inte nå servern. Appen försöker igen när du trycker på knappen.",
  conflict: "Något har ändrats sedan lottningen visades. Visa lottningen igen.",
  saved: "Lottningen är sparad. Har startlistan redan publicerats behöver den publiceras igen.",
  previewTitle: "Så blir startlistan",
  previewHelp: "En rad per klass. Öppna en klass för att se löparna och tiderna.",
  expandAll: "Visa alla löpare", collapseAll: "Dölj alla löpare",
  summaryClass: "Klass", summaryMethod: "Startsätt", summaryRunners: "Löpare", summaryTimes: "Första–sista start",
  summaryRunnersValue: (runners: number, vacant: number) => `${runners}${vacant > 0 ? ` + ${vacant} vakant${vacant === 1 ? "" : "a"}` : ""}`,
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
