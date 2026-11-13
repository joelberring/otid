/**
 * «Berg i dagen med reglage» (ägaren 2026-11-13: «ett reglage att klassa fler/färre områden som berg … standardläget kanske
 * ska vara ganska restriktivt»): bergytor ur laserkörningens bergbild med en mängd 1–10.
 */
const areasOf = (areas: number) => areas === 1 ? "1 yta" : `${areas} ytor`;
export const mapRockSv = {
  heading: "Berg i dagen med reglage (214)",
  help: "Berg i dagen ur laserns ojämnhet, öppenheten och närheten till vatten. Lågt värde tar bara tydliga hällar; högre tar med slätare hällar, strandklippor och berg under gles skog.",
  none: "Ingen bergbild bland underlagen. Kör laserjobbet igen för att få den.",
  layer: "Underlag",
  amount: (level: number) => `Mängd: ${level} av 10${level === 3 ? " (förval)" : ""}`,
  amountHelp: "1 ger få, 10 ger många.",
  run: "Visa som kandidater",
  name: (layer: string) => `${layer} – berg i dagen`.slice(0, 120),
  done: (areas: number, hectares: string) => `${areasOf(areas)}, ${hectares} ha berg i dagen visas som kandidater. Ändra mängden så räknas det om.`,
  nothing: "Inget berg i dagen med den mängden.",
  failed: "Bergbilden kunde inte läsas.",
  loaded: (level: number, areas: number, hectares: string) => `Berg i dagen (mängd ${level} av 10): ${areasOf(areas)}, ${hectares} ha. Ändra under «3. Justera utan ny körning».`,
  loadFailed: "Bergbilden kunde inte läsas, så berg i dagen kommer ur laserfilen."
};
