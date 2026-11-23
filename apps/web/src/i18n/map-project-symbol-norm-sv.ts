import { plural } from "./plural";

type Base = "black" | "brown" | "yellow" | "green" | "blue";
const BASES: Record<Base, string> = { black: "svart", brown: "brun", yellow: "gul", green: "grön", blue: "blå" };
const pct = (tint: number) => `${Math.round(tint * 100)} %`;
const mm = (value: number) => `${value.toLocaleString("sv-SE", { maximumFractionDigits: 2 })} mm`;

/** Ägaren 2026-11-23: symbolerna mot ISSprOM 2019-2 (färger, bredder, kanter), saknade normsymboler och kanten runt husen. */
export const mapProjectSymbolNormSv = {
  repairHeading: "Rätta efter sprintnormen",
  repairHelp: "En befintlig karta rättas här utan att något läses in igen: symbolerna, kanten runt husen, trapporna, tomtmarken, kärr och stigar i bebyggt, dubbletter och stora ytor, i den ordningen. Varje steg går att ångra (Ctrl+Z) utom symbolerna, som tas bort med «Ta bort rättningarna».",
  survey: "Gå igenom kartan",
  surveying: "Går igenom kartan …",
  step: (index: number, title: string) => `${index}. ${title}`,
  stepSymbols: "Symbolerna",
  stepOutlines: "Kant runt husen",
  stepStairs: "Förenkla trappor",
  stepYards: "Tomtmark kring flerbostadshus",
  outlinesCount: (added: number, removed: number) => added + removed === 0 ? "Kanten stämmer redan." : `${plural(added, "kantlinje", "kantlinjer")} att lägga till${removed ? `, ${plural(removed, "gammal", "gamla")} att ersätta` : ""}.`,
  outlinesNone: "Kartans byggnad har egen kant, eller kartan har ingen kantsymbol (521.1): inget att göra.",
  stairsCount: (stairs: number, steps: number) => stairs === 0 ? "Inga trappsteg som egna linjer (trapporna är redan mittlinjer)." : `${plural(stairs, "trappa", "trappor")} av ${plural(steps, "trappsteg", "trappsteg")} som egna linjer.`,
  stairsRun: (count: number) => `Förenkla trappor (${count})`,
  stairsDone: (count: number) => `${plural(count, "trappa", "trappor")} förenklade.`,
  yardsCount: (count: number) => count === 0 ? "Ingen 520-yta kring flerbostadshus." : `${plural(count, "yta", "ytor")} 520 (område som inte får beträdas) med hus över 400 m²: gårdar som normalt är öppna.`,
  yardsMark: "Markera på kartan",
  yardsRemove: (count: number) => `Ta bort (${count})`,
  yardsDone: (count: number) => `${plural(count, "yta", "ytor")} borttagna.`,
  stepWater: "Kärr och bäckar i bebyggt",
  waterHelp: "Sankmark (307–310), diken och små bäckar (305, 306) inom avståndet från hus, hårdgjord yta, kantlinjer och tomtmark. En sankmark tas bort när minst hälften ligger där; ett dike klipps.",
  waterMetres: "Bebyggt inom",
  waterCount: (count: number) => count === 0 ? "Inga kärr eller bäckar i bebyggt." : `${plural(count, "objekt", "objekt")} i bebyggt.`,
  waterRemove: (count: number) => `Ta bort kärr och bäckar i bebyggt (${count})`,
  stepPaths: "Stigar i vägar",
  pathsHelp: "Stigar (505–507) inne i hårdgjord yta, längs en kant inom 3 m eller mitt i en gata mellan två kanter; stigar som korsar vägen står kvar fram till kanten.",
  pathsCount: (count: number) => count === 0 ? "Inga stigar i vägar." : `${plural(count, "stig", "stigar")} i vägar.`,
  pathsRemove: (count: number) => `Ta bort stigar i vägar (${count})`,
  stepRings: "Små kantringar",
  ringsHelp: "Slutna kantlinjer (501.1) som är för små eller smala för att synas som en ö: refuger och stolpfundament ur baskartan som blir «D» längs gångvägarna.",
  ringsCount: (count: number) => count === 0 ? "Inga små kantringar." : `${plural(count, "kantring", "kantringar")}.`,
  ringsRemove: (count: number) => `Ta bort små kantringar (${count})`,
  stepDuplicates: "Ta bort dubbletter",
  duplicatesHelp: "Ytor med samma symbol som överlappar till minst 90 %, linjer och punkter med samma symbol på samma ställe, och ljusare grönt (406, 408) som till minst 90 % täcks av mörkare grönt: grundkartans kapslade grönt lade en fläck 410 som tre ytor med samma kant. Den största står kvar. Gäller också skogskartor.",
  duplicatesCount: (count: number) => count === 0 ? "Inga dubbletter." : `${plural(count, "dubblett", "dubbletter")}:`,
  duplicatesRemove: (count: number) => `Ta bort dubbletter (${count})`,
  stepLarge: "Dela stora ytor",
  largeHelp: "Markytor (gult, grönt, tomtmark, hårdgjord yta, berg, kärr) över 3 ha på en sprintkarta och 20 ha på en skogskarta delas i bitar kant i kant, där ytan är smalast längs ett rutnät som följer kartans norr (150 m respektive 400 m), så att de går att ändra. Kurvorna i en delad yta blir raka linjer. Nya ytor ur grundkartan, Fyll och Utvidga delas på samma sätt.",
  largeCount: (count: number) => count === 0 ? "Inga ytor över gränsen." : `${plural(count, "yta", "ytor")} över gränsen.`,
  largeSplit: (count: number) => `Dela stora ytor (${count})`,
  cleanDone: (count: number) => `${plural(count, "objekt", "objekt")} ändrade. Ångra tar tillbaka dem.`,
  help: "Kartans symboler (färg, linjebredd, kant) mot normen, för de symboler kartan använder, och normens symboler som saknas i kartan. Värdena kommer ur IOF:s O-Map Wiki; där wikin inte anger ett mått jämförs det inte.",
  forest: "Kontrollen finns för sprintkartor (ISSprOM 2019-2). Skogskartor (ISOM 2017-2) har ingen tabell än.",
  none: "Symbolerna som kartan använder följer normens tabell.",
  count: (count: number) => `${plural(count, "symbol", "symboler")} avviker från normen.`,
  problem: (problem: { kind: string; base?: Base; tints?: readonly number[]; found?: { base?: Base | undefined; tint?: number | undefined } | null | number; width?: number; above?: readonly string[] }) => {
    switch (problem.kind) {
      case "FILL": {
        const found = typeof problem.found === "object" && problem.found ? problem.found : undefined;
        const now = found?.base ? (found.tint !== undefined && found.tint >= 0.99 ? `hel${BASES[found.base]}` : `${BASES[found.base]} ${pct(found.tint ?? 0)}`) : "en annan färg";
        return `${now}, normen säger ${BASES[problem.base!]} ${(problem.tints ?? []).map(pct).join(" eller ")}`;
      }
      case "OUTLINE": return "saknar svart kant";
      case "LINE_COLOR": return `linjen ska vara ${BASES[problem.base!]}`;
      case "LINE_WIDTH": return `linjen ${mm(typeof problem.found === "number" ? problem.found : 0)}, normen säger ${mm(problem.width ?? 0)}`;
      case "STEPS": return "saknar trappsteg tvärs linjen";
      case "STAIR_BAND": return "saknar trappans band i brunt 30 % (som Mappers ISSprOM 2019-2)";
      case "STAIR_SIDES": return "saknar svarta kantlinjer på sidorna (som Mappers ISSprOM 2019-2)";
      case "STAIR_ORDER": return `bandet ligger under ${(problem.above ?? []).join(", ")} i färgordningen och syns inte där (trappan får en egen brun 30 % ovanför ytorna)`;
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
