import type { CourseLevel, LevelRank, LevelRuleId, LevelValues } from "@o-tid/course-setting";
import { plural } from "./plural";

/**
 * Nivåstödet (ADR-0212): texterna. Varje regel i paketets regeltabell (`ALL_LEVEL_RULES`) har ett skäl (varför kontrollen
 * eller sträckan är svårare än nivån under) och ett tips (vad banläggaren kan göra för att den ska passa målnivån).
 */
const RANK_NAMES: Readonly<Record<LevelRank, string>> = { 0: "Grön", 1: "Vit", 2: "Gul", 3: "Orange", 4: "Violett", 5: "Blå–Svart" };
const LEVEL_NAMES: Readonly<Record<CourseLevel, string>> = { GRON: "Grön", VIT: "Vit", GUL: "Gul", ORANGE: "Orange", VIOLETT: "Violett", BLA: "Blå", SVART: "Svart" };
/** Banans nivå i "Hur lägger man en … bana?". */
const LEVEL_ADJECTIVES: Readonly<Record<CourseLevel, string>> = { GRON: "grön", VIT: "vit", GUL: "gul", ORANGE: "orange", VIOLETT: "violett",
  BLA: "blå eller svart", SVART: "blå eller svart" };

const capitalFirst = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const far = (meters: number | undefined) => meters === undefined || meters >= 250 ? "över 250 m" : `${meters} m`;
const v = (values: LevelValues, key: string) => values[key] ?? 0;

/** Skälet när regeln inte uppfylls. */
export const LEVEL_REASONS: Readonly<Record<Exclude<LevelRuleId, `E_${string}`>, (values: LevelValues) => string>> = {
  C_ON_HANDRAIL: values => `ligger ${far(values.meters)} från närmaste tydliga ledstång – Grön vill ha kontrollen på eller alldeles intill stigen (högst ${v(values, "limit")} m)`,
  C_NEAR_HANDRAIL: values => `ligger ${far(values.meters)} från närmaste stig eller annan ledstång – mer än Vit tillåter (${v(values, "limit")} m)`,
  C_CLEAR_FEATURE: values => `föremålet är inte stort och ligger ${far(values.meters)} från stigen – Vit vill ha ett stort och tydligt föremål eller kontrollen vid stigen (${v(values, "limit")} m)`,
  C_SOME_DISTANCE: values => `ligger ${far(values.meters)} från närmaste ledstång – mer än Gul tillåter (${v(values, "limit")} m)`,
  C_SMALL_NEAR: values => `ett litet föremål ${far(values.meters)} från stigen – på Gul bara på stigen; en punkthöjd eller sänka är Orange`,
  C_SMALL_REACH: values => `ett litet föremål ${far(values.meters)} från närmaste ledstång utan angreppspunkt nära – svårare än Orange (${v(values, "limit")} m)`,
  C_RELOCATION: values => `inget tydligt att läsa in sig på inom ${v(values, "limit")} m – Orange vill ha det`,
  C_ATTACK: values => `ett litet föremål utan stor och tydlig angreppspunkt inom ${v(values, "limit")} m – svårare än Violett`,
  C_PLAIN_TERRAIN: values => `detaljrik terräng: ${v(values, "count")} detaljer inom ${v(values, "meters")} m – Grön och Vit bara på stigen eller i enkel terräng (högst ${v(values, "limit")})`,
  C_DISTINCT_FEATURE: values => `${v(values, "count")} likadana föremål inom ${v(values, "meters")} m att förväxla kontrollens med – mer än Gul tål (${v(values, "limit")})`,
  C_READABLE_TERRAIN: values => `mycket detaljrik terräng: ${v(values, "count")} detaljer inom ${v(values, "meters")} m – kräver noggrann kartläsning, svårare än Orange (högst ${v(values, "limit")})`,
  L_FOLLOW_CLEAR: values => `${v(values, "percent")} % av vägvalet följer ledstänger och längsta biten utan är ${v(values, "meters")} m – Grön vill att sträckan följer stigen hela vägen (högst ${v(values, "limit")} m utan)`,
  L_FEW_DECISIONS: values => `${v(values, "count")} byten mellan ledstänger – fler än Grön tål (${v(values, "limit")})`,
  L_NO_CHOICE: values => `${v(values, "count")} likvärdiga vägval (inom 10 %) – Grön ska inte ha vägval`,
  L_SOME_DECISIONS: values => `${v(values, "count")} byten mellan ledstänger och ${v(values, "junctions")} stigkorsningar – fler än Vit tål (${v(values, "limit")} byten)`,
  L_NETWORK: values => `${v(values, "count")} byten och ${v(values, "junctions")} stigkorsningar – ett tätt stignät där rätt stig är en uppgift, svårare än Gul`,
  L_ROUTE_CHOICE: values => `${v(values, "count")} likvärdiga vägval (inom 10 %) – Gul har enkla vägval, flera verkliga vägval är Orange`,
  L_HARD_CHOICE: values => `${v(values, "count")} likvärdiga vägval med ${v(values, "decisions")} byten – svår vägvalsbedömning, svårare än Violett`,
  L_NO_SHORTCUT: values => `att gena sparar ${v(values, "percent")} % mot att följa stigarna – på Grön och Vit ska vägvalet gå längs ledstänger`,
  L_FOLLOW: values => `${v(values, "percent")} % av vägvalet följer ledstänger och längsta biten utan är ${v(values, "meters")} m – mer än Vit tillåter (${v(values, "limit")} m)`,
  L_EASY_CONTOURS: values => `${v(values, "meters")} m kurvläsning långt från ledstänger – mer än Gul tillåter (${v(values, "limit")} m)`,
  L_SHORT_OFF: values => `${v(values, "meters")} m utan ledstång – mer än Gul tillåter (${v(values, "limit")} m)`,
  L_CONTOURS: values => `${v(values, "meters")} m kurvläsning i detaljrik terräng – svårare än Violett (${v(values, "limit")} m)`,
  L_OFF: values => `${v(values, "meters")} m utan ledstång – mer än Orange och Violett tillåter (${v(values, "limit")} m)`
};

