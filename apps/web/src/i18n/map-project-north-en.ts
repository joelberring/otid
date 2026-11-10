import type { Texts } from "../lib/language";
import type { mapProjectNorthSv } from "./map-project-north-sv";

const degrees = (value: number) => `${value.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°`;

/** ADR-0223: the map's north compared with today's magnetic north (World Magnetic Model). */
export const mapProjectNorthEn: Texts<typeof mapProjectNorthSv> = {
  heading: "Magnetic north",
  map: (value: number) => `The map's north lines are drawn for the declination ${degrees(value)}.`,
  lines: (value: number, lines: number) => `The north lines in the map lean ${degrees(lines)} from the map edge and are drawn for a declination of ${degrees(value)}.`,
  noAngle: (value: number) => `The map file gives no angle for the north lines (0°), so they are assumed to point to the grid's north (declination ${degrees(value)} here). If the map is drawn to magnetic north, the comparison below is wrong; check the georeference in OCAD or Mapper.`,
  today: (value: number, date: string) => `The declination on ${date} according to the World Magnetic Model: ${degrees(value)}.`,
  difference: (value: number) => Math.abs(value) < 0.5 ? "The map points to today's magnetic north (difference under half a degree)."
    : `Difference ${degrees(Math.abs(value))} ${value > 0 ? "to the east" : "to the west"}: with a compass the map's north lines are that much off.`,
  invalid: "The date is outside World Magnetic Model 2025 (2025–2030); the value is less certain.",
  noGeoreference: "The map has no known coordinate system, so the declination cannot be calculated.",
  later: "Re-orienting the map (rotating the objects and drawing new north lines) is planned but not built yet."
};
