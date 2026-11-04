/**
 * Nivåstödet (ADR-0212): reglerna som ger en uppskattad nivå per kontroll och sträcka. Varje regel är ett krav som gäller
 * upp till och med en nivå (`through`); nivån för en kontroll eller sträcka är den lägsta där alla krav som gäller där är
 * uppfyllda. Skälet är det första kravet som inte uppfylls på nivån under ("ligger 80 m från närmaste stig – mer än Vit
 * tillåter"), och tipset mot banans målnivå är det första kravet som inte uppfylls där. Allt är ett stöd: banläggaren avgör.
 *
 * Gränserna står i `LEVEL_LIMITS` (samma tabell i ADR-0212). Källor: SOFT, "Klasser, svårighetsnivåer …" (2022-03-25),
 * och SOFT:s banläggarträff "Banläggningens grunder – svårighetsgrader" (2025): Vit kontroll högst 50 m från ledstången
 * (K4), Gul gena högst ~150 m (K7) och grovorientering 200–300 m (K8). Övriga tal är egna tumregler, valda försiktigt: hellre
 * en nivå för lätt än en för svår.
 */
import type { ControlLevelFeatures, LegLevelFeatures, LevelRank } from "./level-types";

export const LEVEL_LIMITS = {
  control: {
    /** Grön: på eller alldeles intill en tydlig ledstång (SOFT 2022). */
    onHandrailMeters: 10,
    /** Vit: högst 50 m från ledstången (SOFT 2025, K4). */
    vitHandrailMeters: 50,
    /** Gul: "en bit från" ledstången, högst ~150 m (gena, SOFT 2025, K7). */
    gulHandrailMeters: 150,
    /** Orange: ett litet föremål (liten höjd, liten grop) bara med en ledstång eller angreppspunkt så här nära. */
    orangeSmallMeters: 100,
    /** Orange: tydliga föremål att läsa in sig på inom så här långt (egen tumregel); Violett klarar detaljfattig terräng (K15). */
    relocationMeters: 150,
    /** Violett: en stor, tydlig angreppspunkt inom så här långt (egen tumregel). */
    attackMeters: 150,
    /** Kontroll utan kolumn D: närmaste kartföremål inom så här långt är föremålet (och räknas inte som angreppspunkt). */
    featureSearchMeters: 10,
    /** Längre bort letas inga ledstänger eller föremål. */
    searchMeters: 250
  },
  leg: {
    /** Ett vägval inom så här mycket av det bästa är ett verkligt vägval (ägarens önskemål 2026-11-04). */
    closeAlternative: 0.1,
    /** Vägen räknas som längs en ledstång inom så här långt från den. */
    followMeters: 12,
    /** Vägen mäts var 5:e meter. */
    sampleMeters: 5,
    /** Grön: minst 90 % längs tydliga ledstänger och högst 30 m utan. */
    gronShare: 0.9,
    gronOffMeters: 30,
    /** Grön: högst så många byten mellan ledstänger ("ej för många K3", SOFT 2025). */
    gronDecisions: 4,
    /** Vit och Gul: högst så många byten och stigkorsningar på sträckan; fler är ett tätt stignät där rätt stig är en uppgift. */
    vitDecisions: 6,
    vitJunctions: 4,
    gulDecisions: 10,
    gulJunctions: 8,
    /** Violett: ett verkligt vägval med så här många byten eller fler är svår vägvalsbedömning (V4, Blå). */
    violettDecisions: 16,
    /** Ett byte räknas när vägen följer den nya ledstången minst så långt och den går åt ett annat håll. */
    decisionRunMeters: 15,
    decisionAngleDegrees: 30,
    /** Vit: minst 70 % längs ledstänger och högst 60 m utan. */
    vitShare: 0.7,
    vitOffMeters: 60,
    /** Att gena "lönar sig" när det går minst 10 % fortare än att följa vägar och stigar (Gul, SOFT 2022). */
    shortcutGain: 0.1,
    /** Gul: högst ~200 m utan ledstång (K7–K8, SOFT 2025). */
    gulOffMeters: 200,
    /** Orange och Violett: högst ~400 m utan ledstång. */
    orangeOffMeters: 400,
    /** Kurvläsning: ingen ledstång inom 40 m och detaljrik kurvbild (höjdkurvor eller föremål) inom 25 m. */
    lineFreeMeters: 40,
    detailRadiusMeters: 25,
    detailContourMeters: 100,
    detailPoints: 3,
    /** Gul: högst 50 m kurvläsning (K9 "lätt kurvbildsorientering"); Orange och Violett högst 150 m. */
    gulDetailMeters: 50,
    orangeDetailMeters: 150
  }
} as const;

