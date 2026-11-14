/** Punkthöjder med reglage: valet bland laserjobbets möjliga små kullar. */
/**
 * Rubrikerna för underlagens ordning i sidopanelen (ägaren 2026-11-12: «de borde vara upplagda så att man hämtar in i
 * ordning … svårt att förstå vilken ordning man kan göra saker»).
 */
export const mapUnderlayStepsSv = {
  sources: "1. Hämta underlag",
  sourcesHelp: "OpenStreetMap (vägar, stigar, hus) behöver du inte hämta själv: det följer med när du läser in grundkartan i steg 2. Vill du ha det ensamt finns det längst ner under Importera vektorer → Hämta från OpenStreetMap.",
  laser: "2. Laserdata",
  laserHelp: "Sök laserrutor och kör en gång. Läs sedan in grundkartan från det klara jobbet: den visas som kandidater och sparas inte i kartan förrän du lägger in dem.",
  adjust: "3. Justera utan ny körning",
  adjustHelp: "Reglagen räknar om kandidaterna direkt ur det som redan är hämtat. Bara inställningarna i laserjobbet (ekvidistans, kurvornas utjämning) kräver en ny körning.",
  other: "Egna filer"
};

/** Gemensamt för reglagen som väljer bland det laserjobbet har sparat. */
export const mapSavedChoiceSv = {
  none: "Inget klart laserjobb har det sparat. Kör laserjobbet en gång till (geo-arbetaren version 25 eller senare).",
  job: "Laserjobb",
  load: "Hämta",
  loading: "Hämtar …",
  failed: "Det kunde inte hämtas.",
  reset: "Förvalen",
  amount: (level: number) => `Mängd: ${level} av 10${level === 5 ? " (förval)" : ""}`,
  amountHelp: "1 ger få, 10 ger många.",
  fine: "Finjustera",
  nothing: "Inget blir kvar med de gränserna.",
  allStages: (name: string, count: number) => `${name} – alla ${count} etapper`
};

/** Punkthöjder och branter med reglage: valet bland det laserjobbet har sparat med sina mått. */
export const mapKnollsSv = {
  knolls: {
    heading: "Punkthöjder med reglage (109)",
    help: "Laserjobbet sparar alla möjliga små kullar med sina mått. Dra i gränserna: kandidaterna på kartan räknas om direkt, utan ny körning.",
    minRise: (meters: string) => `Minsta höjd över omgivningen: ${meters} m`,
    lowerShare: (percent: number) => `Andel av marken runt om som ligger lägre: minst ${percent} %`,
    maxFoot: (m2: number) => `Största fot: ${m2} m² (större blir en höjdkurva)`,
    spacing: (meters: number) => `Minsta avstånd mellan två: ${meters} m`,
    name: (job: string) => `${job} – punkthöjder`,
    done: (shown: number, all: number) => `${shown} punkthöjder av ${all} möjliga.`
  },
  cliffs: {
    heading: "Branter med reglage (201, 202)",
    help: "Laserjobbet sparar alla branter från 0,8 m fall med sina mått. Dra i gränserna: kandidaterna räknas om direkt. Förvalet tar inte med branter kortare än normens 0,6 mm på kartan.",
    minDrop: (meters: string) => `Minsta fall för en brant: ${meters} m`,
    minLength: (meters: string) => `Kortaste brant: ${meters} m`,
    impassableDrop: (meters: string) => `Opasserbar från: ${meters} m fall`,
    impassableLength: (meters: number) => `Opasserbar från: ${meters} m längd`,
    tags: "Passerbara branter med taggar (202.1)",
    name: (job: string) => `${job} – branter`,
    done: (impassable: number, passable: number, all: number) => `${impassable} opasserbara och ${passable} passerbara av ${all} möjliga.`
  }
};

