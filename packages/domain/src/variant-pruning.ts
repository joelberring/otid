/**
 * Färre gafflingsvarianter (ägaren 2026-11-03, ADR-0198). En fulgaffling med flera gafflingar i följd ger många varianter,
 * och vissa kombinationer blir tydligt längre. Här väljs varianter bort, rent och generellt (banläggningen och tävlingen):
 *
 * - **Längst i alla avseenden** (`dominated`): en variant tas bort när en annan variant inte är längre i något av de mått
 *   som finns för alla varianter (fågelväg, längs vägval när den är räknad, stigning när den finns) och kortare i minst ett.
 *   Lika långa varianter tar aldrig bort varandra.
 * - **Tak** (`maxPercentLonger`, `maxCount`): högst så många procent längre än den kortaste och/eller högst så många
 *   varianter; de kortaste behålls. Längden är längs vägval när den finns för alla, annars fågelvägen.
 *
 * Skyddet (`guard`, förval på): en variant behålls om den är den enda kvar som springer en kontroll eller sträcka som någon
 * variant har, så att ingen gren eller kontroll står oanvänd i skogen (fulgafflingens rättvisa: alla alternativ springs).
 * Den sista varianten tas aldrig bort. Allt är deterministiskt: längsta först, sedan koden.
 */

export interface PrunableVariant {
  readonly code: string;
  /** Kontrollerna som varianten besöker (id eller kod), för skyddet. */
  readonly controls: readonly string[];
  /** Sträckorna (t.ex. "S>31", "31>32", "40>F"), för skyddet. */
  readonly legs: readonly string[];
  readonly straightMeters: number;
  /** Längs vägval; null/saknas = inte räknad. */
  readonly routeMeters?: number | null | undefined;
  readonly climbMeters?: number | null | undefined;
}

export type PruningMeasure = "STRAIGHT" | "ROUTE" | "CLIMB";
export type PruningReason = "DOMINATED" | "OVER_PERCENT" | "OVER_COUNT";

export interface PruningOptions {
  readonly dominated: boolean;
  readonly maxPercentLonger?: number | undefined;
  readonly maxCount?: number | undefined;
  /** Behåll varianter som behövs för att varje kontroll och sträcka ska springas (förval på). */
  readonly guard?: boolean | undefined;
}

export interface PrunedVariant {
  readonly code: string;
  readonly reason: PruningReason;
  /** Varianten som är kortare i alla avseenden (DOMINATED). */
  readonly by?: string | undefined;
}

export interface ProtectedVariant {
  readonly code: string;
  /** Regeln som ville ta bort varianten. */
  readonly reason: PruningReason;
  /** Kontrollen eller sträckan som bara den här varianten har kvar; ingen av dem = den sista varianten. */
  readonly control?: string | undefined;
  readonly leg?: string | undefined;
}

export interface VariantPruning {
  /** Måtten som jämfördes (de som finns för alla varianter). */
  readonly measures: readonly PruningMeasure[];
  /** Måttet för taket och ordningen: längs vägval när det finns, annars fågelväg. */
  readonly lengthMeasure: "STRAIGHT" | "ROUTE";
  readonly kept: readonly string[];
  readonly excluded: readonly PrunedVariant[];
  readonly protected: readonly ProtectedVariant[];
}

const known = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** Måtten som finns för alla varianter. */
export function pruningMeasures(variants: readonly PrunableVariant[]): PruningMeasure[] {
  const measures: PruningMeasure[] = ["STRAIGHT"];
  if (variants.length > 0 && variants.every((variant) => known(variant.routeMeters))) measures.push("ROUTE");
  if (variants.length > 0 && variants.every((variant) => known(variant.climbMeters))) measures.push("CLIMB");
  return measures;
}

function value(variant: PrunableVariant, measure: PruningMeasure): number {
  // Hela meter: avrundningen i längderna ska inte avgöra.
  const raw = measure === "STRAIGHT" ? variant.straightMeters : measure === "ROUTE" ? variant.routeMeters! : variant.climbMeters!;
  return Math.round(raw);
}

/** `shorter` är inte längre i något mått och kortare i minst ett. */
export function dominatesVariant(shorter: PrunableVariant, longer: PrunableVariant, measures: readonly PruningMeasure[]): boolean {
  let strictly = false;
  for (const measure of measures) {
    const a = value(shorter, measure), b = value(longer, measure);
    if (a > b) return false;
    if (a < b) strictly = true;
  }
  return strictly;
}

