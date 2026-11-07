import { plural } from "./plural";

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
  lengthHelpScore: "En poängbana har ingen uträknad längd. Skriv en fast längd om en längd ska stå i beskrivningen och på kartan.",
  measured: (min: number, max: number) => min === max ? km(min) : `${km(min)}–${km(max)}`,
  scale: "Skala för banan",
  scaleMap: (scale: string) => `1:${scale} (kartans)`,
  scaleHelp: "Skalan som banan skrivs ut i. Ringarnas storlek och var numren hamnar följer den, i editorn, förhandsvisningen och PDF:en. Välj den tidigt. Nummer som du placerat själv ligger kvar där de är (som i Purple Pen).",
  save: "Spara egenskaperna",
  saved: "Sparat",
  invalid: "Skriv ett heltal i meter (eller lämna tomt).",
  scoreTotal: (points: number, controls: number) => `${points} poäng på ${plural(controls, "kontroll", "kontroller")}`,
  points: (code: string) => `Poäng för ${code}`,
  /** Tomt fält: kodens första siffra (tiotalet) ger poängen, som i tävlingens rogaining. */
  pointsDefault: (code: string, points: number) => `Poäng för ${code}. Tomt = ${points} (kodens första siffra).`,
  pointsShort: "Poäng",
  order: {
    up: "Flytta upp",
    down: "Flytta ned",
    upLabel: (name: string) => `Flytta ${name} upp i listan`,
    downLabel: (name: string) => `Flytta ${name} ned i listan`,
    drag: "Dra banorna för att ändra ordningen. Ordningen gäller listan, utskriften, .ppen och överföringen till tävlingen."
  },
  /** Exporten av banor (Fil). */
  iof: {
    download: "Ladda ned IOF XML (banor)",
    help: "Banorna som IOF XML 3.0 CourseData, som Purple Pens export: en gafflad bana blir en bana per variant med banans namn som " +
      "familj (\"Lång AC\", \"Lång AD\"), så att MeOS, OLA och andra tidtagningsprogram läser varianterna. Klasserna tas från " +
      "banans klasser. Stafettlagens fördelning av varianter följer inte med.",
    ocad: "OCAD: O-Tid skriver inget eget OCAD-format. OCAD:s banläggning kan läsa banor i IOF XML 3.0 (importera banor från " +
      "IOF XML), med kontrollerna på samma kartlägen i mm. Kontrollbeskrivningar, specialobjekt och utskriftsinställningar följer " +
      "inte med; använd .ppen när banorna ska fortsätta i Purple Pen."
  },
  /** Banans längd längs vägval (extra uppgift, ADR-0190 beslut 6). */
  routeLength: {
    heading: "Längd längs vägval",
    help: "Summan av bästa vägvalen på kartan för varje sträcka, bredvid fågelvägen. Bara en uppgift; banans längd är fågelvägen.",
    variant: (code: string) => `Variant ${code}.`,
    count: "Räkna längs vägval",
    again: "Räkna klart",
    running: (done: number, total: number) => `Räknar … ${done} av ${total} sträckor`,
    partial: (done: number, total: number) => `${done} av ${total} sträckor räknade.`,
    done: (best: number, straight: number, percent: number) => `Längs bästa vägval ${km(best)}, fågelvägen ${km(straight)}` +
      (percent > 0 ? ` (${percent} % längre).` : "."),
    noRoute: (legs: number) => `${plural(legs, "sträcka", "sträckor")} saknar väg på kartan; längden kan inte räknas.`,
    noMap: "Längd längs vägval räknas på kartfilen. Ladda upp kartfilen först.",
    failed: "Vägvalen kunde inte räknas.",
    noLegs: "Banan har inga sträckor än."
  },
  /** Ångra efter omladdning. */
  history: {
    restored: (steps: number) => `Ångra fungerar för ${plural(steps, "ändring", "ändringar")} från förra gången.`,
    dropped: (steps: number) => `${plural(steps, "ändring", "ändringar")} från förra gången går inte att ångra: någon annan har ändrat samma sak sedan dess.`
  }
};