export type LevelRuleId =
  | "C_ON_HANDRAIL" | "C_NEAR_HANDRAIL" | "C_CLEAR_FEATURE" | "C_SOME_DISTANCE" | "C_SMALL_NEAR" | "C_RELOCATION" | "C_SMALL_REACH" | "C_ATTACK"
  | "L_FOLLOW_CLEAR" | "L_FEW_DECISIONS" | "L_NO_CHOICE" | "L_NO_SHORTCUT" | "L_FOLLOW" | "L_SOME_DECISIONS" | "L_SHORT_OFF" | "L_EASY_CONTOURS"
  | "L_NETWORK" | "L_ROUTE_CHOICE" | "L_OFF" | "L_CONTOURS" | "L_HARD_CHOICE"
  | "E_CONTROL_EASY" | "E_LEG_NO_SHORTCUT" | "E_LEG_EASY";

/** Talen som skälet och tipset kan nämna (meter, procent, antal). */
export type LevelValues = Readonly<Record<string, number>>;

interface Rule<F> {
  readonly id: LevelRuleId;
  /** Kravet gäller på nivåerna 0 … `through`. */
  readonly through: LevelRank;
  readonly test: (features: F) => boolean;
  readonly values: (features: F) => LevelValues;
  /** Vad "Visa förslag på kartan" visar för regeln. */
  readonly show?: readonly ("junction" | "handrail" | "bigFeature" | "offAt")[] | undefined;
}

const C = LEVEL_LIMITS.control, L = LEVEL_LIMITS.leg;
const within = (value: number | undefined, limit: number) => value !== undefined && value <= limit;
const shown = (value: number | undefined) => value ?? C.searchMeters;
const small = (f: ControlLevelFeatures) => f.feature.size === "SMALL";
const percent = (share: number) => Math.round(share * 100);

/** Kontrollernas krav, lättast först. */
export const CONTROL_RULES: readonly Rule<ControlLevelFeatures>[] = [
  { id: "C_ON_HANDRAIL", through: 0, test: f => within(f.strongMeters, C.onHandrailMeters),
    values: f => ({ meters: shown(f.strongMeters), limit: C.onHandrailMeters }), show: ["junction", "handrail"] },
  { id: "C_NEAR_HANDRAIL", through: 1, test: f => within(f.handrailMeters, C.vitHandrailMeters),
    values: f => ({ meters: shown(f.handrailMeters), limit: C.vitHandrailMeters }), show: ["handrail", "bigFeature"] },
  // Vit: "lätt och tydligt" – ett stort föremål; ett medelstort eller litet bara på stigen (ägarens synpunkt 2026-11-04).
  { id: "C_CLEAR_FEATURE", through: 1, test: f => f.feature.size === "BIG" || f.feature.size === "LINE" || within(f.strongMeters, C.onHandrailMeters),
    values: () => ({}), show: ["bigFeature"] },
  { id: "C_SOME_DISTANCE", through: 2, test: f => within(f.handrailMeters, C.gulHandrailMeters),
    values: f => ({ meters: shown(f.handrailMeters), limit: C.gulHandrailMeters }), show: ["handrail", "bigFeature"] },
  // Gul: små föremål (punkthöjd, liten grop) är Orange enligt SOFT:s exempel, utom på stigen.
  { id: "C_SMALL_NEAR", through: 2, test: f => !small(f) || within(f.strongMeters, C.onHandrailMeters),
    values: f => ({ meters: shown(f.handrailMeters), limit: C.onHandrailMeters }), show: ["bigFeature"] },
  { id: "C_SMALL_REACH", through: 3, test: f => !small(f) || within(f.handrailMeters, C.orangeSmallMeters) || within(f.attackMeters, C.orangeSmallMeters),
    values: f => ({ meters: shown(f.handrailMeters), limit: C.orangeSmallMeters }), show: ["bigFeature", "handrail"] },
  { id: "C_RELOCATION", through: 3, test: f => within(f.relocationMeters, C.relocationMeters),
    values: f => ({ meters: shown(f.relocationMeters), limit: C.relocationMeters }), show: ["bigFeature", "handrail"] },
  { id: "C_ATTACK", through: 4, test: f => !small(f) || within(f.attackMeters, C.attackMeters),
    values: f => ({ meters: shown(f.attackMeters), limit: C.attackMeters }), show: ["bigFeature"] }
];