/** «Tydligare kurvbild» (ägaren 2026-11-14): tre reglage mätta mot kartritares kartor över samma laser. */
export const mapClearContoursSv = {
  heading: "Tydligare kurvbild",
  help: "Laserns kurvor följer marken exakt och blir plottriga. Reglagen gör som kartritare gör: mjukare kurvor där det är flackt, hjälpkurvor bara där de visar en form, och färre små ringar. Detaljerna i brant och kuperad terräng står kvar. Förvalen är mätta mot tre kartritares kartor (Högdalen, Gömmaren, Djurgården).",
  none: "Inget klart laserjobb har markens höjd sparad (hojd.png).",
  noContours: "Inga kurvor bland kandidaterna. Läs in grundkartan först (steg 2).",
  smooth: (level: number, meters: string, full: string, none: string) => level === 0 ? "Mjukare kurvor på flack mark: av"
    : `Mjukare kurvor på flack mark: ${level} av 10${level === 5 ? " (förval)" : ""} – jämnar ut över ${meters} m där marken lutar under ${full} %, inget över ${none} %`,
  formlines: (level: number, convex: string, tight: string) => level === 0 ? "Färre hjälpkurvor: av"
    : `Färre hjälpkurvor: ${level} av 10${level === 5 ? " (förval)" : ""} – bara där marken ligger minst ${convex} m över omgivningen${tight === "0" ? "" : ` och inte närmare en höjdkurva än ${tight} m`}`,
  rings: (level: number, squareMeters: string) => level === 0 ? "Små ringar av hjälpkurva: av"
    : `Små ringar av hjälpkurva: ${level} av 10${level === 5 ? " (förval)" : ""} – tas bort under ${squareMeters} m²`,
  levelHelp: "0 är av och 10 är mest. En kurva flyttas aldrig till mark som ligger mer än 1,25 m högre eller lägre (en fjärdedel av ekvidistansen, som normen tillåter).",
  run: "Visa som kandidater",
  done: (smoothed: string, formlines: string, rings: number) => `${smoothed} m kurva jämnas ut, ${formlines} m hjälpkurva och ${rings === 1 ? "1 liten ring" : `${rings} små ringar`} tas bort.`,
  untouched: "Ingenting ändras.",
  failed: "Markens höjd kunde inte läsas."
};

/** «Lugna kurvor på flack mark» (ägaren 2026-11-13): hjälpkurvor och små ringar tas bort där marken är flack. */
export const mapFlatContoursSv = {
  heading: "Lugna kurvor på flack mark",
  help: "På flack mark flyttar små höjdfel kurvorna många meter i sidled. Här tas hjälpkurvor och små ringar bort där marken lutar mindre än gränsen. Brantare terräng rörs inte.",
  none: "Inget fuktdjup bland underlagen. Kör laserjobbet med fuktigheten först.",
  noContours: "Inga kurvor bland kandidaterna. Läs in grundkartan först (steg 2).",
  layer: "Underlag",
  level: (level: number, degrees: string, squareMeters: string) => level === 0 ? "Av: ingenting tas bort"
    : `Nivå ${level} av 10${level === 3 ? " (förval)" : ""}: mark som lutar mindre än ${degrees}°, ringar under ${squareMeters} m²`,
  levelHelp: "0 är av, 1 tar bara det allra flackaste och 10 tar mest. Vanliga öppna kurvor rörs inte.",
  run: "Visa som kandidater",
  done: (meters: string, rings: number) => `${meters} m hjälpkurva och ${rings === 1 ? "1 liten ring" : `${rings} små ringar`} på flack mark tas bort.`,
  untouched: "Ingenting tas bort: alla kurvor och hjälpkurvor visas.",
  failed: "Fuktdjupet kunde inte läsas.",
  loaded: (level: number, meters: string, rings: number) => `Lugna kurvor på flack mark (nivå ${level}): ${meters} m hjälpkurva och ${rings === 1 ? "1 liten ring" : `${rings} små ringar`} togs bort. Ändra under «3. Justera utan ny körning».`
};
