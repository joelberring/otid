import { plural } from "./plural";

/** ADR-0219 tillägget om rekningen (K3): rekningen i kartprojektets editor. */
const percent = (share: number) => `${Math.round(share * 100)} %`;
const km = (meters: number) => meters >= 1000 ? `${(meters / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km` : `${Math.round(meters)} m`;

export const mapProjectReconSv = {
  heading: "Rekning",
  help: "GPS-spåren bockar av det man gått förbi. Bekräfta det du sett med Kollad. Lagren skrivs aldrig ut.",
  layers: { label: "Lager", STATUS: "Status", COVERAGE: "Täckning", TRACKS: "Spår" },
  legend: { UNSEEN: "Ej rekat", PASSED: "Passerat (GPS)", CHECKED: "Kollat" },
  counts: (unseen: number, passed: number, checked: number) => `${unseen} ej rekade · ${passed} passerade · ${checked} kollade`,
  computing: "Räknar …",
  noGeoreference: "Kartan saknar georeferens, så GPS-spår kan inte läggas på den.",
  record: "Spela in spår",
  recordName: "Spårets namn",
  recordDefault: (time: string) => `Rekning ${time}`,
  stop: "Stoppa",
  recording: (meters: number, points: number) => `Spelar in · ${km(meters)} · ${plural(points, "punkt", "punkter")}`,
  recordingHelp: "Ha sidan öppen och skärmen på; mobilen spelar inte in pålitligt med släckt skärm. För långa rundor: spela in med klockan och läs in GPX-filen.",
  gpx: "Läs in GPX-fil",
  tracks: "Spår",
  noTracks: "Inga spår än.",
  /** Utan namn på personen: det egna spåret. */
  track: (name: string, person: string | null, date: string, meters: number) => [name, person, date, km(meters)].filter(Boolean).join(" · "),
  waiting: "väntar på nät",
  failed: (status: number) => `skickades inte (${status})`,
  rename: "Byt namn",
  remove: "Ta bort",
  removeConfirm: "Ta bort spåret? Bockarna står kvar.",
  privacy: "Spåren syns bara för projektets medlemmar. Du kan ta bort dina egna.",
  checked: "Kollad ✓",
  unchecked: "Markera kollad",
  checkedBy: (name: string | null, date: string) => `Kollad av ${name ?? "okänd"} ${date}`,
  approveArea: (count: number) => `Godkänn ${plural(count, "passerat", "passerade")}`,
  areaProgress: (covered: number, seen: number, checked: number, objects: number) =>
    `Täckt ${percent(covered)} · objekt ${percent(seen)} sedda, ${percent(checked)} kollade (${objects})`,
  settings: "Siktavstånd",
  settingsHelp: "Hur nära (meter) ett spår ska ha gått för att objektet räknas som passerat. Krymps i tät vegetation.",
  groups: { LANDFORMS: "Terrängformer", ROCK: "Berg och branter", STONES: "Stenar", WATER: "Vatten och sankmark", VEGETATION: "Vegetation", MANMADE: "Anläggningar" },
  lineShare: "Andel av en linje (%)",
  areaShare: "Andel av en yta (%)",
  coverM: "Täckningens bredd (m)",
  save: "Spara",
  reset: "Förval",
  position: { off: "Visa min position", on: "Följ min position", follow: "Dölj min position" },
  pointHere: (code: string) => `${code} här`,
  walkLine: (code: string) => `Gå ${code}`,
  walkStop: "Klar",
  walking: (points: number) => `Går linjen · ${plural(points, "punkt", "punkter")}`,
  problems: {
    insecure: "Positionen kräver https.",
    unsupported: "Webbläsaren ger ingen position.",
    denied: "Webbläsaren får inte använda positionen. Tillåt platstjänster för sidan.",
    timeout: "Ingen position än.",
    unavailable: "Positionen är inte tillgänglig.",
    crs: "Kartans koordinatsystem stöds inte för GPS.",
    noStore: "Spåret kan inte sparas i webbläsaren (privat läge?). Det skickas medan sidan är öppen.",
    trackFull: "Spåret blev för långt och stoppades. Starta ett nytt.",
    gpx: "Filen gick inte att läsa som GPX.",
    gpxEmpty: "GPX-filen har inga punkter.",
    generic: (status: string) => `Det gick inte (${status}).`
  }
} as const;
