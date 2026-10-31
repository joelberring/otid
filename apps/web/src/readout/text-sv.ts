/** "3 h 20 min", "2 dygn 4 h" – en stor klockavvikelse i hela minuter. */
function formatSkew(minutes: number): string {
  const total = Math.abs(minutes);
  const days = Math.floor(total / 1_440);
  const hours = Math.floor((total % 1_440) / 60);
  const rest = total % 60;
  return [days > 0 ? `${days} dygn` : "", hours > 0 ? `${hours} h` : "", rest > 0 && days === 0 ? `${rest} min` : ""]
    .filter(Boolean).join(" ") || "0 min";
}

export const readoutText = {
  title: "O-Tid – avläsning",
  noRace: "Ingen tävling vald. Öppna avläsningen från tävlingens administrationssida.",
  station: "Station",
  internet: "Internet",
  queue: "Kö",
  packageLabel: "Tävlingsdata",
  online: "Ansluten",
  offline: "Ej ansluten",
  queueEmpty: "0 väntar",
  queueWaiting: (count: number) => `${count} väntar`,
  packageMissing: "Saknas",
  // Paketversionen syns alltid (AGENTS.md) men som en liten detalj; rubriken är när datan hämtades (PLAN.md steg 24).
  packageUpdated: (fetched: string) => `Uppdaterad ${fetched}`,
  packageVersion: (version: number) => `v${version}`,
  packageVersionTitle: (version: number) => `Tävlingsdatans version ${version}`,
  stationStatus: {
    disconnected: "Ej ansluten",
    connecting: "Ansluter …",
    ready: (serial: number) => `Redo (nr ${serial})`,
    exercise: "Övningsstation",
    misconfigured: "Fel inställd",
    noResponse: "Svarar inte",
    error: "Fel"
  },
  connectSerial: "Anslut SPORTident-station",
  // Läsplatta (Chrome på Android): stationen direkt över USB.
  connectUsb: "Anslut via USB (läsplatta)",
  usbUnsupported: "Den här webbläsaren kan inte ansluta USB-enheter. Använd Chrome.",
  usbBusy: (detail: string) => `Stationen gick inte att ta (${detail}). Är en annan app (t.ex. SI-Droid) igång? Stäng den med Tvinga stopp under Inställningar → Appar, dra ur och sätt i stationen och försök igen.`,
  connectExercise: "Starta övningsstation",
  // Steg 35: stationen ansluts själv, ljud vid avläsning och avläsningen i en egen flik.
  autoTitle: "Automatisk anslutning",
  autoConnecting: "Ansluter automatiskt till stationen … Sätt i stationen om den inte sitter i.",
  autoConnected: "Stationen ansluts automatiskt nästa gång sidan öppnas eller stationen sätts i.",
  autoPaused: "Frånkopplad. Stationen ansluts automatiskt igen nästa gång sidan öppnas.",
  autoStop: "Sluta ansluta automatiskt",
  autoChoose: "Flera stationer är godkända i den här webbläsaren. Välj vilken som ska anslutas:",
  autoStationUsb: (index: number, serial: string | undefined, name: string | undefined) =>
    `Anslut ${name ?? "station"} ${index + 1}${serial ? ` (serienr ${serial})` : ""}`,
  autoStationSerial: (index: number) => `Anslut station ${index + 1}`,
  autoProblem: (detail: string) => `Den automatiska anslutningen gick inte (${detail}). Anslut med knappen.`,
  tabHint: "Tips: ha avläsningen öppen i en egen flik. Byt sida i en annan flik, så kopplas stationen inte från.",
  sound: "Ljud vid avläsning",
  soundLocked: "Ljudet hörs när du har klickat någonstans på sidan.",
  disconnect: "Koppla från station",
  serialUnsupported: "Den här webbläsaren kan inte ansluta USB-stationer. Använd Chrome eller Edge på dator.",
  serialFailed: "Stationen svarade inte. Kontrollera kabeln och att stationen är i avläsningsläge.",
  misconfiguredHelp: "Ställ stationen i läget avläsning (Readout) med utökat protokoll och anslut igen.",
  // Stationens klocka (PLAN.md steg 22).
  clockSkew: (minutes: number) => `Stationens klocka avviker ${Math.abs(minutes)} min från datorn (${minutes > 0 ? "går före" : "går efter"}). Stämplingstiderna räknas mot stationens klocka. Kontrollera att kontrollenheterna och stationen är tidsynkade.`,
  clockIgnored: (minutes: number) => `Stationens klocka går helt fel (${formatSkew(minutes)} ${minutes > 0 ? "före" : "efter"} datorn). O-Tid räknar stämplingstiderna mot datorns klocka i stället. Kontrollera att datorns klocka stämmer, och ställ stationens klocka innan nästa tävling.`,
  clockMissing: "Stationen svarade inte på klockfrågan. Stämplingstiderna räknas mot datorns klocka.",
  timeUnresolvable: (detail: string) => `Brickans tider går inte att tolka (${detail}). Läs om brickan. Går det inte: ange tiden manuellt i deltagarkortet. Brickan står i listan nedan.`,
  // Steg 45: även 400/404/409 hålls åt sidan, så att resten av kön går.
  heldReadouts: (count: number, serverError: boolean) => `${count} ${count === 1 ? "avläsning" : "avläsningar"} kunde inte skickas (${serverError
    ? "fel på servern" : "servern tog inte emot dem"}). De ligger kvar på den här datorn. Resten av kön skickas som vanligt.`,
  syncThrottled: "Servern ber oss vänta en stund. Kön ligger kvar och skickas igen strax.",
  heldRetry: "Försök igen",
  noSplits: "Godkänd, men inga sträcktider: stämplingarna ligger före start eller efter mål. Kontrollera klockorna och om brickan var tömd.",
  alreadyReadOutTitle: "Brickan är redan avläst",
  alreadyReadOut: (name: string) => `Brickan har redan lästs ut för ${name} – lånad bricka?`,
  alreadyReadOutPossible: (name: string) => `${name} har redan lästs ut med den här brickan. Är det en lånad bricka? Servern kontrollerar.`,
  alreadyReadOutHelp: (name: string) => `${name}s resultat ändras inte. Anmäl eller koppla den som sprang nedan, eller:`,
  sameRunner: "Det är samma löpare – använd den nya avläsningen",
  failedTitle: "Brickor som inte kunde tolkas",
  failedHelp: "Läs om brickan eller ange tiden manuellt i deltagarkortet. Råramarna skickas till servern, där administratören kan läsa om dem under Avläsning.",
  failedStored: "sparad på servern",
  failedWaiting: "väntar på att skickas",
  failedDownload: "Ladda ner listan",
  failedRow: (card: string, time: string, detail: string) => `Bricka ${card} kl. ${time} (${detail})`,
  failedClear: "Ta bort listan",
  waitingForCard: "Sätt i brickan",
  reading: (card: number) => `Läser bricka ${card} …`,
  readFailed: (card: number) => `Bricka ${card} lästes inte färdigt. Sätt i den igen.`,
  unsupported: (card: number) => `Bricka ${card} har en typ som inte stöds.`,
  verdict: {
    OK: "GODKÄND",
    OVERTIME: "MAXTID ÖVERSKRIDEN",
    MP: "FELSTÄMPLAD",
    UNKNOWN_CARD: "OKÄND BRICKA",
    NO_PACKAGE: "SPARAD"
  },
  reason: {
    COMPLETE: "",
    MISSING_CONTROL: "Saknar kontroll",
    WRONG_ORDER: "Kontrollerna i fel ordning",
    MISSING_START: "Ingen starttid",
    MISSING_FINISH: "Ingen målstämpling",
    INVALID_TIME_ORDER: "Målet ligger före starten",
    MAX_TIME_EXCEEDED: "Löptiden är längre än klassens maxtid",
    UNKNOWN_CARD: "Brickan är inte kopplad till någon deltagare. Anmäl löparen nedan."
  } as Record<string, string>,
  missing: (codes: readonly number[]) => `Saknar: ${codes.join(", ")}`,
  // Hyrbricka och startstämpling (PLAN.md steg 25). Status med ord och symbol, inte bara färg.
  rental: "HYRBRICKA – samla in",
  /** Oröjd bricka (PLAN.md steg 31): stämplingar från ett tidigare lopp räknades inte, även när resultatet är godkänt. */
  ignoredPunches: (count: number) => `${count} ${count === 1 ? "gammal stämpling" : "gamla stämplingar"} räknades inte (brickan var inte tömd).`,
  // Direktanmälan av okänd bricka (PLAN.md steg 25), även utan nät.
  register: {
    title: (card: string) => `Anmäl löparen med bricka ${card}`,
    help: "Löparen läggs till i tävlingen med den här brickan. Det fungerar utan nät; anmälan skickas när nätet finns.",
    className: "Klass", chooseClass: "Välj klass …", givenName: "Förnamn", familyName: "Efternamn", club: "Klubb (valfritt)",
    submit: "Lägg till",
    pending: (name: string, className: string) => `${name} är anmäld i ${className} här. Skickas när nätet finns.`,
    stored: (name: string, className: string) => `${name} är anmäld i ${className}.`,
    existing: (name: string, className: string) => `Brickan fanns redan anmäld som ${name} (${className}). Den anmälan gäller.`,
    rejected: (name: string) => `Anmälan av ${name} togs inte emot av servern (klassen kan vara full). Registrera löparen under Hantera tävling.`,
    noClasses: "Tävlingen har inga klasser att anmäla till här.",
    // PLAN.md steg 29: förslag ur löpardatabasen, klass efter banan och anmälda utan bricka.
    found: (card: string, name: string, club: string | undefined) =>
      `Bricka ${card} finns i löpardatabasen: ${name}${club ? `, ${club}` : ""}`,
    fits: (classes: readonly string[]) => classes.length === 1 ? `Passar ${classes[0]}, alla kontroller stämplade`
      : `Passar ${classes.slice(0, -1).join(", ")} och ${classes.at(-1)} – alla kontroller stämplade`,
    closest: (className: string, missing: readonly number[]) =>
      `Ingen bana passar helt. Närmast: ${className}, saknar ${missing.length === 1 ? "kontroll" : "kontrollerna"} ${missing.join(", ")}`,
    classFits: (name: string) => `${name} – passar`,
    classWithCourse: (className: string, courseName: string) => courseName ? `${className} (${courseName})` : className,
    entriesTitle: "Är det någon som redan är anmäld?",
    link: (name: string) => `Koppla brickan till ${name}`,
    linkDetail: (className: string, card: string | undefined) => card
      ? `(${className}, bricka ${card} angiven men inte avläst)` : `(${className}, ingen bricka angiven)`,
    newRunner: "Eller anmäl en ny löpare",
    suggestions: "Förslag ur löpardatabasen",
    choose: (label: string) => `Välj ${label}`,
    linkPending: (name: string, className: string) => `Brickan kopplas till ${name} (${className}) här. Skickas när nätet finns.`,
    linkStored: (name: string, className: string) => `Brickan är kopplad till ${name} (${className}).`,
    linkRejected: (name: string) => `Brickan kunde inte kopplas till ${name} (har hen redan läst ut, eller bytt klass?). Rätta under Hantera tävling.`
  },
  // Gafflad bana (ADR-0169 beslut 2).
  variant: (code: string) => `Variant ${code}`,
  variantGuessed: (code: string) => `Variant ${code} (efter stämplingarna)`,
  // Steg 61: fel karta vid starten.
  wrongMap: (assigned: string, fitting: readonly string[]) =>
    `Felstämplad mot ${assigned}, men stämplingarna passar ${fitting.join(" och ")}. Fick löparen fel karta?`,
  // Stafett (ADR-0169 beslut 3).
  relayTeam: (number: number, name: string, leg: number, legCount: number) => `Lag ${number} ${name} · Sträcka ${leg} av ${legCount}`,
  relayNext: (leg: number) => `Växlar till sträcka ${leg}`,
  // Steg 50: teamsprint med utläsning efter varje sträcka.
  relayTeamSprintLeg: (number: number, name: string, leg: number, runner: string, part: number) =>
    `Lag ${number} ${name} – sträcka ${leg} (${runner}, ${ordinal(part)} sträckan)`,
  teamSprintReadoutMissing: (leg: number) => `Utläsning efter sträcka ${leg} saknas – läs ut efter varje sträcka`,
  teamSprintEarlierFinish: (leg: number) =>
    `Måltiden är tidigare än sträcka ${leg}:s mål – kontrollera brickan. Utläsningen sparas som okänd.`,
  teamSprintAllRead: "Löparen är redan utläst efter alla sina sträckor. Utläsningen sparas som okänd.",
  relayTeamLegs: (number: number, name: string, legs: readonly number[], legCount: number) =>
    `Lag ${number} ${name} · Sträcka ${legs.slice(0, -1).join(", ")} och ${legs.at(-1)} av ${legCount}`,
  relayChangeoverMissing: (found: number, needed: number) =>
    `Växlingsstämpling saknas: brickan har ${found} av ${needed}. Sträckan utan växling blir felstämplad – kontrollera med löparen.`,
  relayLast: "Sista sträckan",
  relayTeamTime: (time: string) => `Lagets tid ${time}`,
  relayTeamWaiting: "Lagets tid när alla sträckor är avlästa",
  relayTeamStatus: { OK: "Laget godkänt", MP: "Laget felstämplat", DSQ: "Laget diskat", DNF: "Laget har brutit", OOC: "Laget utom tävlan",
    NT: "Laget har en sträcka som deltog utan tid", DNS: "Laget har en sträcka som inte startat", RUNNING: "" } as Record<string, string>,
  relayPlace: (teamNumber: number, leg: number) => `Lag ${teamNumber} · Sträcka ${leg}`,
  noPackage: "Tävlingens data är inte hämtad ännu. Avläsningen är sparad och bedöms när nätet finns.",
  savedLocally: "Sparad i den här webbläsaren. Skickas när nätet finns.",
  confirmed: "Sparad.",
  serverDiffers: (status: string) => `Servern bedömde avläsningen annorlunda: ${status}. Serverns bedömning gäller.`,
  splits: "Sträcktider",
  // Rogaining (ADR-0170 beslut 5).
  rogainingTotal: (total: number) => `${total} poäng`,
  rogainingBreakdown: (controlPoints: number, penalty: number) => penalty > 0
    ? `${controlPoints} p kontroller − ${penalty} p straff` : `${controlPoints} p kontroller · inget straff`,
  rogainingTime: (time: string, limit: string) => `Tid ${time} av ${limit}`,
  rogainingLate: (minutes: number) => `För sen: ${minutes} ${minutes === 1 ? "påbörjad minut" : "påbörjade minuter"} över tidsgränsen`,
  rogainingControls: "Räknade kontroller",
  rogainingPoints: (points: number) => `${points} p`,
  exerciseLate: "Läs av: för sen",
  exerciseLateStart: "Läs av: sen start",
  rejected: (reason: string) => `Servern tog inte emot avläsningen (${reason}). Avläsningen finns kvar här.`,
  localInvalid: "Avläsningen kunde inte skickas. Den finns kvar i den här webbläsaren.",
  recent: "Senaste avläsningar",
  none: "Inga avläsningar ännu.",
  statusPending: "Väntar",
  statusStored: "Skickad",
  statusDuplicate: "Redan mottagen",
  statusRejected: "Avvisad",
  exercise: "Övningsstation",
  exerciseRaceDay: "Obs! Övningsstationen skriver riktiga avläsningar i den här tävlingen och ändrar löparnas resultat. Använd den inte under pågående tävling.",
  exerciseRaceDayShort: "Skriver riktiga avläsningar – inte under pågående tävling",
  exerciseHelp: "Skapar en bricka för vald deltagare och läser av den genom samma protokoll som en riktig station. Okänd bricka springer vald deltagares bana med ett oanmält bricknummer.",
  exerciseRunner: "Deltagare",
  exerciseNoRunners: "Inga deltagare med SPORTident-bricka i tävlingen.",
  exerciseOk: "Läs av: rätt stämplat",
  exerciseMissing: "Läs av: missad kontroll",
  exerciseNoFinish: "Läs av: utan mål",
  exerciseUnknown: "Läs av: okänd bricka",
  /** PLAN.md steg 29: en bricka som finns i löpardatabasen men inte är anmäld, för att öva förifyllningen. */
  exerciseRunnerDatabase: "Läs av: bricka ur löpardatabasen",
  loginNeeded: "Inloggningen har gått ut. Logga in igen för att skicka kön. Avläsningar sparas under tiden.",
  login: "Logga in",
  manage: "Hantera tävling",
  results: "Resultat",
  syncFailed: (status: number) => `Servern svarade ${status}. Kön ligger kvar och skickas igen.`,
  rawLog: "Ladda ner felsökningslogg",
  rawLogHelp: "Stationens trafik sedan sidan öppnades, utan namn. Skicka filen till den som driver O-Tid om en station eller bricka beter sig fel.",
  fastRead: "Snabb utläsning av SI10/11/SIAC",
  fastReadHelp: "Läser bara de delar av brickan som har stämplingar (även SI6). Svarar stationen konstigt läses hela brickan direkt, utan att du behöver göra något. Stäng av om en station ändå krånglar.",
  // Kvitto och QR-kod (PLAN.md steg 21).
  receipt: {
    print: "Skriv ut kvitto",
    auto: "Skriv ut kvitto automatiskt",
    showQr: "Visa QR-kod för löparen",
    paper: "Kvittobredd",
    paperOption: (millimetres: number) => `${millimetres} mm`,
    preview: "Kvitto",
    close: "Dölj kvitto",
    region: "Kvitto",
    card: (card: string) => `Bricka ${card}`,
    columns: ["", "Kontroll", "Sträcka", "Tid"] as const,
    rogainingColumns: ["", "Kontroll", "Poäng", "Tid"] as const,
    finish: "Mål",
    time: "Tid",
    controlPoints: "Kontrollpoäng",
    penalty: "Straff",
    total: "Summa",
    timeOfLimit: (time: string, limit: string) => `${time} av ${limit}`,
    missing: (codes: readonly number[]) => `Saknar: ${codes.join(", ")}`,
    noSplits: "Inga sträcktider.",
    scan: "Skanna för dina resultat",
    notPublished: "Resultatsidan syns när tävlingen publiceras.",
    rental: "Lämna tillbaka hyrbrickan",
    placement: (line: string) => `Preliminärt: ${line}`,
    printedAt: (time: string) => `Utskrivet ${time}`,
    footer: "O-Tid"
  },
  storageNotPersistent: "Spara-läget är inte bekräftat av webbläsaren. Stäng inte fliken och töm inte webbläsardata under tävlingen."
} as const;

/** Ordningstal i klartext: första, andra … tionde, sedan 11:e. */
function ordinal(value: number): string {
  const words = ["första", "andra", "tredje", "fjärde", "femte", "sjätte", "sjunde", "åttonde", "nionde", "tionde"];
  return words[value - 1] ?? `${value}:e`;
}
