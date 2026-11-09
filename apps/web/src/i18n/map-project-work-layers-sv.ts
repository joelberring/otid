import { plural } from "./plural";

/** Ägaren 2026-11-09, lagren fas 2: arbetslager (normens symboler i egna grupper) och skisslager. */
export const mapProjectWorkLayersSv = {
  workHeading: "Arbetslager",
  workHelp: "Egna grupper av normens symboler, t.ex. ”Stigar att reka” eller ”Byggnader och murar”. Lagren delas i projektet; vad "
    + "som syns, är låst eller tonat väljer var och en.",
  workNone: "Inga arbetslager ännu.",
  symbols: (count: number) => plural(count, "symbol", "symboler"),
  newWork: "Nytt arbetslager",
  name: "Namn",
  pick: "Symboler",
  filter: "Sök symbol",
  create: "Skapa lagret",
  remove: "Ta bort",
  removeWork: (name: string) => `Ta bort arbetslagret ${name}? Symbolerna och objekten finns kvar.`,
  sketchHeading: "Skisslager",
  sketchHelp: "Skisser som inte hör till kartan, t.ex. från fältet: dra för en linje, klicka för en punkt eller (med en text) en "
    + "text. De skrivs aldrig till kartfilen.",
  sketchNone: "Inga skisslager ännu.",
  sketches: (count: number) => plural(count, "skiss", "skisser"),
  newSketch: "Nytt skisslager",
  color: "Färg",
  colors: { "#c0262d": "Röd", "#1f5fbf": "Blå", "#1d8a3a": "Grön", "#7a3fb0": "Lila", "#d4570b": "Orange", "#000000": "Svart" } as Record<string, string>,
  draw: "Rita",
  drawing: "Ritar",
  drawIn: (name: string) => `Rita i ${name}`,
  removeSketchLayer: (name: string, count: number) => `Ta bort skisslagret ${name} med ${plural(count, "skiss", "skisser")} för alla i projektet?`,
  hint: (name: string) => `Skissa i ${name}: dra för en linje, klicka för en punkt (eller en text om du skrivit en).`,
  textLabel: "Text vid klick",
  undo: "Ångra skiss",
  done: "Klar",
  problem: (status: number) => status === 403 ? "Bara den som skapade lagret eller skissen och ägarna kan ändra den." : `Det gick inte (${status}).`
};
