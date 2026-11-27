import type { GeoJobEngine } from "@o-tid/contracts";

/**
 * Ägaren 2026-11-11 & Etapp G4B: enkla val för O-Tids egen motor (`otidgeo`) och Karttapullautin (`pullautin`), samt
 * geo-arbetarens egna rastersteg. Värden som skrivs in för hand under «Avancerat» går alltid före valen.
 *
 * Riktningar:
 * - `greenscale` har samma riktning för båda motorerna (större ger mindre grönt; geo-arbetaren inverterar till `otidgeo --green-scale`).
 * - `openshare` (högre ger mindre gult), `knollshare` (högre ger färre knollar) och `undergrowth` (lägre ger mer undervegetation)
 *   har samma riktning men motorernas egna förval (`otidgeo` 0,63 / 0,058 vs `pullautin` 0,5 / 0,35).
 * - Kurvprofilerna (`CONTOUR_STYLES`) har fem steg från «Mycket detaljerad» till «Mycket generaliserad», anpassade efter motor och sprint/skog.
 */
export const LASER_CHOICES = ["cliffs", "knolls", "open", "green", "undergrowth", "rock"] as const;
export type LaserChoice = typeof LASER_CHOICES[number];
export type ChoiceLevel = "less" | "default" | "more";
export type LaserChoices = Readonly<Record<LaserChoice, ChoiceLevel>>;
export const DEFAULT_CHOICES: LaserChoices = { cliffs: "default", knolls: "default", open: "default", green: "default", undergrowth: "default", rock: "default" };

/** Fem tydliga kurvprofiler (från detaljrik till hårt generaliserad), valbara i både laserpanelen och guiden. */
export const CONTOUR_STYLES = ["veryDetailed", "detailed", "normal", "generalized", "veryGeneralized"] as const;
export type ContourStyle = typeof CONTOUR_STYLES[number];

/** Vegetationsutjämning (skickas som `veg_smooth` när ej normal, automatiskt synkad i «Kör om»). */
export const VEG_SMOOTH_LEVELS = ["detailed", "normal", "calm"] as const;
export type VegSmoothLevel = typeof VEG_SMOOTH_LEVELS[number];
const VEG_SMOOTH_VALUES: Readonly<Record<VegSmoothLevel, number>> = { detailed: 0.65, normal: 1.05, calm: 1.6 };

export function vegSmoothSetting(level: VegSmoothLevel): Readonly<Record<string, number>> {
  return level === "normal" ? {} : { veg_smooth: VEG_SMOOTH_VALUES[level] };
}

export function vegSmoothOf(settings: Readonly<Record<string, number>>): VegSmoothLevel {
  if (settings.veg_smooth === VEG_SMOOTH_VALUES.detailed) return "detailed";
  if (settings.veg_smooth === VEG_SMOOTH_VALUES.calm) return "calm";
  return "normal";
}

/** Inställningarna för vald kurvprofil, motor och ekvidistans (`sprint` = ekvidistans ≤ 3 m). */
export function contourStyleSettings(style: ContourStyle, engine: GeoJobEngine = "otidgeo", sprint = false): Readonly<Record<string, number>> {
  if (style === "normal") return {};
  if (engine === "pullautin") {
    switch (style) {
      case "veryDetailed": return { smoothing: 0.3, curviness: 1.5 };
      case "detailed": return { smoothing: 0.5, curviness: 1.3 };
      case "generalized": return { smoothing: 1.2, curviness: 0.9 };
      // Också färre knollar: i flack terräng är de flesta små kullar brus.
      case "veryGeneralized": return { smoothing: 2, curviness: 0.7, knolls: 0.85 };
    }
  }
  switch (style) {
    case "veryDetailed": return { smooth_m: sprint ? 0.8 : 1.0, taubin: 1, curviness: 0.24, min_loop_area: sprint ? 10 : 20, min_clearance: sprint ? 0.6 : 1.0 };
    case "detailed": return { smooth_m: sprint ? 1.0 : 1.35, taubin: 2, curviness: 0.20, min_loop_area: sprint ? 14 : 30, min_clearance: sprint ? 0.85 : 1.4 };
    case "generalized": return { smooth_m: sprint ? 1.6 : 2.3, taubin: 3, curviness: 0.13, min_loop_area: sprint ? 26 : 65, min_clearance: sprint ? 1.2 : 2.1 };
    case "veryGeneralized": return { smooth_m: sprint ? 2.2 : 3.2, taubin: 4, curviness: 0.08, min_loop_area: sprint ? 40 : 105, min_clearance: sprint ? 1.5 : 2.5 };
  }
}

