import { plural } from "./plural";

type Base = "black" | "brown" | "yellow" | "green" | "blue";
const BASES: Record<Base, string> = { black: "svart", brown: "brun", yellow: "gul", green: "grön", blue: "blå" };
const pct = (tint: number) => `${Math.round(tint * 100)} %`;
const mm = (value: number) => `${value.toLocaleString("sv-SE", { maximumFractionDigits: 2 })} mm`;

/** Ägaren 2026-11-23: symbolerna mot ISSprOM 2019-2 (färger, bredder, kanter), saknade normsymboler och kanten runt husen. */
export const mapProjectSymbolNormSv = {
  heading: "Symbolerna mot ISSprOM 2019-2",
  help: "Kartans symboler (färg, linjebredd, kant) mot normen, för de symboler kartan använder, och normens symboler som saknas i kartan. Värdena kommer ur IOF:s O-Map Wiki; där wikin inte anger ett mått jämförs det inte.",
  check: "Kontrollera symbolerna",
  checking: "Kontrollerar …",
  forest: "Kontrollen finns för sprintkartor (ISSprOM 2019-2). Skogskartor (ISOM 2017-2) har ingen tabell än.",
  none: "Symbolerna som kartan använder följer normens tabell.",
  count: (count: number) => `${plural(count, "symbol", "symboler")} avviker från normen.`,
  problem: (problem: { kind: string; base?: Base; tints?: readonly number[]; found?: { base?: Base | undefined; tint?: number | undefined } | null | number; width?: number }) => {
    switch (problem.kind) {
      case "FILL": {
        const found = typeof problem.found === "object" && problem.found ? problem.found : undefined;
        const now = found?.base ? (found.tint !== undefined && found.tint >= 0.99 ? `hel${BASES[found.base]}` : `${BASES[found.base]} ${pct(found.tint ?? 0)}`) : "en annan färg";
        return `${now}, normen säger ${BASES[problem.base!]} ${(problem.tints ?? []).map(pct).join(" eller ")}`;
      }
      case "OUTLINE": return "saknar svart kant";
      case "LINE_COLOR": return `linjen ska vara ${BASES[problem.base!]}`;
      case "LINE_WIDTH": return `linjen ${mm(typeof problem.found === "number" ? problem.found : 0)}, normen säger ${mm(problem.width ?? 0)}`;
      case "STEPS": return "ritas som en löpande linje, normen säger generaliserade trappsteg";
      default: return problem.kind;
    }
  },
  fix: "Rätta",
  fixAll: (count: number) => `Rätta symbolerna efter normen (${count})`,
  fixed: "Rättad i projektet (syns i ritläget och i nästa kartversion).",
  outlinesHint: "Kanten ritas som linjer runt sammanhängande hus: Lägg kant runt husen.",
  cannotFix: "O-Tids mall rättar inte det här; ändra symbolen i Mapper.",
  onlyOwner: "Bara projektets ägare kan rätta symbolerna.",
  ocad: "Symbolerna skrivs inte i OCAD-filer här. Spara kartan i Mapper (.omap) för att rätta dem.",
  failed: "Det gick inte att spara. Försök igen.",
  source: "Källa",
  missing: (count: number) => `${plural(count, "symbol", "symboler")} ur normen saknas i kartan:`,
  addMissing: (count: number) => `Lägg till saknade normsymboler (${count})`,
  added: "Tillagda i projektets palett (finns i symbolpanelen och i importens val).",
  undone: "Ta bort rättningarna",
  outlines: "Lägg kant runt husen",
  outlinesHelp: "Svart kant runt alla hus (521) med kartans kantsymbol (521.1). Hus som rör varandra får en gemensam kant, utan väggen emellan. Går att ångra.",
  outlinesBusy: "Räknar kanten …",
  outlinesDone: (added: number, removed: number, houses: number) => added + removed === 0
    ? `Kanten runt ${plural(houses, "hus", "hus")} stämmer redan.`
    : `${plural(added, "kantlinje", "kantlinjer")} runt ${plural(houses, "hus", "hus")}${removed ? `, ${plural(removed, "gammal", "gamla")} ersatt${removed === 1 ? "" : "a"}` : ""}.`
} as const;
