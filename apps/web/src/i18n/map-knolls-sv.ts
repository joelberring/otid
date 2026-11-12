/** Punkthöjder med reglage: valet bland laserjobbets möjliga små kullar. */
/**
 * Rubrikerna för underlagens ordning i sidopanelen (ägaren 2026-11-12: «de borde vara upplagda så att man hämtar in i
 * ordning … svårt att förstå vilken ordning man kan göra saker»).
 */
export const mapUnderlayStepsSv = {
  sources: "1. Hämta underlag",
  laser: "2. Laserdata",
  laserHelp: "Sök laserrutor och kör en gång. Läs sedan in grundkartan från det klara jobbet: den visas som kandidater och sparas inte i kartan förrän du lägger in dem.",
  adjust: "3. Justera utan ny körning",
  adjustHelp: "Reglagen räknar om kandidaterna direkt ur det som redan är hämtat. Bara inställningarna i laserjobbet (ekvidistans, kurvornas utjämning) kräver en ny körning.",
  other: "Egna filer"
};

export const mapKnollsSv = {
  heading: "Punkthöjder med reglage (109)",
  help: "Laserjobbet sparar alla möjliga små kullar med sina mått. Dra i gränserna: kandidaterna på kartan räknas om direkt, utan ny körning.",
  none: "Inget klart laserjobb med sparade kullar. Kör laserjobbet (geo-arbetaren version 25 eller senare) först.",
  job: "Laserjobb",
  load: "Hämta kullarna",
  loading: "Hämtar …",
  failed: "Kullarna kunde inte hämtas.",
  minRise: (meters: string) => `Minsta höjd över omgivningen: ${meters} m`,
  lowerShare: (percent: number) => `Andel av marken runt om som ligger lägre: minst ${percent} %`,
  maxFoot: (m2: number) => `Största fot: ${m2} m² (större blir en höjdkurva)`,
  spacing: (meters: number) => `Minsta avstånd mellan två: ${meters} m`,
  reset: "Förvalen",
  name: (job: string) => `${job} – punkthöjder`,
  done: (shown: number, all: number) => `${shown} punkthöjder av ${all} möjliga.`,
  nothing: "Inga punkthöjder med de gränserna."
};
