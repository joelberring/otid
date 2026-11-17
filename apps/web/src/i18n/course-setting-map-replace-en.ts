import type { Texts } from "../lib/language";
import type { mapReplaceSv } from "./course-setting-map-replace-sv";

/** English: replace the map file in course setting. */
export const mapReplaceEn: Texts<typeof mapReplaceSv> = {
  menu: "Replace map file …",
  heading: "Replace map file",
  current: (fileName: string, scale: string) => `Now: ${fileName} · 1:${scale}`,
  help: "For a new version of the map, e.g. from the mapper or the course setter. Courses and controls stay at the same map coordinates: if it is the same map, revised, they end up right. The map image in Map and route choice is replaced at the same time.",
  unsaved: "The unsaved course setting could not be sent. Wait until it is saved and try again.",
  replaced: (fileName: string) => `The map file is now ${fileName}.`,
  outside: (count: number) => count === 1 ? "1 control lies outside the new map; check it." : `${count} controls lie outside the new map; check them.`,
  checkPhone: "If you saved the course setting on your phone, save it again so that the new map goes with it."
};