/** Sträckornas krav, lättast först. */
export const LEG_RULES: readonly Rule<LegLevelFeatures>[] = [
  { id: "L_FOLLOW_CLEAR", through: 0, test: f => f.strongShare >= L.gronShare && f.longestOffStrongMeters <= L.gronOffMeters,
    values: f => ({ percent: percent(f.strongShare), meters: f.longestOffStrongMeters, limit: L.gronOffMeters }), show: ["offAt"] },
  { id: "L_FEW_DECISIONS", through: 0, test: f => f.decisions <= L.gronDecisions, values: f => ({ count: f.decisions, limit: L.gronDecisions }) },
  // Grön: "Vägval: Inga" (SOFT 2025).
  { id: "L_NO_CHOICE", through: 0, test: f => f.closeAlternatives === 0, values: f => ({ count: f.closeAlternatives }) },
  { id: "L_NO_SHORTCUT", through: 1, test: f => f.shortcutGain < L.shortcutGain, values: f => ({ percent: percent(f.shortcutGain) }), show: ["offAt"] },
  { id: "L_FOLLOW", through: 1, test: f => f.handrailShare >= L.vitShare && f.longestOffMeters <= L.vitOffMeters,
    values: f => ({ percent: percent(f.handrailShare), meters: f.longestOffMeters, limit: L.vitOffMeters }), show: ["offAt"] },
  { id: "L_SOME_DECISIONS", through: 1, test: f => f.decisions <= L.vitDecisions && f.junctions <= L.vitJunctions,
    values: f => ({ count: f.decisions, junctions: f.junctions, limit: L.vitDecisions }) },
  { id: "L_EASY_CONTOURS", through: 2, test: f => f.detailMeters <= L.gulDetailMeters, values: f => ({ meters: f.detailMeters, limit: L.gulDetailMeters }),
    show: ["offAt"] },
  { id: "L_SHORT_OFF", through: 2, test: f => f.longestOffMeters <= L.gulOffMeters, values: f => ({ meters: f.longestOffMeters, limit: L.gulOffMeters }),
    show: ["offAt"] },
  // Ett tätt stignät: att hålla rätt stig bland många är en uppgift i sig (parker, ISSprOM-lik terräng i skogsnorm).
  { id: "L_NETWORK", through: 2, test: f => f.decisions <= L.gulDecisions && f.junctions <= L.gulJunctions,
    values: f => ({ count: f.decisions, junctions: f.junctions, limit: L.gulDecisions }) },
  // Gul: "enkla vägval" (V2); två eller fler likvärdiga vägval (inom 10 %) är Orange (V3: längd, löpbarhet och säkerhet).
  { id: "L_ROUTE_CHOICE", through: 2, test: f => f.closeAlternatives <= 1, values: f => ({ count: f.closeAlternatives }) },
  { id: "L_CONTOURS", through: 4, test: f => f.detailMeters <= L.orangeDetailMeters, values: f => ({ meters: f.detailMeters, limit: L.orangeDetailMeters }),
    show: ["offAt"] },
  { id: "L_OFF", through: 4, test: f => f.longestOffMeters <= L.orangeOffMeters, values: f => ({ meters: f.longestOffMeters, limit: L.orangeOffMeters }),
    show: ["offAt"] },
  // Blå: "svår vägvalsbedömning med flera beslut per vägval" (V4).
  { id: "L_HARD_CHOICE", through: 4, test: f => f.closeAlternatives < 2 || f.decisions < L.violettDecisions,
    values: f => ({ count: f.closeAlternatives, decisions: f.decisions, limit: L.violettDecisions }) }
];

