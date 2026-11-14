import type { Texts } from "../lib/language";
import type { mapMarkingSv, MarkingFacts } from "./map-marking-sv";

const number = (value: number) => value.toLocaleString("en-GB");
const SETTING: Readonly<Record<string, string>> = { contour_interval: "contour interval (m)", formline: "form lines", formlinesteepness: "form lines in steep ground", smoothing: "smoothing",
  curviness: "curviness", knolls: "knolls", knollshare: "knoll ring", greenscale: "green", openshare: "open", denseshare: "dense", rock: "rock", paved: "paved" };

export const mapMarkingEn: Texts<typeof mapMarkingSv> = {
  heading: "Made with O-Tid",
  paragraphs: (facts: MarkingFacts): string[] => [
    `${facts.host} · ${facts.date} · geo worker ${facts.worker}`,
    `The map is produced by machine from Lantmäteriet's laser data${facts.scannedAt ? ` (scanned ${facts.scannedAt})` : ""}, OpenStreetMap (© OpenStreetMap contributors) and data from the Swedish Forest Agency. It has not been checked in the terrain and may contain errors.`,
    "Use: The map may be used freely for personal use; the right of public access applies to the individual. Trainings, competitions and other events require consultation in advance with landowners and holders of hunting rights, according to the rules of the Swedish Orienteering Federation. If an orienteering club has a map of the area, contact the club first: clubs often have agreements with the landowners that must not be disturbed.",
    [`Settings: scale 1:${number(facts.scale)}`, ...facts.settings.map(([name, value]) => `${SETTING[name] ?? name} ${number(value)}`),
      ...(facts.calm !== undefined ? [`calm contours ${facts.calm}`] : []),
      ...(facts.clear ? [`clearer contours ${facts.clear.join("/")}`] : [])].join(" · ")
  ],
  added: (paper: string) => ` The map has been given a frame (${paper}), the O-Tid logo and a box about how the map was made and may be used. They are in the layer "O-Tid" and can be hidden or removed.`,
  paper: (size: string, landscape: boolean) => `${size} ${landscape ? "landscape" : "portrait"}`,
  noPaper: "larger than A0"
};
