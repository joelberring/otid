/** Steg 49: gafflingar som bild och struktur (enkel gaffling, fjäril) i arbetsytan och resultatlistorna. */
import type { ForkingProblem } from "@o-tid/domain";

type LegPoint = "START" | "FINISH" | number;
const point = (value: LegPoint) => value === "START" ? "Start" : value === "FINISH" ? "Mål" : String(value);
const km = (meters: number) => `${(meters / 1000).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km`;

export const forkingSv = {
  start: "Start",
  finish: "Mål",
  courseDiagram: (course: string) => `Banbild för ${course}: start till mål med gafflingarna`,
  runnerDiagram: (name: string, code: string) => `Banbild: ${name} sprang variant ${code}`,
  legButton: (from: string, to: string) => `Sträckan ${from}–${to}`,
  controlButton: (code: number, center: boolean) => center ? `Fjärilens mittkontroll ${code}` : `Kontroll ${code}`,
  branchButton: (letter: string, loop: boolean) => loop ? `Slinga ${letter}` : `Alternativ ${letter}`,
  branchNote: (entries: number, readOut: number) => `${entries} anm. · ${readOut} avl.`,
  // Banlistan
  variantsBelow: (count: number) => count === 1 ? "1 variant (se nedan)" : `${count} varianter (se nedan)`,
  title: "Gafflingar",
  editForking: "Redigera gafflingar",
  editForkingLabel: (course: string) => `Redigera gafflingar på ${course}`,
  makeForked: "Gaffla banan",
  makeForkedLabel: (course: string) => `Gaffla banan ${course}`,
  convert: "Gör om till struktur",
  convertLabel: (course: string) => `Gör om ${course} till struktur`,
  convertHelp: (added: number) => added === 0 ? "Varianterna går att beskriva som gafflingar. Då kan du redigera dem i bilden."
    : `Varianterna går att beskriva som gafflingar. Strukturen ger ${added} ${added === 1 ? "variant" : "varianter"} till.`,
  derivedHelp: "Bilden är räknad ur banfilens varianter. Redigera varianterna var för sig.",
  mode: "Gafflingssätt",
  modes: { BALANCED: "Utjämnad", UNEQUAL: "Fulgaffling" },
  modeHelp: {
    BALANCED: "Fjärilar och utjämnade gafflingar: alla varianter ska ha samma sträckor. Du får en varning annars.",
    UNEQUAL: "Alternativen behöver inte vara likvärdiga, bara nästan. Skillnaden visas som en upplysning."
  },
  modeSaved: (mode: "BALANCED" | "UNEQUAL") => mode === "BALANCED" ? "Banan är utjämnad." : "Banan är en fulgaffling.",
  warning: (legs: readonly { from: LegPoint; to: LegPoint; variantCodes: readonly string[] }[]) =>
    `Varianterna har inte samma sträckor: ${legs.slice(0, 6).map(leg =>
      `${point(leg.from)}–${point(leg.to)} (${[...new Set(leg.variantCodes)].join(", ")})`).join("; ")}${legs.length > 6 ? " …" : ""}`,
  notice: "Fulgaffling: alternativen är inte utjämnade. Det stoppar inget.",
  lengths: (shortest: number, longest: number) => shortest === longest ? `Alla varianter ${km(shortest)}`
    : `${km(shortest)}–${km(longest)}, skillnad ${Math.round(longest - shortest)} m`,
  length: (meters: number | null) => meters === null ? "–" : km(meters),
  difference: (meters: number | null) => meters === null || meters === 0 ? "" : `+${meters} m`,
  lengthColumn: "Längd",
  // Redigeringen
  editorTitle: (course: string) => `Gafflingar på ${course}`,
  editorHelp: "Tryck på en kontroll eller en sträcka i bilden för att lägga till en fjäril eller en gaffling. Skriv kontrollerna i varje alternativ.",
  addLoop: (code: number) => `Lägg till fjäril på ${code}`,
  removeLoop: "Ta bort fjärilen",
  addFork: (from: string, to: string) => `Lägg till gaffling på ${from}–${to}`,
  removeFork: "Ta bort gafflingen",
  addControl: "Lägg till kontroll",
  addControlCode: "Kod",
  removeControl: (code: number) => `Ta bort kontroll ${code}`,
  invalidCode: "Skriv en kontrollkod (ett heltal).",
  forkLegend: (number: number, letters: string) => `Gaffling ${number} (${letters})`,
  loopLegend: (center: number, letters: string) => `Fjäril vid ${center} (${letters})`,
  branchField: (letter: string) => `Alternativ ${letter}`,
  loopField: (letter: string) => `Slinga ${letter}`,
  addBranch: "Lägg till alternativ",
  addLoopBranch: "Lägg till slinga",
  removeBranch: (letter: string) => `Ta bort ${letter}`,
  branchHelp: "Kontrollkoder med mellanslag, t.ex. 41 42.",
  selectionHelp: "Välj en kontroll eller sträcka i bilden.",
  generated: (count: number) => count === 1 ? "1 variant" : `${count} varianter`,
  generatedTitle: "Varianterna som banan ger",
  noForks: "Ingen gaffling än: banan sparas som en vanlig bana.",
  previewForking: (variants: number, removed: number, renamed: number, reassigned: number) => [
    `${variants} ${variants === 1 ? "variant" : "varianter"}.`,
    removed > 0 ? `${removed} ${removed === 1 ? "variant" : "varianter"} försvinner.` : "",
    renamed > 0 ? `${renamed} ${renamed === 1 ? "löpare behåller" : "löpare behåller"} sin kontrollföljd under en ny kod.` : "",
    reassigned > 0 ? `${reassigned} ${reassigned === 1 ? "löpare får" : "löpare får"} en ny variant genom fördelningen.` : ""
  ].filter(Boolean).join(" "),
  saved: (recalculated: number) => recalculated === 0 ? "Gafflingarna är sparade." : `Gafflingarna är sparade. ${recalculated} ${recalculated === 1 ? "resultat räknades" : "resultat räknades"} om.`,
  problem: (problem: ForkingProblem) => {
    switch (problem.kind) {
      case "EMPTY_COURSE": return "Banan behöver minst en kontroll.";
      case "TOO_FEW_BRANCHES": return "En gaffling eller fjäril behöver minst två alternativ.";
      case "TOO_MANY_BRANCHES": return "En gaffling eller fjäril får ha högst fyra alternativ.";
      case "EMPTY_BRANCH": return "Varje alternativ och slinga behöver minst en kontroll.";
      case "SAME_BRANCHES": return "Två alternativ har samma kontroller.";
      case "LOOP_CONTAINS_CENTER": return "En slinga får inte innehålla fjärilens mittkontroll.";
      case "TOO_MANY_LETTERS": return "Banan har för många alternativ (högst 26 bokstäver).";
      case "TOO_MANY_VARIANTS": return `Banan ger ${problem.count} varianter; högst 100 går.`;
    }
  },
  // Resultatlistan och deltagarsidan
  showForking: "Visa gafflingar",
  variantLength: (code: string, meters: number | null, difference: number | null) =>
    `Variant ${code}${meters === null ? "" : ` · ${km(meters)}`}${difference ? ` (+${difference} m)` : ""}`,
  loopOrder: "Siffrorna visar i vilken ordning slingorna sprangs.",
  // Sträcktidsanalysen
  byLeg: "Per sträcka",
  byVariant: "Per variant",
  splitModeLabel: "Jämför sträckor",
  legHeading: (from: string, to: string) => `${from}–${to}`
} as const;
