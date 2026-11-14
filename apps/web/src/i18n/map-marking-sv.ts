/**
 * Kartans märkning (ägaren 2026-11-14): rutan som läggs i ett hörn av en karta som gjorts ny i O-Tid. Texten står i
 * kartan, så den ändras inte i efterhand när språket byts.
 */
export interface MarkingFacts {
  readonly host: string; readonly date: string; readonly worker: number; readonly scale: number;
  /** Laserns skanningsdatum och laserjobbets inställningar (namn och värde), när de är kända. */
  readonly scannedAt?: string | undefined; readonly settings: readonly (readonly [string, number])[];
  /** Reglagens nivåer: lugna kurvor och tydligare kurvbild (utjämning/hjälpkurvor/ringar). */
  readonly calm?: number | undefined; readonly clear?: readonly [number, number, number] | undefined;
}
const number = (value: number) => value.toLocaleString("sv-SE");
const SETTING: Readonly<Record<string, string>> = { contour_interval: "ekvidistans (m)", formline: "hjälpkurvor", formlinesteepness: "hjälpkurvor i brant", smoothing: "utjämning",
  curviness: "kurvighet", knolls: "kullar", knollshare: "kullars ring", greenscale: "grönt", openshare: "öppet", denseshare: "tätt", rock: "berg", paved: "belagt" };

export const mapMarkingSv = {
  heading: "Gjord med O-Tid",
  paragraphs: (facts: MarkingFacts): string[] => [
    `${facts.host} · ${facts.date} · geo-arbetaren ${facts.worker}`,
    `Kartan är framställd maskinellt ur Lantmäteriets laserdata${facts.scannedAt ? ` (skannad ${facts.scannedAt})` : ""}, OpenStreetMap (© OpenStreetMaps bidragsgivare) och Skogsstyrelsens data. Den är inte kontrollerad i terrängen och kan innehålla fel.`,
    "Användning: Kartan får användas fritt för eget bruk; allemansrätten gäller för den enskilde. Träningar, tävlingar och andra arrangemang kräver samråd i förväg med markägare och jakträttsinnehavare, enligt Svenska Orienteringsförbundets regler. Finns det en orienteringsklubb med karta över området ska den kontaktas först: klubben har ofta överenskommelser med markägarna som inte får störas.",
    [`Inställningar: skala 1:${number(facts.scale)}`, ...facts.settings.map(([name, value]) => `${SETTING[name] ?? name} ${number(value)}`),
      ...(facts.calm !== undefined ? [`lugna kurvor ${facts.calm}`] : []),
      ...(facts.clear ? [`tydligare kurvbild ${facts.clear.join("/")}`] : [])].join(" · ")
  ],
  added: (paper: string) => ` Kartan har fått en ram (${paper}), O-Tids logga och en ruta om hur kartan är gjord och får användas. De ligger i lagret «O-Tid» och kan släckas eller tas bort.`,
  paper: (size: string, landscape: boolean) => `${size} ${landscape ? "liggande" : "stående"}`,
  noPaper: "större än A0"
};