/** Kurvprofilen ur ett körts jobbs inställningar (för «Kör om»). */
export function contourStyleOf(settings: Readonly<Record<string, number>>, engine: GeoJobEngine = "otidgeo", sprint = false): ContourStyle {
  for (const style of ["veryDetailed", "detailed", "generalized", "veryGeneralized"] as const) {
    const expected = Object.entries(contourStyleSettings(style, engine, sprint));
    if (expected.length > 0 && expected.every(([key, value]) => settings[key] === value)) return style;
  }
  return "normal";
}

type ChoicePresets = Readonly<Record<LaserChoice, Readonly<Record<"less" | "more", Readonly<Record<string, number>>>>>>;

const PULLAUTIN_PRESETS: ChoicePresets = {
  cliffs: { less: { cliff1: 1.4, cliff2: 2.4 }, more: { cliff1: 0.95, cliff2: 1.7 } },
  knolls: { less: { knolls: 0.85, knollshare: 0.9 }, more: { knolls: 0.35, knollshare: 0.7 } },
  open: { less: { openshare: 0.65 }, more: { openshare: 0.35 } },
  green: { less: { greenscale: 1.5, denseshare: 0.12 }, more: { greenscale: 0.65, denseshare: 0.05 } },
  undergrowth: { less: { undergrowth: 0.5 }, more: { undergrowth: 0.25 } },
  rock: { less: { rock: 0 }, more: { rock: 2 } }
};

const OTIDGEO_PRESETS: ChoicePresets = {
  cliffs: PULLAUTIN_PRESETS.cliffs,
  knolls: { less: { knollshare: 0.9 }, more: { knollshare: 0.7 } },
  // otidgeo förval open_min_ground_share = 0,63; högre kräver öppnare mark → mindre gult.
  open: { less: { openshare: 0.75 }, more: { openshare: 0.5 } },
  // greenscale 1,5 = mindre grönt, 0,65 = mer grönt (geo-arbetaren inverterar till otidgeo --green-scale).
  green: { less: { greenscale: 1.5 }, more: { greenscale: 0.65 } },
  // otidgeo förval undergrowth_thresh = 0,058; lägre ger mer undervegetation.
  undergrowth: { less: { undergrowth: 0.09 }, more: { undergrowth: 0.035 } },
  rock: PULLAUTIN_PRESETS.rock
};

const presetsFor = (engine: GeoJobEngine): ChoicePresets => engine === "pullautin" ? PULLAUTIN_PRESETS : OTIDGEO_PRESETS;

/**
 * Hur branterna redovisas (ägaren 2026-11-12): «few» är lärt av Högdalen (4,5 m fall, minst 20 m),
 * «most» av Gömmaren (3,5 m, minst 10 m).
 */
export const CLIFF_STYLES = ["few", "most"] as const;
export type CliffStyle = typeof CLIFF_STYLES[number];
const CLIFF_STYLE = { few: { impassableDrop: 4.5, impassableLength: 20 }, most: { impassableDrop: 3.5, impassableLength: 10 } } as const;
/** «Färre» och «fler» branter: minsta fallet för en brant, och gränsen för opasserbar en meter upp eller ned. */
const CLIFF_LEVEL = { less: { minDrop: 1.8, shift: 1 }, default: { minDrop: 1.3, shift: 0 }, more: { minDrop: 1, shift: -1 } } as const;

