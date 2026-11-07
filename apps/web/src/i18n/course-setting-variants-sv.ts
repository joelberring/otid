import { plural } from "./plural";
/** ADR-0198: varianterna av en gafflad bana och färre gafflingsvarianter i banläggningen. */
const km = (meters: number) => `${(meters / 1000).toFixed(2).replace(".", ",")} km`;

export const courseVariantsSv = {
  heading: "Varianter",
  summary: (total: number, kept: number) => kept === total ? `${plural(total, "variant", "varianter")}, alla används`
    : `${plural(total, "variant", "varianter")}, ${kept} används (${total - kept} bortvald${total - kept === 1 ? "" : "a"})`,
  help: "Bortvalda varianter förs inte över till tävlingen, lottas inte ut, skrivs inte i IOF XML och skrivs inte ut. " +
    "Avläsningen känner ändå igen en löpare som sprungit en bortvald variant.",
  table: {
    caption: (name: string) => `Varianterna av ${name}`,
    used: "Används",
    code: "Variant",
    straight: "Fågelväg",
    route: "Vägval",
    controls: "Kontr.",
    difference: "Mot kortaste",
    shortest: "kortast",
    notCounted: "–",
    noRoute: "ingen väg",
    use: (code: string) => `Använd variant ${code}`,
    goes: "tas bort",
    stays: "behålls"
  },
  km,
  difference: (meters: number, percent: number) => `+${meters} m (${percent} %)`,
  route: {
    count: "Räkna längs vägval",
    again: "Räkna klart",
    running: (done: number, total: number) => `Räknar längs vägval … ${done} av ${total} sträckor`,
    partial: (done: number, total: number) => `${done} av ${total} sträckor räknade längs vägval.`,
    done: "Längden längs vägval är räknad för alla varianter och jämförs också.",
    noMap: "Längd längs vägval räknas på kartfilen. Ladda upp kartfilen först.",
    failed: "Vägvalen kunde inte räknas."
  },
  prune: {
    heading: "Begränsa varianter",
    mode: "Sätt",
    modes: { LONGEST: "Ta bort de längsta", DOMINATED: "Längst i alla avseenden (alla)", CAP: "Tak: procent eller antal" } as Record<"LONGEST" | "DOMINATED" | "CAP", string>,
    longest: (max: number) => `Antal att ta bort (1–${max})`,
    longestHelp: (route: boolean) => `De längsta ${route ? "längs vägval" : "fågelvägen"} tas bort först, men bara de som är längre i alla ` +
      "avseenden än en variant som blir kvar.",
    longestInvalid: (max: number) => `Skriv ett heltal från 1 till ${max}.`,
    dominatedHelp: (route: boolean) => route
      ? "Alla varianter som en annan inte är längre än fågelvägen eller längs vägval, och kortare i något av dem, tas bort."
      : "Bara fågelvägen jämförs (räkna längs vägval för att jämföra det också): då blir bara de kortaste kvar.",
    capHelp: "De kortaste behålls. Fyll i det ena eller båda.",
    percent: "Högst % längre än kortaste",
    count: "Högst antal varianter",
    preview: "Förhandsgranska",
    apply: (count: number) => `Ta bort ${plural(count, "variant", "varianter")}`,
    cancel: "Avbryt",
    nothing: "Inget att ta bort med de valen.",
    goes: (count: number) => `Tas bort (${count}):`,
    stays: (count: number) => `Behålls (${count}):`,
    reasons: {
      LONGEST: (by: string | undefined) => by ? `längre än ${by}` : "längre",
      DOMINATED: (by: string | undefined) => by ? `längre än ${by}` : "längre",
      OVER_PERCENT: () => "över procentgränsen",
      OVER_COUNT: () => "över antalet"
    },
    needed: (what: string) => `behövs för ${what}`,
    last: "sista varianten",
    control: (code: string) => `kontroll ${code}`,
    leg: (from: string, to: string) => `sträckan ${from}–${to}`,
    invalid: "Skriv ett heltal (eller lämna tomt)."
  },
  useAll: "Använd alla varianter",
  unused: (what: readonly string[]) => `Används inte av någon variant: ${what.join(", ")}.`,
  tooMany: (count: number) => `${count} varianter används. Tävlingen tar högst 100 per bana; välj bort fler innan banorna förs över.`,
  relay: "Banan har stafettlag. En utjämnad stafett behöver alla varianter för att lagen ska springa samma sträckor; " +
    "välj bara bort varianter för en fulgafflad stafett.",
  failed: "Varianterna kunde inte ändras."
};
