import { mb } from "@o-tid/club-archive";

/**
 * ADR-0204: importen till klubbarkivet i webbläsaren (fliken Import). Enkel svenska för den som inte kan Git: välj mappen,
 * förhandsgranska, importera.
 */
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const clubWebImportSv = {
  title: "Importera klubbens gamla träningar",
  intro: "Välj mappen med träningarna, eller zip-filerna du laddat ner från Google Drive. O-Tid letar fram kartor och banfiler och visar vad som hittas innan något skickas.",
  privacy: "PDF, Word, Excel, bilder, startlistor och resultat öppnas aldrig och lämnar aldrig din dator. Bara kartfiler (.ocd, .omap, .xmap) och banfiler (.ppen, IOF CourseData) skickas.",
  chooseFolder: "Välj mapp",
  chooseFiles: "Välj filer",
  drop: "… eller dra mappar och zip-filer hit.",
  dropActive: "Släpp för att lägga till.",
  folderHint: "Välj den mapp som har årsmapparna (2018, 2019 …) i sig, så får träningarna rätt år.",
  phoneNote: "Importen fungerar bäst på en dator. Där kan du välja hela mappen med klubbens träningar.",
  chosenTitle: "Valt",
  chosenFolder: (name: string, files: number) => `Mappen ${name} (${plural(files, "fil", "filer")})`,
  chosenFile: (name: string, bytes: number) => `${name} (${mb(bytes)})`,
  clear: "Rensa",
  leaders: "Ta inte med ledarens namn ur [hakparenteser]",
  leadersHint: "Ledarnas namn i mappnamnen är personuppgifter. I kommandot heter samma val",
  preview: "Förhandsgranska",
  scanning: (done: number, total: number) => `Läser ${done} av ${total} filer …`,
  opening: "Öppnar filerna …",
  checking: "Frågar servern vad som redan finns …",
  cancel: "Avbryt",
  start: "Importera",
  startAgain: "Importera igen",
  report: "Ladda ner rapporten",
  chooseOther: "Välj andra filer",
  previewTitle: "Förhandsgranskning – inget är skickat än",
  trainings: (count: number) => `${plural(count, "träning", "träningar")} hittades`,
  trainingsNew: (fresh: number, existing: number) => existing === 0 ? `Alla är nya.` : `${fresh} nya, ${existing} finns redan i arkivet.`,
  statusLine: (count: number, label: string) => `${count} – ${label}`,
  maps: (files: number, maps: number, bytes: number) => `${plural(files, "kartfil", "kartfiler")} i ${plural(maps, "karta", "kartor")} (${mb(bytes)})`,
  mapsNew: (upload: number, bytes: number, known: number) => upload === 0 ? `Servern har redan alla kartfilerna.`
    : `${upload} laddas upp (${mb(bytes)})${known > 0 ? `, ${known} finns redan på servern` : ""}.`,
  courses: (ppen: number, courseData: number, bytes: number) => `Banfiler: ${ppen} .ppen och ${courseData} CourseData (${mb(bytes)})`,
  quota: (used: number, adding: number, limit: number | null) => limit === null
    ? `Ditt utrymme för kartor: ${mb(used)} används, importen lägger till ${mb(adding)} (ingen gräns).`
    : `Ditt utrymme för kartor: ${mb(used)} av ${mb(limit)} används, importen lägger till ${mb(adding)}.`,
  quotaFull: (missing: number) => `Det får inte plats: ${mb(missing)} för mycket. Ta bort kartor du inte behöver eller importera färre mappar.`,
  nothingNew: "Det finns inget nytt att importera. Allt finns redan i arkivet.",
  notSentTitle: "Skickas inte (öppnas aldrig)",
  notSentLine: (count: number, label: string, bytes: number) => `${count} ${label} (${mb(bytes)})`,
  notSentNone: "Inga andra filer.",
  showFiles: (count: number) => `Visa filerna som inte skickas (${count})`,
  more: (count: number) => `… och ${count} till`,
  problemsTitle: "Att titta på",
  mapMissing: (count: number) => `${plural(count, "träning", "träningar")} har banor men kartan hittades inte. Banorna importeras ändå; kartan kan väljas i arkivet efteråt.`,
  emptyFolders: (count: number) => `${plural(count, "mapp", "mappar")} utan kartor och banor hoppas över.`,
  showList: "Visa vilka",
  mapTooLarge: (path: string, bytes: number, limit: number) =>
    `${path}: kartfilen är ${mb(bytes)}, men högst ${mb(limit)} får laddas upp. Den skickas inte. Spara kartan mindre (t.ex. utan bakgrundsbild) och importera igen.`,
  nothingFound: "Hittade inga kartfiler eller banfiler. Har du valt rätt mapp?",
  progressTitle: "Importerar",
  checkingServer: "Frågar servern …",
  progressMap: (index: number, total: number, name: string, bytes: number) => `Karta ${index} av ${total} – ${name} (${mb(bytes)}) …`,
  progressVersions: (index: number, total: number) => `Kartornas versioner ${index} av ${total} …`,
  progressTrainings: (done: number, total: number) => `Träning ${done} av ${total} …`,
  leaveWarning: "Importen pågår. Lämnar du sidan avbryts den (det som hunnit skickas finns kvar).",
  done: (uploaded: number, skipped: number, created: number, existing: number, courses: number) =>
    `Klart: ${uploaded} kartfiler uppladdade (${skipped} fanns redan), ${created} nya träningar (${existing} fanns redan), ${courses} nya banfiler.`,
  cancelled: "Importen avbröts. Det som hann skickas finns kvar. Tryck på ”Importera” igen så fortsätter den där den slutade.",
  failed: (reason: string) => `Importen stannade: ${reason} Det som hann skickas finns kvar; tryck på ”Importera” igen när felet är åtgärdat.`,
  readFailed: (reason: string) => `Filerna kunde inte läsas: ${reason}`,
  errors: {
    session: "Du är inte inloggad längre. Logga in igen i en annan flik och tryck på Importera igen.",
    forbidden: "Bara klubbens ägare och administratörer importerar.",
    notFound: "Klubben finns inte, eller så är du inte med i den.",
    tooLarge: (name: string) => `${name} är för stor för servern.`,
    quota: "Ditt utrymme för kartor på servern är fullt.",
    hashMismatch: (name: string) => `${name} ändrades medan den skickades. Välj filerna igen.`,
    invalidMap: (name: string) => `${name} ser inte ut som en kartfil från OCAD eller Mapper.`,
    network: "Kontakten med servern bröts.",
    generic: (status: number) => `Servern svarade ${status}.`
  },
  cliTitle: "För den som kan Git: kommandoraden",
  webOnlyAdmins: "Bara klubbens ägare och administratörer importerar."
} as const;
