/**
 * Hela symboluppsättningen i ISSprOM 2019-2 (ägaren 2026-11-23: «kolla att du har med hela symboluppsättningen från
 * sprintnormen i valen»), med de rättelser som O-Map Wiki har (t.ex. 533 Område med hinder, rev. 6 2024). Listan är hämtad ur
 * wikins sida för normen (`SPEC`) 2026-11-23; sidan per symbol står där den lästs (färg och mått i `symbol-norm.ts`).
 * Banläggningens symboler (701–715) hör till banans tryck och ritas i banläggningen, inte i kartan, och är inte med.
 * 321 och 541–545 är skolkartornas tillägg (SSSOM 2019) som wikin listar under ISSprOM 2019-2.
 *
 * O-Tids sprintmall (`issprom-2019-2.ts` i map-file) har alla symbolerna; numren 509, 512 och 513 i skogsnormen heter
 * 509.1, 512.1 och 513.1 där. Mallen har också några av skogsnormens symboler som sprintnormen inte har (t.ex. 106, 114, 209,
 * 211, 212, 215, 304, 502–504, 514, 517, 523, 602, 603): de tas inte bort ur kartor, men finns inte i listan.
 */
export const ISSPROM_SPEC_URL = "https://omapwiki.orienteering.sport/specifications/issprom/";
const PAGE = "https://omapwiki.orienteering.sport/symbols/";

export interface NormListEntry {
  readonly code: string;
  /** Normens engelska namn. */
  readonly en: string;
  /** Källan: sidan per symbol när den lästs, annars normens lista. */
  readonly source: string;
}

const row = (code: string, en: string, page?: string): NormListEntry => ({ code, en, source: page ? `${PAGE}${page}/` : ISSPROM_SPEC_URL });

export const ISSPROM_SYMBOLS: readonly NormListEntry[] = [
  row("101", "Contour"), row("102", "Index contour"), row("103", "Form line"), row("104", "Earth bank"),
  row("105.1", "Small earth wall"), row("105.2", "Retaining earth wall seen only from one side"), row("107", "Erosion gully"),
  row("108", "Small erosion gully"), row("109", "Small knoll"), row("110", "Small elongated knoll"), row("111", "Small depression"),
  row("112", "Pit or hole"), row("113", "Broken ground"), row("115", "Prominent landform feature"),
  row("201", "Uncrossable cliff", "201-impassable-cliff-2"), row("202", "Passable rock face"), row("203", "Rocky pit or cave"),
  row("204", "Boulder"), row("205", "Large boulder"), row("206", "Gigantic boulder or rock pillar"), row("207", "Boulder cluster"),
  row("208", "Boulder field"), row("210", "Stony ground"), row("213", "Open sandy ground"), row("214", "Bare rock", "214-bare-rock-2"),
  row("301", "Uncrossable body of water", "301-uncrossable-body-of-water-2"), row("302", "Shallow body of water"), row("303", "Waterhole"),
  row("305", "Small crossable watercourse"), row("306", "Minor/seasonal watercourse"), row("307", "Uncrossable marsh"), row("308", "Marsh"),
  row("309", "Narrow marsh"), row("310", "Indistinct marsh"), row("311", "Small fountain or well"), row("312", "Spring"),
  row("313", "Prominent water feature"), row("321", "Hydrant", "321-hydrant"),
  row("401", "Open land"), row("402", "Open land with scattered trees"), row("403", "Rough open land", "403-rough-open-land-2"),
  row("404", "Rough open land with scattered trees", "404-rough-open-land-with-scattered-trees-2"), row("405", "Forest"),
  row("406", "Vegetation: slow running", "406-vegetation-slow-running-2"), row("407", "Vegetation: slow running, good visibility"),
  row("408", "Vegetation: walk", "408-vegetation-walk-2"), row("409", "Vegetation: walk, good visibility"),
  row("410", "Vegetation: fight", "410-vegetation-fight-2"), row("411", "Uncrossable vegetation"), row("412", "Cultivated land"),
  row("413", "Orchard"), row("414", "Vineyard or similar"), row("415", "Distinct cultivation boundary"), row("416", "Distinct vegetation boundary"),
  row("417", "Prominent large tree"), row("418", "Prominent bush or small tree"), row("419", "Prominent vegetation feature"),
  row("501", "Paved area", "501-paved-area-2"), row("501.1", "Step or edge of paved area", "501-1-step-or-edge-of-paved-area-2"),
  row("501.2", "Step or edge of paved area at lower level"), row("501.3", "Paved area with scattered trees"),
  row("505", "Unpaved footpath or track"), row("506", "Small unpaved footpath or track"), row("507", "Less distinct small path"),
  row("508", "Narrow ride"), row("509.1", "Railway"), row("509.2", "Tramway"), row("510", "Power line, cableway or ski lift"),
  row("511", "Major power line"), row("512.1", "Bridge or tunnel entrance"), row("512.2", "Underpass or tunnel", "512-2-underpass-or-tunnel"),
  row("512.3", "Area runnable at lower level", "512-3-area-passable-at-two-levels"), row("513.1", "Passable wall", "513-1-passable-wall"),
  row("513.2", "Passable retaining wall", "513-2-passable-retained-wall"), row("515", "Uncrossable wall"), row("516", "Passable fence or railing"),
  row("518", "Uncrossable fence or railing"), row("519", "Crossing point (optional)"),
  row("520", "Area that shall not be entered", "520-area-that-shall-not-be-entered-2"), row("521", "Building", "521-building-2"),
  row("522", "Canopy"), row("522.1", "Pillar"), row("524", "High tower"), row("525", "Small tower"),
  row("526", "Cairn, memorial, sculpture, small monument or boundary stone"), row("527", "Fodder rack"), row("528", "Prominent line feature"),
  row("529", "Prominent uncrossable line feature"), row("530", "Prominent man-made feature – ring"), row("531", "Prominent man-made feature – x"),
  row("532", "Stairway", "532-stairway-2"), row("533", "Area with obstacles", "533-area-with-obstacles"),
  row("541", "Playground equipment", "541-playground-equipment"), row("542", "Table", "542-table"), row("543", "Bench, seat"),
  row("544", "Pole, small pylon", "544-pole-small-pylon"), row("545", "Lamppost", "545-lamppost"),
  row("601", "Magnetic north line")
];
