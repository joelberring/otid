/** Punkthöjder med reglage: valet bland laserjobbets möjliga små kullar. */
/**
 * Rubrikerna för underlagens ordning i sidopanelen (ägaren 2026-11-12: «de borde vara upplagda så att man hämtar in i
 * ordning … svårt att förstå vilken ordning man kan göra saker»).
 */
export const mapUnderlayStepsSv = {
  heading: "Grundkarta",
  intro: "Så tar du fram en ny karta, uppifrån och ned: steg 2 och 3 behövs, steg 1 är valfritt. Det indragna under ett steg är val inom steget. Har kartan redan innehåll ritar du under Symboler.",
  sources: "Hämta underlag",
  sourcesHelp: "Valfritt: bilder att rita efter, som ortofoto och markfuktighet. OpenStreetMap och hyggen följer med grundkartan i steg 2.",
  sourcesWhere: "Det du hämtar läggs under Lager › Underlag, där det tänds, släcks och tonas. Där lägger du också till en egen bild.",
  baseMap: "Ta fram grundkartan",
  baseMapHelp: "Laserdata, OpenStreetMap och hyggen blir ett utkast till kartan, som du går igenom i steg 3. Har du en baskarta läser du in den först som huvudkälla (under Andra sätt); då hoppas OpenStreetMap över där.",
  baseMapOther: "Andra sätt",
  adjust: "Gå igenom utkastet",
  adjustHelp: "Reglagen räknar om utkastet direkt, utan ny körning. Lägg sedan in det med raden under kartan.",
  then: "Sedan: Rita färdigt – välj en symbol under Symboler och rita; ändra ett objekt med Redigera. Kontrollera under Granska › Normkontroll och exportera med Till Exportera sist i Granska.",
  settings: "Kartans inställningar",
  settingsHelp: "Magnetisk nord och kartans färger. De ändras sällan och behövs inte för att ta fram kartan.",
  toExport: "Till Exportera",
  toExportHelp: "Kartan blir en fil på kartprojektets sida, under Exportera: en ny kartversion eller bara ändringarna.",
  step: (number: number) => `Steg ${number}`
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
    help: "Laserjobbet sparar alla möjliga små kullar med sina mått. Dra i gränserna: utkastet på kartan räknas om direkt, utan ny körning.",
    minRise: (meters: string) => `Minsta höjd över omgivningen: ${meters} m`,
    lowerShare: (percent: number) => `Andel av marken runt om som ligger lägre: minst ${percent} %`,
    maxFoot: (m2: number) => `Största fot: ${m2} m² (större blir en höjdkurva)`,
    spacing: (meters: number) => `Minsta avstånd mellan två: ${meters} m`,
    name: (job: string) => `${job} – punkthöjder`,
    done: (shown: number, all: number) => `${shown} punkthöjder av ${all} möjliga.`
  },
  cliffs: {
    heading: "Branter med reglage (201, 202)",
    help: "Laserjobbet sparar alla branter från 0,8 m fall med sina mått. Dra i gränserna: utkastet räknas om direkt. Förvalet tar inte med branter kortare än normens 0,6 mm på kartan.",
    minDrop: (meters: string) => `Minsta fall för en brant: ${meters} m`,
    minLength: (meters: string) => `Kortaste brant: ${meters} m`,
    impassableDrop: (meters: string) => `Opasserbar från: ${meters} m fall`,
    impassableLength: (meters: number) => `Opasserbar från: ${meters} m längd`,
    tags: "Passerbara branter med taggar (202.1)",
    name: (job: string) => `${job} – branter`,
    done: (impassable: number, passable: number, all: number) => `${impassable} opasserbara och ${passable} passerbara av ${all} möjliga.`
  }
};

