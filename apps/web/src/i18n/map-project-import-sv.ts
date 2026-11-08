import { plural } from "./plural";

/** ADR-0219 tillägget om vektorunderlagen (K4b): importera en vektorfil som kandidater. */
export const mapProjectImportSv = {
  heading: "Importera vektorer",
  help: "En baskarta eller annan vektorfil (GeoJSON, DXF eller Shapefile, gärna som .zip) blir kandidater: välj symbol per lager, se dem på kartan och lämna dem som förslag "
    + "som godkänns som andra förslag. DWG sparas som DXF tills vidare. Allt läses här i webbläsaren.",
  choose: "Välj fil",
  file: (name: string, count: number, skipped: number) => `${name}: ${plural(count, "objekt", "objekt")}${skipped ? `, ${skipped} hoppas över` : ""}`,
  crs: "Koordinatsystem (EPSG)",
  crsHelp: "Ur filen eller koordinaterna när det går; annars kartans. T.ex. 3006, 3011 (SWEREF 99 18 00), 3021 eller 4326.",
  layers: "Lager och symboler",
  layerShape: (points: number, lines: number, closed: number, areas: number) =>
    [points && plural(points, "punkt", "punkter"), lines && plural(lines, "linje", "linjer"), closed && plural(closed, "sluten linje", "slutna linjer"),
      areas && plural(areas, "yta", "ytor")].filter(Boolean).join(", "),
  skip: "Hoppa över",
  symbolFor: (layer: string) => `Symbol för ${layer}`,
  result: (objects: number, joined: number, duplicates: number, short: number, outside: number, mismatched: number, clipped: number) =>
    `${plural(objects, "kandidat", "kandidater")}`
    + [joined && `${joined} hopslagna`, clipped && `${clipped} klippta vid kanten`, duplicates && `${duplicates} dubbletter borta`, short && `${short} korta stumpar borta`,
      outside && `${outside} utanför kartan`, mismatched && `${mismatched} med fel form`].filter(Boolean).map(part => ` · ${part}`).join(""),
  propose: (count: number) => `Lämna ${plural(count, "kandidat", "kandidater")} som förslag`,
  sending: (done: number, total: number) => `Skickar ${done} av ${total} …`,
  sent: (count: number) => `${plural(count, "förslag", "förslag")} lämnade. Godkänn eller avvisa dem under Förslag.`,
  note: (file: string, part: number, parts: number) => `Import ${file}${parts > 1 ? `, del ${part} av ${parts}` : ""}`.slice(0, 500),
  cancel: "Avbryt",
  problems: {
    unsupported: "Välj en GeoJSON-, DXF- eller Shapefile (.shp med .dbf och .prj, eller en .zip). DWG: spara som DXF.",
    crs: "Koordinatsystemet stöds inte (SWEREF 99, RT 90, UTM eller WGS 84).",
    generic: (status: number) => `Det gick inte (${status}).`
  }
} as const;
