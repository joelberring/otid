/**
 * Guiden «Ny grundkarta» överst i Underlag (ägaren 2026-11-13: sidan var rörig, ordningen syntes inte och felen sa inte vad
 * man skulle göra). Fyra steg med en knapp i taget; varje felbesked säger vad man gör härnäst.
 */
export const mapGuideSv = {
  heading: "Ny grundkarta",
  intro: "Fyra steg från laserdata till objekt i kartan. Guiden gör samma sak som panelerna längre ner, i rätt ordning.",
  show: "Visa stegen",
  hide: "Dölj stegen",
  stepNames: { area: "Område", run: "Hämta och kör", wait: "Vänta", review: "Granska och lägg in" },
  marks: { done: "Klart", current: "Här är du", todo: "Kommer sedan" },
  stepLabel: (number: number, name: string, mark: string) => `Steg ${number}: ${name} (${mark})`,
  area: {
    label: "Vad ska grundkartan täcka?",
    whole: "Hela kartan",
    size: (tiles: number, km2: number | undefined, most: number) => `${km2 === undefined ? "" : `Ungefär ${formatKm2(km2)} km², `}${tiles === 1 ? "1 laserruta" : `${tiles} laserrutor`} (en körning tar högst ${most}).`,
    tooLargeSearch: (name: string | undefined, maxKm2: number) => `${name ?? "Hela kartan"} är för stort för en körning: en sökning efter laserdata tar högst ${maxKm2} km², och högst omkring 28 km i någon ledd.`,
    tooLargeTiles: (name: string | undefined, tiles: number, most: number) => `${name ?? "Hela kartan"} är för stort för en körning: området täcker ${tiles} laserrutor och en körning tar högst ${most}.`,
    splitNext: "Dela området i mindre delar med ett streck och kör en del i taget. Tryck på knappen, dra strecket tvärs över området på kartan och dubbelklicka. Kom sedan tillbaka hit (fliken Lager) och välj en av delarna.",
    splitByOwner: "Be en ägare av kartan att dela området: fliken Granska › Delområden › Dela med ett streck. Välj sedan en av delarna här.",
    pickSmaller: "Det finns redan delar: välj en mindre del i listan ovan.",
    manual: "Vill du hellre välja laserrutor själv går det under 2. Laserdata längre ner."
  },
  split: "Dela med ett streck",
  run: {
    checking: "Kontrollerar dina uppgifter till Lantmäteriet …",
    credential: "Laserdatan hämtas med dina egna uppgifter till Lantmäteriet (Geotorget). Lägg in dem en gång; ladda sedan om den här sidan så fortsätter guiden här.",
    help: (name: string | undefined) => `Söker laserrutor för ${name ?? "hela kartan"} hos Lantmäteriet och startar körningen på geo-servern med förvalen: kurvor, branter, fuktighet (kärr), `
      + "vegetation, och Lantmäteriets marktäcke och byggnader när ditt konto har dem.",
    automatic: "OpenStreetMap (stigar, vägar, hus) och Skogsstyrelsens hyggen behöver du inte hämta själv: de hämtas automatiskt när grundkartan läses in i steg 4.",
    button: "Hämta laserdata och kör",
    again: "Kör igen",
    starting: "Startar körningen …",
    failed: (error: string | null) => `Den förra körningen misslyckades${error ? `: ${error}` : "."} Kör igen; händer det en gång till, dela området i mindre delar (steg 1).`,
    unusable: "Den senaste körningen för området har inga filer till grundkartan (den är äldre eller blev inte hel). Kör en gång till.",
    contours: "Kurvbild",
    contourStyles: { detailed: "Detaljerad", normal: "Normal", generalized: "Generaliserad", veryGeneralized: "Mycket generaliserad" },
    contoursHelp: "Hur mycket höjdmodellen jämnas ut innan kurvorna dras. Generaliserad passar flack terräng där småformerna mest är brus. Valet kommer ihåg för kartan.",
    noTiles: "Lantmäteriet har inga laserrutor för området. Kontrollera att kartan ligger rätt (i Sverige, rätt koordinatsystem), eller välj ett annat område i steg 1."
  },
  wait: {
    queued: "Körningen väntar på geo-servern.",
    running: "Körningen pågår.",
    progress: (step: string, done: number, total: number) => total > 1 ? `Steg i körningen: ${step} (${done} av ${total}).` : `Steg i körningen: ${step}.`,
    ahead: (count: number) => count === 0 ? "Din körning är näst på tur." : count === 1 ? "1 körning är före din i kön." : `${count} körningar är före din i kön.`,
    close: "Du kan stänga sidan eller rita vidare: körningen fortsätter på geo-servern, och guiden står på rätt steg när du kommer tillbaka.",
    estimate: (minutes: number, basis: "history" | "guess") => basis === "history"
      ? `Räkna med ungefär ${formatMinutes(minutes)} från start, att döma av projektets tidigare körningar. Kön kan lägga till väntetid.`
      : `Räkna med ungefär ${formatMinutes(minutes)} från start. Det är en grov gissning efter områdets storlek; kön kan lägga till väntetid.`,
    cancel: "Avbryt körningen",
    cancelSure: "Avbryta körningen? Det som hunnit räknas går förlorat.",
    cancelYes: "Ja, avbryt",
    cancelNo: "Nej, fortsätt"
  },
  review: {
    load: (name: string) => `${name} är klar. Läs in grundkartan: den visas som kandidater ovanpå kartan och sparas inte förrän du lägger in dem.`,
    button: "Läs in grundkartan",
    candidates: (count: number) => `Grundkartan visas nu som kandidater${count ? ` (${count} objekt)` : ""}. Titta på kartan, och lägg in dem med knappen «Lägg in … objekt i kartan» i raden under kartan `
      + "(där går också enskilda lager att bocka ur).",
    adjust: "Vill du ha fler eller färre punkthöjder, branter, grönt, fukt eller hyggen: dra i reglagen under 3. Justera utan ny körning längre ner. De räknar om kandidaterna direkt.",
    computing: "Räknar kandidater …",
    restart: "Kör om i stället"
  },
  finished: (name: string | undefined) => `Grundkartan för ${name ?? "hela kartan"} är inlagd.`,
  finishedNext: "Ångra tar bort den igen. För en annan del, eller en ny körning av samma område, tryck på Ny körning.",
  restart: "Ny körning",
  /** Felkoderna från servern, med vad man gör härnäst. */
  problems: {
    SOURCE_NO_CREDENTIAL: "Uppgifterna till Lantmäteriet saknas. Lägg in dem under Mitt konto, ladda om sidan och tryck på knappen igen.",
    SOURCE_REJECTED: "Lantmäteriet godtog inte uppgifterna, eller så är Laserdata Nedladdning, skog inte beställd på Geotorget. Kontrollera användarnamn och lösenord under Mitt konto "
      + "och beställningen på Geotorget, och tryck sedan på knappen igen.",
    SOURCE_AREA_TOO_LARGE: "Området är för stort för en sökning. Dela det i mindre delar (steg 1) och kör en del i taget.",
    SOURCE_THROTTLED: "För många sökningar den senaste timmen. Vänta en stund (högst en timme) och tryck på knappen igen.",
    SOURCE_UNAVAILABLE: "Lantmäteriet svarade inte just nu. Vänta några minuter och tryck på knappen igen.",
    GEO_JOB_BUSY: "Du har redan två körningar som väntar eller pågår. Vänta tills en är klar, eller avbryt en under 2. Laserdata › Jobben, och tryck sedan på knappen igen.",
    GEO_JOB_QUOTA: "Månadens kvot av laserrutor är slut för ditt konto. Kör en mindre del, eller vänta till nästa månad."
  } as Record<string, string>,
  /** Efter ett fel utan egen text (t.ex. nätet): vad man gör härnäst. */
  retry: "Försök igen om en stund. Går det fortfarande inte kan stegen göras för hand under 2. Laserdata längre ner."
};

function formatKm2(km2: number): string { return (km2 < 10 ? Math.round(km2 * 10) / 10 : Math.round(km2)).toString().replace(".", ","); }
function formatMinutes(minutes: number): string {
  if (minutes < 90) return `${minutes} minuter`;
  const hours = Math.round(minutes / 30) / 2;
  return `${String(hours).replace(".", ",")} timmar`;
}
