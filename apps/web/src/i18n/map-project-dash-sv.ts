import { plural } from "./plural";

/** Styrpunkter (auto + manuell redigering) i kartprojektets editor. */
export const mapProjectDashSv = {
  heading: "Styrpunkter",
  help: "Placerar styrpunkter på streckade linjer (hjälpkurvor, stigar) så att strecken faller rätt i skarpa böjar, vid lutningsstreck och i förgreningar.",
  scopeLabel: "Omfattning",
  scopes: {
    selected: "Markerade linjer",
    view: "Aktuellt utsnitt",
    map: "Hela kartan"
  },
  rules: {
    bends: "Skarpa böjar (hjälpkurvor & stigar)",
    slopeTags: "Lutningsstreck",
    junctions: "Stigförgreningar & korsningar",
    keepExisting: "Behåll befintliga styrpunkter"
  },
  preview: "Förhandsgranska",
  computing: "Räknar styrpunkter …",
  apply: "Placera styrpunkter",
  clear: "Rensa",
  adjustManual: "Justera manuellt",
  adjustManualHint: "Markera en streckad linje på kartan och klicka Justera styrpunkter för att finjustera.",
  toggleVertex: "Styrpunkt",
  toggleVertexHelp: "Slå av eller på styrpunkt på vald brytpunkt så att streckmönstret anpassas här.",
  modeButton: "Justera styrpunkter",
  modeHelp: "Klicka längs linjen för att lägga till eller ta bort styrpunkter, eller dra en diamant.",
  autoButton: "Auto styrpunkter",
  autoHelp: "Placera styrpunkter automatiskt på markerade streckade linjer.",
  modeHint: "Styrpunkter: klicka på linjen för att lägga till/ta bort styrpunkt, dra en diamant för att justera, Esc för att avsluta.",
  noSelection: "Markera minst en streckad linje först.",
  noView: "Kartan är inte redo ännu.",
  noneFound: "Inga nya styrpunkter behövdes.",
  previewSummary: (objects: number, added: number, bends: number, slopeTags: number, junctions: number) =>
    `${plural(objects, "objekt", "objekt")}, ${plural(added, "styrpunkt", "styrpunkter")}: ${bends} böjar, ${slopeTags} lutningsstreck, ${junctions} förgreningar.`,
  appliedSummary: (added: number, bends: number, slopeTags: number, junctions: number) =>
    added === 0
      ? "Inga nya styrpunkter behövdes."
      : `${plural(added, "styrpunkt placerad", "styrpunkter placerade")} (${bends} böjar, ${slopeTags} lutningsstreck, ${junctions} förgreningar).`,
  vertexAdded: "Styrpunkt tillagd.",
  vertexRemoved: "Styrpunkt borttagen."
};