export function pruneVariants(variants: readonly PrunableVariant[], options: PruningOptions): VariantPruning {
  const measures = pruningMeasures(variants);
  const lengthMeasure = measures.includes("ROUTE") ? "ROUTE" : "STRAIGHT";
  const length = (variant: PrunableVariant) => value(variant, lengthMeasure);
  const guard = options.guard ?? true;
  const byCode = new Map(variants.map((variant) => [variant.code, variant]));
  // Längsta först; lika långa i omvänd kodordning, så att "AC" behålls före "BD" när de är lika.
  const longestFirst = [...variants].sort((a, b) => length(b) - length(a) || (a.code < b.code ? 1 : a.code > b.code ? -1 : 0));
  const kept = new Set(variants.map((variant) => variant.code));
  const excluded: PrunedVariant[] = [];
  const guarded = new Map<string, ProtectedVariant>();
  const allControls = new Set(variants.flatMap((variant) => variant.controls));
  const allLegs = new Set(variants.flatMap((variant) => variant.legs));

  /** Det som bara `code` har kvar bland de behållna, eller undefined. */
  const onlyUser = (code: string): { control?: string; leg?: string } | undefined => {
    if (!guard) return undefined;
    const others = [...kept].filter((other) => other !== code).map((other) => byCode.get(other)!);
    const own = byCode.get(code)!;
    const control = own.controls.find((item) => allControls.has(item) && !others.some((other) => other.controls.includes(item)));
    if (control !== undefined) return { control };
    const leg = own.legs.find((item) => allLegs.has(item) && !others.some((other) => other.legs.includes(item)));
    return leg !== undefined ? { leg } : undefined;
  };
  const tryRemove = (code: string, reason: PruningReason, by?: string): boolean => {
    if (!kept.has(code)) return false;
    if (kept.size <= 1) { if (!guarded.has(code)) guarded.set(code, { code, reason }); return false; }
    const needed = onlyUser(code);
    if (needed) { if (!guarded.has(code)) guarded.set(code, { code, reason, ...needed }); return false; }
    kept.delete(code);
    guarded.delete(code);
    excluded.push({ code, reason, ...(by !== undefined ? { by } : {}) });
    return true;
  };

  if (options.dominated) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const variant of longestFirst) {
        if (!kept.has(variant.code)) continue;
        const dominator = [...kept].map((code) => byCode.get(code)!)
          .filter((other) => other.code !== variant.code && dominatesVariant(other, variant, measures))
          .sort((a, b) => length(a) - length(b) || (a.code < b.code ? -1 : 1))[0];
        if (dominator && tryRemove(variant.code, "DOMINATED", dominator.code)) changed = true;
      }
    }
  }
  const percent = options.maxPercentLonger;
  if (known(percent) && percent >= 0 && kept.size > 0) {
    const shortest = Math.min(...[...kept].map((code) => length(byCode.get(code)!)));
    const limit = shortest * (1 + percent / 100);
    for (const variant of longestFirst) if (kept.has(variant.code) && length(variant) > limit + 0.5) tryRemove(variant.code, "OVER_PERCENT");
  }
  const count = options.maxCount;
  if (known(count) && count >= 1) {
    // Den kortaste behålls alltid, också när skyddet håller kvar fler än taket.
    const shortest = [...longestFirst].reverse().find((variant) => kept.has(variant.code))?.code;
    for (const variant of longestFirst) {
      if (kept.size <= count) break;
      if (kept.has(variant.code) && variant.code !== shortest) tryRemove(variant.code, "OVER_COUNT");
    }
  }
  const order = variants.map((variant) => variant.code);
  return {
    measures, lengthMeasure,
    kept: order.filter((code) => kept.has(code)),
    excluded: [...excluded].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code)),
    protected: order.filter((code) => guarded.has(code) && kept.has(code)).map((code) => guarded.get(code)!)
  };
}

/** Kontrollerna och sträckorna som ingen behållen variant springer (efter bortval för hand). */
export function unusedAfterExclusion(variants: readonly PrunableVariant[], excludedCodes: ReadonlySet<string>):
  { readonly controls: readonly string[]; readonly legs: readonly string[] } {
  const kept = variants.filter((variant) => !excludedCodes.has(variant.code));
  const keptControls = new Set(kept.flatMap((variant) => variant.controls));
  const keptLegs = new Set(kept.flatMap((variant) => variant.legs));
  const controls = [...new Set(variants.flatMap((variant) => variant.controls))].filter((control) => !keptControls.has(control));
  const legs = [...new Set(variants.flatMap((variant) => variant.legs))].filter((leg) => !keptLegs.has(leg));
  return { controls, legs };
}