/** Tipset när kontrollen eller sträckan inte passar målnivån, per regel. */
export const LEVEL_TIPS: Readonly<Record<LevelRuleId, string>> = {
  C_ON_HANDRAIL: "Lägg kontrollen på stigen, t.ex. vid en stigkorsning eller där stigen möter ett dike",
  C_NEAR_HANDRAIL: "Flytta kontrollen närmare stigen (inom ~20 m) eller välj ett större föremål",
  C_CLEAR_FEATURE: "Välj ett tydligare föremål, t.ex. ett större block eller en höjd",
  C_SOME_DISTANCE: "Flytta kontrollen närmare en stig, ett dike eller en mur (inom ~100 m)",
  C_SMALL_NEAR: "Välj ett tydligare föremål, t.ex. ett större block eller en höjd – eller flytta kontrollen närmare stigen",
  C_SMALL_REACH: "Lägg en tydlig angreppspunkt (stor sten, dikesslut) före kontrollen, eller välj ett större föremål",
  C_RELOCATION: "Lägg kontrollen där det finns tydliga föremål runt om att läsa in sig på (en stig, ett dike, en stor sten)",
  C_ATTACK: "Lägg en tydlig angreppspunkt (stor sten, dikesslut) före kontrollen",
  C_PLAIN_TERRAIN: "Lägg kontrollen på själva stigen, eller i enklare terräng med färre detaljer runt om",
  C_DISTINCT_FEATURE: "Välj ett föremål som inte har likadana grannar, eller ett större och tydligare",
  C_READABLE_TERRAIN: "Lägg kontrollen där terrängen är lugnare, eller med en tydlig angreppspunkt alldeles före",
  L_FOLLOW_CLEAR: "Lägg kontrollen vid en stigkorsning så sträckan kan följa stigen hela vägen",
  L_FEW_DECISIONS: "Sätt en kontroll vid en av stigkorsningarna så att sträckan får färre byten",
  L_NO_CHOICE: "Lägg kontrollerna så att det bara finns en naturlig väg, längs stigen",
  L_SOME_DECISIONS: "Sätt en kontroll vid en av stigkorsningarna så att sträckan får färre val",
  L_NETWORK: "Dela sträckan med en kontroll i stignätet, eller lägg den där stigarna är färre",
  L_ROUTE_CHOICE: "Lägg kontrollen så att ett vägval är tydligt bäst, eller ta bort ett av de likvärdiga vägvalen",
  L_HARD_CHOICE: "Förenkla vägvalet: lägg kontrollen så att ett vägval har färre beslut",
  L_NO_SHORTCUT: "Lägg kontrollerna så att det inte lönar sig att gena, t.ex. där stigen går rakt mot nästa kontroll",
  L_FOLLOW: "Lägg kontrollen så att sträckan följer stigar, diken eller murar – högst en kort bit utan",
  L_EASY_CONTOURS: "Sträckan kräver kurvläsning – dela den med en kontroll vid stigen",
  L_SHORT_OFF: "Korta biten utan ledstång (högst ~150 m) eller dela sträckan med en kontroll vid stigen",
  L_CONTOURS: "Sträckan kräver kurvläsning – dela den med en kontroll vid stigen",
  L_OFF: "Dela sträckan med en kontroll vid en tydlig ledstång",
  E_CONTROL_EASY: "Kontrollen är mycket lättare än banans nivå – lägg den en bit från stigen, vid ett mindre föremål",
  E_LEG_NO_SHORTCUT: "Här lönar det sig inte att gena – flytta kontrollen så genvägen blir tydlig",
  E_LEG_EASY: "Sträckan är mycket lättare än banans nivå – lägg kontrollen längre från ledstängerna"
};

