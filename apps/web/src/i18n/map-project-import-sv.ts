import { plural } from "./plural";

/** ADR-0219 tillägget om vektorunderlagen (K4b): importera en vektorfil som kandidater. */
export const mapProjectImportSv = {
  heading: "Importera vektorer",
  help: "En baskarta eller annan vektorfil (GeoJSON, DXF eller Shapefile, gärna som .zip) blir kandidater: välj symbol per lager, se dem på kartan och lämna dem som förslag "
    + "som godkänns som andra förslag. DWG sparas som DXF tills vidare. Allt läses här i webbläsaren. Vissa baskartor känns igen "
    + "på lagernamnen, men inte alla. Valen kan sparas som en profil till nästa fil.",
  choose: "Välj fil",
  osmHeading: "Hämta från OpenStreetMap",
  osmHelp: "Byggnader, vägar, stigar, staket, murar, vatten och markanvändning för hela kartan eller en etapp. Servern hämtar dem; de blir kandidater som en fil. Data © OpenStreetMap-bidragsgivare (ODbL).",
  osmWhere: "Område",
  osmWhole: "Hela kartan",
  osmFetch: "Hämta",
  osmFetching: "Hämtar …",
  osmName: (area?: string) => `OpenStreetMap${area ? `, ${area}` : ""} (© OpenStreetMap-bidragsgivare, ODbL)`,
  file: (name: string, count: number, skipped: number) => `${name}: ${plural(count, "objekt", "objekt")}${skipped ? `, ${skipped} hoppas över` : ""}`,
  crs: "Koordinatsystem (EPSG)",
  fit: "Passa in mot kartan",
  fitting: "Passar in … (några sekunder)",
  fitClear: "Ta bort inpassningen",
  fitHelp: "Hamnar underlaget nästan rätt men lite förskjutet eller vridet? Ge lagren med hus, vägar eller vatten deras symboler och passa sedan in dem mot kartans.",
  fitFailed: "Det gick inte att passa in: för få hus, vägar eller vatten träffar kartans. Kontrollera koordinatsystemet och lagrens symboler, eller använd passpunkter.",
  fitted: (meters: string, degrees: string, scale: string, median: string, share: number) =>
    `Inpassat: flyttat ${meters} m, vridet ${degrees}°, skala ${scale}. Efteråt skiljer det i mitten ${median} m, och ${share} % av punkterna ligger inom 1 mm på kartan.`,
  crsHelp: "Ur filen eller koordinaterna när det går; annars kartans. T.ex. 3006, 3011 (SWEREF 99 18 00), 3021 eller 4326.",
  layers: "Lager och symboler",
  layerShape: (points: number, lines: number, closed: number, areas: number) =>
    [points && plural(points, "punkt", "punkter"), lines && plural(lines, "linje", "linjer"), closed && plural(closed, "sluten linje", "slutna linjer"),
      areas && plural(areas, "yta", "ytor")].filter(Boolean).join(", "),
  skip: "Hoppa över",
  symbolFor: (layer: string) => `Symbol för ${layer}`,
  result: (objects: number, joined: number, duplicates: number, short: number, outside: number, mismatched: number, clipped: number,
    closedAreas: number, stairs: number, steps: number) =>
    `${plural(objects, "kandidat", "kandidater")}`
    + [joined && `${joined} hopslagna`, closedAreas && `${plural(closedAreas, "yta", "ytor")} av slutna linjer`,
      stairs && `${plural(stairs, "trappa", "trappor")} av ${steps} steg`, clipped && `${clipped} klippta vid kanten`, duplicates && `${duplicates} dubbletter borta`, short && `${short} korta stumpar borta`,
      outside && `${outside} utanför kartan`, mismatched && `${mismatched} med fel form`].filter(Boolean).map(part => ` · ${part}`).join(""),
  propose: (count: number) => `Lämna ${plural(count, "kandidat", "kandidater")} som förslag`,
  sending: (done: number, total: number) => `Skickar ${done} av ${total} …`,
  dwgSent: (file: string) => `${file} läses på geo-servern. Läs in ritningen under Laserdata och Karttapullautin → Jobben när den är klar.`,
  sent: (count: number) => `${plural(count, "förslag", "förslag")} lämnade. Godkänn eller avvisa dem under Förslag.`,
  note: (file: string, part: number, parts: number) => `Import ${file}${parts > 1 ? `, del ${part} av ${parts}` : ""}`.slice(0, 500),
  cancel: "Avbryt",
  profileUsed: (name: string, matched: number, layers: number) => `Symbolerna från profilen ”${name}” (${matched} av ${layers} lager).`,
  profileHeading: "Spara valen som profil",
  profileName: "Profilens namn (t.ex. Stockholms baskarta)",
  profileShare: "Dela med projektets klubb",
  profileSave: "Spara profilen",
  profileSaved: "Profilen är sparad. Nästa fil med samma lager får samma symboler.",
  problems: {
    unsupported: "Välj en GeoJSON-, DXF-, DWG- eller Shapefile (.shp med .dbf och .prj, eller en .zip).",
    UNSUPPORTED_DWG_FILE: "Filen är ingen DWG-ritning (AutoCAD 2000 eller senare).",
    GEO_JOB_BUSY: "Du har redan två jobb på geo-servern som väntar eller pågår. Vänta tills något är klart.",
    MAP_FILE_TOO_LARGE: "Ritningen är för stor (högst 75 MB).",
    STORAGE_QUOTA_EXCEEDED: "Lagringsutrymmet räcker inte för ritningen.",
    crs: "Koordinatsystemet stöds inte (SWEREF 99, RT 90, UTM eller WGS 84).",
    generic: (status: number) => `Det gick inte (${status}).`,
    SOURCE_AREA_TOO_LARGE: "Området är för stort för en hämtning (högst omkring 40 km²). Välj en etapp.",
    SOURCE_THROTTLED: "För många hämtningar den senaste timmen. Försök igen senare.",
    SOURCE_UNAVAILABLE: "OpenStreetMap svarade inte just nu. Försök igen om en stund."
  }
} as const;
