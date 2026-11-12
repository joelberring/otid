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
  nothing: "Inget blir kvar med de gränserna."
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
    help: "Laserjobbet sparar alla branter från 0,8 m fall med sina mått. Dra i gränserna: kandidaterna räknas om direkt. Branter kortare än normens 0,6 mm på kartan tas inte med.",
    minDrop: (meters: string) => `Minsta fall för en brant: ${meters} m`,
    impassableDrop: (meters: string) => `Opasserbar från: ${meters} m fall`,
    impassableLength: (meters: number) => `Opasserbar från: ${meters} m längd`,
    tags: "Passerbara branter med taggar (202.1)",
    name: (job: string) => `${job} – branter`,
    done: (impassable: number, passable: number, all: number) => `${impassable} opasserbara och ${passable} passerbara av ${all} möjliga.`
  }
};
