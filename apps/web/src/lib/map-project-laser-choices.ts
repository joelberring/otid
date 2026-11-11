/**
 * Ägaren 2026-11-11 («det går inte ställa in egenskaper för Karttapullautin med mer/mindre branter, kurvor m.m.»): enkla val
 * för Karttapullautin och geo-arbetaren, som blir värden i `pullauta.ini` och branternas trösklar. Värdena som skrivs in
 * för hand under «Avancerat» går före valen.
 *
 * Riktningarna är Karttapullautins egna (`pullauta.default.ini`, 2.15.4): lägre `cliff1`/`cliff2` ger fler branter, större
 * `smoothing` slätare kurvor och större `curviness` mer överdrivna böjar, större `knolls` färre knollar, lägre `undergrowth`
 * mer undervegetation. `greenscale` är O-Tids faktor på gränserna för grönt (större ger mindre grönt). Branternas trösklar
 * (minsta fall för en brant och för en opasserbar, över ±3 m) gäller när fallet mäts i laserns markraster.
 */
export const LASER_CHOICES = ["cliffs", "contours", "knolls", "green", "undergrowth"] as const;
export type LaserChoice = typeof LASER_CHOICES[number];
export type ChoiceLevel = "less" | "default" | "more";
export type LaserChoices = Readonly<Record<LaserChoice, ChoiceLevel>>;
export const DEFAULT_CHOICES: LaserChoices = { cliffs: "default", contours: "default", knolls: "default", green: "default", undergrowth: "default" };

/** «less» och «more» för varje val: värdena i pullauta.ini (och branternas trösklar). */
const PRESETS: Readonly<Record<LaserChoice, Readonly<Record<"less" | "more", Readonly<Record<string, number>>>>>> = {
  cliffs: { less: { cliff1: 1.4, cliff2: 2.4 }, more: { cliff1: 0.95, cliff2: 1.7 } },
  // «Mindre» är slätare kurvor, «mer» detaljrikare.
  contours: { less: { smoothing: 1.2, curviness: 0.9 }, more: { smoothing: 0.5, curviness: 1.3 } },
  knolls: { less: { knolls: 0.85 }, more: { knolls: 0.35 } },
  green: { less: { greenscale: 1.5 }, more: { greenscale: 0.65 } },
  undergrowth: { less: { undergrowth: 0.5 }, more: { undergrowth: 0.25 } }
};
const CLIFF_RULES = { less: { minDrop: 1.8, impassableDrop: 3.2 }, more: { minDrop: 1, impassableDrop: 2 } } as const;

/** Valen som värden för jobbet: inställningarna (de handskrivna går före) och branternas trösklar. */
export function choiceSettings(choices: LaserChoices, typed: Readonly<Record<string, number>> = {}) {
  const settings: Record<string, number> = {};
  for (const choice of LASER_CHOICES) {
    const level = choices[choice];
    if (level !== "default") Object.assign(settings, PRESETS[choice][level]);
  }
  return { settings: { ...settings, ...typed }, cliffs: choices.cliffs === "default" ? undefined : CLIFF_RULES[choices.cliffs] };
}

/** Valen ur ett körts jobbs inställningar (för «Kör om»): ett val som inte stämmer med något förval blir «default». */
export function choicesOf(settings: Readonly<Record<string, number>>): LaserChoices {
  const out: Record<LaserChoice, ChoiceLevel> = { ...DEFAULT_CHOICES };
  for (const choice of LASER_CHOICES) {
    for (const level of ["less", "more"] as const) {
      if (Object.entries(PRESETS[choice][level]).every(([key, value]) => settings[key] === value)) out[choice] = level;
    }
  }
  return out;
}

/** Inställningarna som inte kommer ur valen (de som skrivits för hand), som text i fälten. */
export function typedOf(settings: Readonly<Record<string, number>>, choices: LaserChoices, keys: readonly string[]): Record<string, string> {
  const fromChoices = choiceSettings(choices).settings;
  return Object.fromEntries(keys.flatMap(key => settings[key] !== undefined && settings[key] !== fromChoices[key] ? [[key, String(settings[key]).replace(".", ",")]] : []));
}