/**
 * Lättare än målnivån: en kontroll eller sträcka minst två steg under en målnivå från Gul och uppåt får ett tips om hur den
 * kan bli svårare. Ingen nivå; bara för tipsen (`levelDeviation`).
 */
export const EASIER_RULES: readonly { readonly id: Extract<LevelRuleId, `E_${string}`>; readonly kind: "control" | "leg" }[] = [
  { id: "E_CONTROL_EASY", kind: "control" }, { id: "E_LEG_NO_SHORTCUT", kind: "leg" }, { id: "E_LEG_EASY", kind: "leg" }
];
/** Från den här målnivån (Gul) och minst så många steg under den räknas något som tydligt lättare. */
export const EASIER_FROM: LevelRank = 2;
export const EASIER_STEPS = 2;

export const ALL_LEVEL_RULES: readonly LevelRuleId[] = [...CONTROL_RULES.map(rule => rule.id), ...LEG_RULES.map(rule => rule.id), ...EASIER_RULES.map(rule => rule.id)];

export interface LevelVerdict {
  readonly rank: LevelRank;
  /** Det första kravet som inte uppfylls på nivån under (saknas för Grön). */
  readonly rule?: LevelRuleId | undefined;
  readonly values: LevelValues;
}

function judge<F>(rules: readonly Rule<F>[], features: F): LevelVerdict {
  // På Blå–Svart (5) gäller inga krav, så någon nivå passar alltid.
  const rank = ([0, 1, 2, 3, 4, 5] as const).find(level => rules.every(rule => rule.through < level || rule.test(features))) ?? 5;
  if (rank === 0) return { rank, values: {} };
  const failed = rules.find(rule => rule.through >= rank - 1 && !rule.test(features))!;
  return { rank, rule: failed.id, values: failed.values(features) };
}

export const judgeControl = (features: ControlLevelFeatures) => judge(CONTROL_RULES, features);
export const judgeLeg = (features: LegLevelFeatures) => judge(LEG_RULES, features);

export interface LevelDeviation {
  readonly direction: "HARDER" | "EASIER";
  /** Regeln vars tips gäller. */
  readonly rule: LevelRuleId;
  readonly values: LevelValues;
  readonly show: readonly ("junction" | "handrail" | "bigFeature" | "offAt")[];
}

/** Avvikelsen mot målnivån, eller undefined när kontrollen eller sträckan passar. */
export function levelDeviation(kind: "control" | "leg", features: ControlLevelFeatures | LegLevelFeatures, rank: LevelRank, target: LevelRank): LevelDeviation | undefined {
  if (rank > target) {
    const rules = (kind === "control" ? CONTROL_RULES : LEG_RULES) as readonly Rule<ControlLevelFeatures | LegLevelFeatures>[];
    const failed = rules.find(rule => rule.through >= target && !rule.test(features));
    if (!failed) return undefined;
    return { direction: "HARDER", rule: failed.id, values: failed.values(features), show: failed.show ?? [] };
  }
  if (target >= EASIER_FROM && rank <= target - EASIER_STEPS) {
    if (kind === "control") return { direction: "EASIER", rule: "E_CONTROL_EASY", values: {}, show: [] };
    const leg = features as LegLevelFeatures;
    return leg.shortcutGain < L.shortcutGain
      ? { direction: "EASIER", rule: "E_LEG_NO_SHORTCUT", values: { percent: percent(leg.shortcutGain) }, show: [] }
      : { direction: "EASIER", rule: "E_LEG_EASY", values: {}, show: [] };
  }
  return undefined;
}