/** Gropar och sänkor (ägaren 2026-11-15, negativ kurvbild): valet bland sänkorna som söktes ur markens höjd när grundkartan lästes in. */
export const mapPitsSv = {
  heading: "Gropar och sänkor med reglage (111, 103)",
  help: "När grundkartan läses in söks alla slutna sänkor ur markens höjd, också de som ligger mellan nivåerna. En liten sänka blir en gropsymbol och en större en ring av hjälpkurva efter formen, med lutningsstreck. Sänkor som kurvorna eller Karttapullautins gropar redan visar tas inte med. Dra i gränserna: utkastet räknas om direkt, utan ny körning.",
  none: "Inga sökta sänkor i utkastet. Läs in grundkartan från ett laserjobb som har markens höjd sparad (hojd.png).",
  minDepth: (meters: string) => `Gropsymbol från: ${meters} m djup`,
  ringDepth: (meters: string) => `Ring av hjälpkurva från: ${meters} m djup (när sänkan rymmer normens minsta grop)`,
  spacing: (meters: number) => `Minsta avstånd mellan två gropsymboler: ${meters} m`,
  done: (points: number, rings: number, all: number) => `${points} gropsymboler och ${rings === 1 ? "1 ring" : `${rings} ringar`} av ${all} möjliga sänkor.`,
  loaded: (points: number, rings: number, byHeight: number) => `Sänkor ur markens höjd: ${points} gropsymboler och ${rings === 1 ? "1 ring" : `${rings} ringar`}; ${byHeight} slutna kurvor och hjälpkurvor fick lutningsstreck efter höjden. Ändra under «3. Justera utan ny körning».`
};

/** Små höjder som ring efter formen (ägaren 2026-11-15: «färre punkthöjder och fler små höjder»). */
export const mapHillsSv = {
  heading: "Små höjder som ring (101, 103)",
  help: "När grundkartan läses in söks alla höjder med egen topp ur markens höjd, också de som ligger mellan nivåerna. En höjd som är hög nog och rymmer normens minsta höjd får en ring på halva höjden: en höjdkurva när nästa nivå ligger strax över toppen, annars en hjälpkurva. Punkthöjder inne i ringen tas bort. Höjder som kurvorna redan visar tas inte med. Förvalet (1 m) är mätt mot en kartritares karta i Högdalen.",
  none: "Inga sökta höjder i utkastet. Läs in grundkartan från ett laserjobb som har markens höjd sparad (hojd.png).",
  ringRise: (meters: string) => `Ring från: ${meters} m hög (lägre höjder blir punkthöjder eller lämnas)`,
  done: (rings: number, contours: number, dots: number, all: number) => `${rings === 1 ? "1 ring" : `${rings} ringar`} (${contours} höjdkurvor, ${rings - contours} hjälpkurvor) av ${all} möjliga höjder; ${dots === 1 ? "1 punkthöjd" : `${dots} punkthöjder`} ersattes av en ring.`,
  loaded: (rings: number, dots: number) => `Små höjder: ${rings === 1 ? "1 fick en ring" : `${rings} fick en ring`} efter formen (${dots === 1 ? "1 punkthöjd" : `${dots} punkthöjder`} ersattes).`
};

