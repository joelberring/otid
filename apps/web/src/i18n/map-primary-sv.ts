import { nameList, plural } from "./plural";

/** PLAN K4c Huvudkälla (ägaren 2026-11-23): en inläst vektorfil går före OpenStreetMap inom sitt område. */
export const mapPrimarySv = {
  check: "Huvudkälla",
  checkHelp: "Filen går före OpenStreetMap inom sitt område: grundkartan tar inte med OpenStreetMaps hus, vägar, järnvägar, murar och staket där, för de slag filen har. Stigarna, lasern och vegetationen påverkas inte.",
  kinds: { buildings: "hus", roads: "vägar", railway: "järnväg", bridges: "broar", water: "vatten", walls: "murar", fences: "staket" },
  list: (kinds: readonly string[]) => nameList(kinds),
  heading: "Huvudkällor",
  source: (name: string, kinds: string) => `Huvudkälla: ${name} (${kinds})`,
  find: "Leta efter OpenStreetMaps objekt inom området",
  remove: "Ta bort markeringen",
  removeHelp: "Kartans objekt ändras inte; nästa grundkarta tar med OpenStreetMap där igen.",
  noKinds: (name: string) => `${name} har inga hus, vägar, järnväg, broar, vatten, murar eller staket i utkastet och blev ingen huvudkälla.`,
  saved: (name: string) => `${name} är huvudkälla: nästa grundkarta hoppar över OpenStreetMap inom filens område.`,
  failed: "Huvudkällan kunde inte sparas. Försök igen genom att läsa in filen igen.",
  question: (kinds: string, count: number) => `Ta bort OpenStreetMaps ${kinds} inom området? (${plural(count, "objekt", "objekt")})`,
  questionHelp: "Objekten är markerade på kartan. Bara det som kom från OpenStreetMap och som ingen ändrat tas bort, aldrig egenritat. Ångra lägger tillbaka dem.",
  yes: "Ja, ta bort",
  no: "Nej",
  searching: "Letar efter OpenStreetMaps objekt inom området …",
  removed: (count: number) => `${plural(count, "objekt", "objekt")} från OpenStreetMap togs bort inom huvudkällan.`,
  none: "Inga av OpenStreetMaps objekt av de slagen ligger orörda inom området.",
  kept: (count: number) => ` ${plural(count, "annat objekt", "andra objekt")} av de slagen inom området lämnas kvar: egenritade, ändrade eller med okänt ursprung (inlagda före 21 november 2026 eller som förslag).`,
  skipped: (kinds: string, name: string) => `OpenStreetMap: ${kinds} hoppades över inom ${name}.`
};