export interface ChoiceOptions {
  readonly engine?: GeoJobEngine | undefined;
  readonly contours?: ContourStyle | undefined;
  readonly sprint?: boolean | undefined;
  readonly vegSmooth?: VegSmoothLevel | undefined;
  readonly overview?: boolean | undefined;
}

/** Valen som värden för jobbet: inställningarna (de handskrivna går före) och branternas trösklar. */
export function choiceSettings(choices: LaserChoices, typed: Readonly<Record<string, number>> = {}, style: CliffStyle = "few", tags = false, rawTicks = false,
  options: ChoiceOptions = {}) {
  const engine: GeoJobEngine = options.engine ?? "otidgeo";
  const presets = presetsFor(engine);
  const settings: Record<string, number> = {
    ...contourStyleSettings(options.contours ?? "normal", engine, options.sprint ?? false)
  };
  for (const choice of LASER_CHOICES) {
    const level = choices[choice];
    if (level !== "default") Object.assign(settings, presets[choice][level]);
  }
  if (options.vegSmooth) Object.assign(settings, vegSmoothSetting(options.vegSmooth));
  if (engine === "otidgeo" && options.overview === false) settings.overview = 0;
  const keepRawTicks = rawTicks && engine === "pullautin";
  const level = CLIFF_LEVEL[choices.cliffs], base = CLIFF_STYLE[style];
  const cliffs = choices.cliffs === "default" && style === "few" && !tags && !keepRawTicks ? undefined
    : { minDrop: level.minDrop, impassableDrop: base.impassableDrop + level.shift, impassableLength: base.impassableLength, ...(tags ? { tags: true } : {}), ...(keepRawTicks ? { rawTicks: true } : {}) };
  return { settings: { ...settings, ...typed }, cliffs };
}

/** Brantvalen ur ett körts jobb (för «Kör om»). */
export function cliffChoicesOf(cliffs: { readonly minDrop: number; readonly impassableLength?: number | undefined; readonly tags?: boolean | undefined; readonly rawTicks?: boolean | undefined } | null):
  { level: ChoiceLevel; style: CliffStyle; tags: boolean; rawTicks: boolean } {
  return { level: !cliffs || cliffs.minDrop === 1.3 ? "default" : cliffs.minDrop > 1.3 ? "less" : "more",
    style: cliffs && (cliffs.impassableLength ?? 20) <= 10 ? "most" : "few", tags: cliffs?.tags === true, rawTicks: cliffs?.rawTicks === true };
}

/** Valen ur ett körts jobbs inställningar (för «Kör om»): ett val som inte stämmer med något förval blir «default». */
export function choicesOf(settings: Readonly<Record<string, number>>, engine: GeoJobEngine = "otidgeo"): LaserChoices {
  const presets = presetsFor(engine);
  const out: Record<LaserChoice, ChoiceLevel> = { ...DEFAULT_CHOICES };
  for (const choice of LASER_CHOICES) {
    for (const level of ["less", "more"] as const) {
      if (Object.entries(presets[choice][level]).every(([key, value]) => settings[key] === value)) out[choice] = level;
    }
  }
  return out;
}

/** Inställningarna som inte kommer ur valen (de som skrivits för hand), som text i fälten. */
export function typedOf(settings: Readonly<Record<string, number>>, choices: LaserChoices, keys: readonly string[], options: ChoiceOptions = {}): Record<string, string> {
  const fromChoices = choiceSettings(choices, {}, "few", false, false, options).settings;
  return Object.fromEntries(keys.flatMap(key => settings[key] !== undefined && settings[key] !== fromChoices[key] ? [[key, String(settings[key]).replace(".", ",")]] : []));
}
