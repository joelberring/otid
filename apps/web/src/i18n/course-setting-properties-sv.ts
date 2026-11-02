/** ADR-0190: banans egenskaper i editorn (stigning, fast längd, banslag, poäng och ordning) och exporten av banor. */
const km = (meters: number) => `${(meters / 1000).toFixed(1).replace(".", ",")} km`;

export const coursePropertiesSv = {
  heading: (name: string) => `Egenskaper för ${name}`,
  kind: "Slag av bana",
  kinds: { NORMAL: "Vanlig bana", SCORE: "Poängbana" } as Record<"NORMAL" | "SCORE", string>,
  kindHelp: "En poängbana tas i valfri ordning och kan inte ha gafflingar.",
  climb: "Stigning (m)",
  climbHelp: "Tom = ingen stigning i beskrivningen och på kartan.",
  length: "Fast längd (m)",
  lengthHelp: (measured: string) => `Tom = uträknad längd (${measured}). En fast längd står i beskrivningen, på kartan och i tävlingen.`,
  measured: (min: number, max: number) => min === max ? km(min) : `${km(min)}–${km(max)}`,
  save: "Spara egenskaperna",
  saved: "Sparat",
  invalid: "Skriv ett heltal i meter (eller lämna tomt).",
  scoreTotal: (points: number, controls: number) => `${points} poäng på ${controls} ${controls === 1 ? "kontroll" : "kontroller"}`,
  points: (code: string) => `Poäng för ${code}`,
  pointsShort: "Poäng",
  order: {
    up: "Flytta upp",
    down: "Flytta ned",
    upLabel: (name: string) => `Flytta ${name} upp i listan`,
    downLabel: (name: string) => `Flytta ${name} ned i listan`,
    drag: "Dra banorna för att ändra ordningen. Ordningen gäller listan, utskriften, .ppen och överföringen till tävlingen."
  },
  /** Ångra efter omladdning. */
  history: {
    restored: (steps: number) => `Ångra fungerar för ${steps} ${steps === 1 ? "ändring" : "ändringar"} från förra gången.`,
    dropped: (steps: number) => `${steps} ${steps === 1 ? "ändring" : "ändringar"} från förra gången går inte att ångra: någon annan har ändrat samma sak sedan dess.`
  }
};