export const courseSettingLevelSv = {
  rankName: (rank: LevelRank) => RANK_NAMES[rank],
  levelName: (level: CourseLevel) => LEVEL_NAMES[level],
  field: {
    label: "Nivå",
    none: "Ingen",
    help: "Banans svårighetsnivå enligt Svensk Orientering. Nivåstödet jämför med den när du ber om det.",
    suggested: (level: string) => `Förslag ur klasserna: ${level}`,
    use: "Använd",
    guide: (level: CourseLevel | undefined) => level ? `Hur lägger man en ${LEVEL_ADJECTIVES[level]} bana?` : "Om nivåerna och nivåstödet"
  },
  panel: {
    heading: "Nivåstöd",
    experimental: "Experimentellt",
    support: "Experimentellt och under utveckling: nivåerna är uppskattningar ur kartans symboler och kan bli fel, särskilt i detaljrik eller bergig terräng. Ett stöd – du som banläggare avgör.",
    assess: "Bedöm nivån",
    assessAll: "Bedöm alla banor",
    again: "Bedöm igen",
    running: (done: number, total: number) => `Bedömer … ${done} av ${total} sträckor`,
    waiting: "Väntar på vägvalen …",
    stale: "Inaktuell – bedöm igen",
    failed: "Nivån kunde inte bedömas (vägvalen räknades inte).",
    noMap: "Ladda upp kartfilen först: nivåstödet läser kartans symboler.",
    sprint: "Nivåstödet gäller inte sprint: Svensk Orientering har ingen färgskala för sprint (utmaningen ligger i vägvalen).",
    score: "Poängbana: bara kontrollerna bedöms.",
    empty: "Banan har inga kontroller att bedöma än.",
    summary: (typical: string, low: string, high: string) => low === high ? `Banan motsvarar ungefär ${typical}.`
      : `Banan motsvarar ungefär ${typical} (${low}–${high}).`,
    harder: (legs: number, controls: number, level: string) => {
      const parts = [legs > 0 ? plural(legs, "sträcka", "sträckor") : "", controls > 0 ? plural(controls, "kontroll", "kontroller") : ""]
        .filter(Boolean);
      if (parts.length === 0) return `Inget är svårare än ${level}.`;
      return `${capitalFirst(parts.join(" och "))} är svårare än ${level}.`;
    },
    easier: (count: number, level: string) => `${plural(count, "kontroll eller sträcka", "kontroller och sträckor")} är tydligt lättare än ${level}.`,
    target: (level: string) => `Målnivå: ${level}`,
    noTarget: "Ingen målnivå vald (sätts i banans egenskaper).",
    details: (count: number) => `Kontroller och sträckor (${count})`,
    onlyDeviations: "Bara avvikelser mot målnivån",
    notices: "Visa avvikelser mot nivån i Varningar",
    noticesHelp: "Notiser, aldrig fel. De kan godtas som andra varningar.",
    show: "Visa på kartan",
    suggest: "Visa förslag på kartan",
    hideSuggest: "Dölj förslaget",
    tip: "Tips",
    okControl: "ligger vid en tydlig ledstång",
    okLeg: "följer tydliga ledstänger",
    noRoute: "inget vägval att bedöma",
    leg: (from: string, to: string) => `${from}–${to}`,
    badge: (rank: string) => `Nivå ${rank}`,
    harderTag: "Svårare än målnivån",
    easierTag: "Tydligt lättare än målnivån",
    measures: "Mäter avståndet till stigar och andra ledstänger, kontrollens föremål, angreppspunkter och vägvalet: hur mycket som följer ledstänger, om det lönar sig att gena och om sträckan kräver kurvläsning."
  },
  check: (label: string, rank: string, target: string, reason: string, tip: string) => `${label}: ${reason} (≈ ${rank}, målnivå ${target}). ${tip}.`,
  candidates: { junction: "Stigkorsning", handrail: "Närmaste stig", bigFeature: "Stort föremål", offAt: "Utan ledstång" }
} as const;
