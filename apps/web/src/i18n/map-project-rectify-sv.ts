/** ADR-0219 K6b: rätta kartan med passpunkter. */
type Kind = "similarity" | "affine" | "rubber";
const kindName: Record<Kind, string> = { similarity: "likformig", affine: "affin", rubber: "gummiduk" };
const meters = (value: number) => value.toLocaleString("sv-SE", { maximumFractionDigits: value < 10 ? 1 : 0 });

export const mapProjectRectifySv = {
  heading: "Rätta kartan med passpunkter",
  help: "För en äldre karta som ligger fel mot ortofoto, laser eller vägar. Lägg underlaget ovanpå, klicka där något ligger på kartan "
    + "(en vägkorsning, ett hus, en sjöstrand) och sedan där det ska ligga. Sprid punkterna över kartan. Inget ändras direkt: "
    + "alla objekt flyttas som förslag som ägaren godkänner.",
  start: "Sätt passpunkter",
  stop: "Klar med punkterna",
  hintFrom: "Rätta kartan: klicka där något ligger på kartan nu.",
  hintTo: "Rätta kartan: klicka där det ska ligga.",
  none: "Inga passpunkter ännu.",
  point: (index: number, value: string) => `Punkt ${index}: ${value}`,
  residual: (meter: number) => `${meters(meter)} m`,
  removePoint: (index: number) => `Ta bort punkt ${index}`,
  kind: "Hur kartan rättas",
  kinds: {
    similarity: "Likformig: flytta, vrida och skala (2 punkter eller fler)",
    affine: "Affin: också olika skala och snedhet (3 eller fler)",
    rubber: "Gummiduk: exakt genom punkterna, mjukt emellan (3 eller fler)"
  } satisfies Record<Kind, string>,
  fit: (kind: Kind, meter: number) => kind === "rubber" ? `Gummiduk: punkterna hamnar exakt; böjning utöver affin i medel ${meters(meter)} m`
    : `${kind === "affine" ? "Affin" : "Likformig"}: medelavvikelse ${meters(meter)} m`,
  where: "Område",
  whole: "Hela kartan",
  preview: "Räkna fram flytten",
  computing: "Räknar …",
  summary: (count: number, meanM: number, maxM: number) => count === 0 ? "Inga objekt flyttas."
    : `${count} objekt flyttas, i medel ${meters(meanM)} m och som mest ${meters(maxM)} m.`,
  skipped: (count: number) => count === 0 ? "" : `${count} objekt har egna ändringar som inte skickats eller en krock och hoppas över.`,
  propose: (count: number) => count === 1 ? "Lämna 1 flytt som förslag" : `Lämna ${count} flyttar som förslag`,
  undo: "Ångra senaste",
  clear: "Börja om",
  sending: (done: number, total: number) => `Skickar förslag ${done} av ${total} …`,
  sent: (count: number) => count === 1 ? "Förslaget är skickat. Ägaren ser det under Förslag." : `${count} förslag är skickade. Ägaren ser dem under Förslag.`,
  note: (kind: Kind, points: number, part: number, total: number) =>
    `Rättad med ${points} passpunkter (${kindName[kind]})` + (total > 1 ? ` (del ${part} av ${total})` : ""),
  failed: (status: number | string) => `Förslaget kunde inte skickas (${status}).`,
  morePoints: (count: number) => `… och ${count} till`,
  apply: (count: number) => count === 1 ? "Flytta 1 objekt direkt" : `Flytta ${count} objekt direkt`,
  applied: (count: number) => `${count} objekt är flyttade. Ångra tar tillbaka allt i ett steg.`,
  laser: {
    heading: "Passpunkter ur lasern",
    help: "För en karta vars höjdkurvor inte ligger på laserns mark. O-Tid söker, del för del av kartan, den flytt som får kartans höjdkurvor att ligga på jämn höjd i laserns höjdmodell, och gör passpunkter av det. Gummiduken flyttar sedan alla objekt, så att stenar, stigar och annat följer med kurvorna de är ritade mot.",
    none: "Inget klart laserjobb har markens höjd sparad (hojd.png). Kör lasern först.",
    job: "Laserjobb",
    run: "Sök passpunkter",
    reading: "Läser kartans höjdkurvor och markens höjd …",
    fitting: (done: number, total: number) => `Passar in del ${done} av ${total} …`,
    noContours: "Kartan har inga höjdkurvor (101, 102) att passa in.",
    noNodes: "För få höjdkurvor inom laserns område för att passa in kartan.",
    failed: "Markens höjd kunde inte läsas.",
    done: (points: number, before: string, after: string, median: string, max: string) =>
      `${points} passpunkter. Kurvornas avvikelse från jämn höjd: ${before} → ${after} m. Flytten är ${median} m i median och ${max} m som mest. Välj «Räkna fram flytten» för att se resultatet.`
  }
} as const;