/** «Tydligare kurvbild» (ägaren 2026-11-14): tre reglage mätta mot kartritares kartor över samma laser. */
export const mapClearContoursSv = {
  heading: "Tydligare kurvbild",
  help: "Laserns kurvor följer marken exakt och blir plottriga. Reglagen gör som kartritare gör: mjukare kurvor där det är flackt, hjälpkurvor bara där de visar en form, och färre små ringar. Detaljerna i brant och kuperad terräng står kvar. Förvalen är mätta mot tre kartritares kartor (Högdalen, Gömmaren, Djurgården).",
  none: "Inget klart laserjobb har markens höjd sparad (hojd.png).",
  noContours: "Inga kurvor i utkastet. Ta fram grundkartan först (steg 2).",
  smooth: (level: number, isDefault: boolean, meters: string, full: string, none: string) => level === 0 ? "Mjukare kurvor på flack mark: av"
    : `Mjukare kurvor på flack mark: ${level} av 10${isDefault ? " (förval)" : ""} – jämnar ut över ${meters} m där marken lutar under ${full} %, inget över ${none} %`,
  formlines: (level: number, isDefault: boolean, convex: string, tight: string, form: number) => level === 0 ? "Färre hjälpkurvor: av"
    : `Färre hjälpkurvor: ${level} av 10${isDefault ? " (förval)" : ""} – bara där marken ligger minst ${convex} m över omgivningen${tight === "0" ? "" : ` och inte närmare en höjdkurva än ${tight} m`}${
      form <= -1 ? "" : form >= 0.5 ? "; bara höjdformerna (avsatser och toppar mellan kurvorna) står kvar" : form > 0 ? "; bitar i jämn lutning tas bort, höjdformerna står kvar"
        : "; bitar där marken är flack nedtill och brant upptill tas bort, höjdformerna står kvar"}`,
  rings: (level: number, isDefault: boolean, squareMeters: string) => level === 0 ? "Små ringar av hjälpkurva: av"
    : `Små ringar av hjälpkurva: ${level} av 10${isDefault ? " (förval)" : ""} – tas bort under ${squareMeters} m²`,
  levelHelp: "0 är av och 10 är mest. Förvalen följer terrängen: i flack terräng med små former får fler hjälpkurvor och ringar stå kvar. Över förvalet tas hjälpkurvorna bort i ordning efter markens form mellan höjdkurvorna: först där marken är flack nedtill, sedan i jämn lutning, och höjdformerna sist. En kurva flyttas aldrig till mark som ligger mer än 1,25 m högre eller lägre (en fjärdedel av ekvidistansen, som normen tillåter).",
  run: "Visa som utkast",
  done: (smoothed: string, formlines: string, rings: number) => `${smoothed} m kurva jämnas ut, ${formlines} m hjälpkurva och ${rings === 1 ? "1 liten ring" : `${rings} små ringar`} tas bort.`,
  untouched: "Ingenting ändras.",
  failed: "Markens höjd kunde inte läsas.",
  showBefore: "Visa laserns kurvor (före)",
  showAfter: "Visa de tydligare (efter)",
  before: "Nu visas laserns kurvor som de var. Reglagen står kvar.",
  loaded: (smoothed: string, formlines: string, rings: number) => `Tydligare kurvbild (förvalen): ${smoothed} m kurva jämnades ut, ${formlines} m hjälpkurva och ${rings === 1 ? "1 liten ring" : `${rings} små ringar`} togs bort. Ändra eller jämför med före under «3. Justera utan ny körning».`
};

/** «Lugna kurvor på flack mark» (ägaren 2026-11-13): hjälpkurvor och små ringar tas bort där marken är flack. */
export const mapFlatContoursSv = {
  heading: "Lugna kurvor på flack mark",
  help: "På flack mark flyttar små höjdfel kurvorna många meter i sidled. Här tas hjälpkurvor och små ringar bort där marken lutar mindre än gränsen. Brantare terräng rörs inte.",
  none: "Inget fuktdjup bland underlagen. Kör laserjobbet med fuktigheten först.",
  noContours: "Inga kurvor i utkastet. Ta fram grundkartan först (steg 2).",
  layer: "Underlag",
  level: (level: number, degrees: string, squareMeters: string) => level === 0 ? "Av: ingenting tas bort"
    : `Nivå ${level} av 10${level === 3 ? " (förval)" : ""}: mark som lutar mindre än ${degrees}°, ringar under ${squareMeters} m²`,
  levelHelp: "0 är av, 1 tar bara det allra flackaste och 10 tar mest. Vanliga öppna kurvor rörs inte.",
  run: "Visa som utkast",
  done: (meters: string, rings: number) => `${meters} m hjälpkurva och ${rings === 1 ? "1 liten ring" : `${rings} små ringar`} på flack mark tas bort.`,
  untouched: "Ingenting tas bort: alla kurvor och hjälpkurvor visas.",
  failed: "Fuktdjupet kunde inte läsas.",
  loaded: (level: number, meters: string, rings: number) => `Lugna kurvor på flack mark (nivå ${level}): ${meters} m hjälpkurva och ${rings === 1 ? "1 liten ring" : `${rings} små ringar`} togs bort. Ändra under «3. Justera utan ny körning».`
};
