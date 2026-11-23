import type { Texts } from "../lib/language";
import type { mapPrimarySv } from "./map-primary-sv";
import { nameList, plural } from "./plural";

export const mapPrimaryEn: Texts<typeof mapPrimarySv> = {
  check: "Primary source",
  checkHelp: "The file takes precedence over OpenStreetMap within its area: the base map leaves out OpenStreetMap's buildings, roads, railways, walls and fences there, for the kinds the file has. Paths, the laser and the vegetation are not affected.",
  kinds: { buildings: "buildings", roads: "roads", railway: "railway", bridges: "bridges", water: "water", walls: "walls", fences: "fences" },
  list: (kinds: readonly string[]) => nameList(kinds, "and"),
  heading: "Primary sources",
  source: (name: string, kinds: string) => `Primary source: ${name} (${kinds})`,
  find: "Look for OpenStreetMap's objects within the area",
  remove: "Remove the marking",
  removeHelp: "The map's objects do not change; the next base map includes OpenStreetMap there again.",
  noKinds: (name: string) => `${name} has no buildings, roads, railway, bridges, water, walls or fences in the draft and did not become a primary source.`,
  saved: (name: string) => `${name} is a primary source: the next base map skips OpenStreetMap within the file's area.`,
  failed: "The primary source could not be saved. Try again by loading the file again.",
  question: (kinds: string, count: number) => `Remove OpenStreetMap's ${kinds} within the area? (${plural(count, "object", "objects")})`,
  questionHelp: "The objects are marked on the map. Only what came from OpenStreetMap and has not been changed is removed, never anything drawn by hand. Undo puts them back.",
  yes: "Yes, remove",
  no: "No",
  searching: "Looking for OpenStreetMap's objects within the area …",
  removed: (count: number) => `${plural(count, "object", "objects")} from OpenStreetMap removed within the primary source.`,
  none: "None of OpenStreetMap's objects of those kinds lie unchanged within the area.",
  kept: (count: number) => ` ${plural(count, "other object", "other objects")} of those kinds within the area stay: drawn by hand, changed or of unknown origin (added before 21 November 2026 or as suggestions).`,
  skipped: (kinds: string, name: string) => `OpenStreetMap: ${kinds} skipped within ${name}.`
};
