/**
 * Nivåstödet (ADR-0212): det som mäts vid en kontroll och längs en sträckas bästa vägval, bara ur kartans symboler (som
 * löparna ser dem) och vägvalsmotorns vägar. Ren funktion; gränserna står i `LEVEL_LIMITS` (`level-rules.ts`).
 */
import type { Point } from "@o-tid/map-file";
import { BIG_BOULDER_METERS, SIZE_BY_DESCRIPTION, SMALL_BOULDER_METERS } from "./level-symbols";
import {
  contourLengthNear, inOpenLand, junctionsNear, nearestHandrail, networkJunctionsNear, objectsNear, type LevelMap, type LevelObject
} from "./level-map";
import type { ControlLevelFeatures, FeatureSize, LegLevelFeatures } from "./level-types";
import { LEVEL_LIMITS } from "./level-rules";

export interface LevelControlInput {
  readonly id: string;
  readonly at: Point;
  /** Kolumn D (Purple Pens id) och kolumn F (mått, t.ex. "1.5" eller "2x3") ur beskrivningen. */
  readonly d?: string | undefined;
  readonly f?: string | undefined;
}

export interface LevelLegInput {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  /** Bästa vägvalet (kartans mm); saknas när ingen väg finns. */
  readonly best?: readonly Point[] | undefined;
  /** Vägen längs vägar och stigar: hur mycket långsammare än bästa (1,15 = 15 %). */
  readonly followRatio?: number | undefined;
  /** Motorns skilda vägval utöver det bästa: hur mycket långsammare var och ett är (1,08 = 8 %). */
  readonly alternatives?: readonly number[] | undefined;
}

const round = (value: number) => Math.round(value);

/** Kontrollens föremål: kolumn D om den finns (sten med höjd ≥ 1,5 m eller stor sten på kartan blir stor), annars kartan. */
function featureOf(prepared: LevelMap, control: LevelControlInput, mmPerMeter: number, handrailMm: number | undefined): ControlLevelFeatures["feature"] {
  const near = objectsNear(prepared, control.at, LEVEL_LIMITS.control.featureSearchMeters * mmPerMeter);
  if (control.d) {
    let size: FeatureSize = SIZE_BY_DESCRIPTION[control.d] ?? "UNKNOWN";
    // Kartan säger mer om samma slags föremål (204 sten, 205 stor sten); en sten med höjd ≥ 1,5 m i kolumn F är stor.
    const mapped = near.find(hit => hit.object.d === control.d);
    if (mapped) size = mapped.object.size;
    const height = Number(/^\s*(\d+(?:[.,]\d+)?)/.exec(control.f ?? "")?.[1]?.replace(",", "."));
    if (control.d === "2.4" && Number.isFinite(height) && height >= BIG_BOULDER_METERS) size = "BIG";
    if (control.d === "2.4" && Number.isFinite(height) && height < SMALL_BOULDER_METERS) size = "SMALL";
    return { size, d: control.d, source: "DESCRIPTION", ...(mapped ? { code: mapped.object.code, name: mapped.object.name } : {}) };
  }
  const object: LevelObject | undefined = near[0]?.object;
  if (object) return { size: object.size, d: object.d, source: "MAP", code: object.code, name: object.name };
  // På ledstången själv (stigen, diket): ledstången är föremålet.
  if (handrailMm !== undefined && handrailMm <= LEVEL_LIMITS.control.onHandrailMeters * mmPerMeter) return { size: "LINE", source: "MAP" };
  return { size: "UNKNOWN", source: "NONE" };
}

/** Kontrollens mått: avståndet till ledstänger, föremålet, angreppspunkt och inläsning. */
export function controlFeatures(prepared: LevelMap, control: LevelControlInput): ControlLevelFeatures {
  const mmPerMeter = 1000 / prepared.scale;
  const limits = LEVEL_LIMITS.control;
  const search = limits.searchMeters * mmPerMeter;
  const open = inOpenLand(prepared, control.at);
  const strong = nearestHandrail(prepared, control.at, search, true);
  const any = nearestHandrail(prepared, control.at, search, false);
  const meters = (mm: number | undefined) => mm === undefined ? undefined : round(mm / mmPerMeter);
  const feature = featureOf(prepared, control, mmPerMeter, any?.distance);
  // Kontrollens eget föremål räknas inte som angreppspunkt eller inläsning.
  const own = limits.featureSearchMeters * mmPerMeter;
  const others = objectsNear(prepared, control.at, search).filter(hit => hit.distance > own);
  const min = (...values: (number | undefined)[]) => {
    const list = values.filter((value): value is number => value !== undefined);
    return list.length > 0 ? Math.min(...list) : undefined;
  };
  const big = others.find(hit => hit.object.size === "BIG");
  // Ledstänger räknas på alla avstånd (en kontroll på stigen har stigen att gå från och läsa in sig på).
  // Öppen mark är en yta, ingen ledstång (bara dess kant är det); den ger sikt att läsa in sig på, så inläsningen räknas 0 där.
  const attack = min(big?.distance, strong?.distance);
  const relocation = min(others.find(hit => hit.object.size === "BIG" || hit.object.size === "MEDIUM")?.distance, open ? 0 : any?.distance);
  const junction = junctionsNear(prepared, control.at, search)[0];
  return {
    control: control.id,
    strongMeters: meters(strong?.distance),
    handrailMeters: meters(any?.distance),
    feature,
    attackMeters: meters(attack),
    relocationMeters: meters(relocation),
    candidates: {
      ...(junction ? { junction } : {}),
      ...(strong ? { handrail: strong.point } : {}),
      ...(big ? { bigFeature: big.object.at } : {})
    }
  };
}

function along(points: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  if (points.length === 0) return out;
  out.push(points[0]!);
  // `need`: hur långt det är kvar till nästa punkt.
  let need = step;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let position = 0;
    while (length - position >= need) {
      position += need;
      out.push({ x: a.x + (b.x - a.x) * position / length, y: a.y + (b.y - a.y) * position / length });
      need = step;
    }
    need -= length - position;
  }
  return out;
}

const direction = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);
/** Vinkeln mellan två linjers riktningar utan hänsyn till håll (0–90°). */
function lineAngle(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d * 180 / Math.PI;
}

/** Sträckans mått längs bästa vägvalet. Utan väg: inget att mäta (undefined). */
export function legFeatures(prepared: LevelMap, leg: LevelLegInput): LegLevelFeatures | undefined {
  if (!leg.best || leg.best.length < 2) return undefined;
  const mmPerMeter = 1000 / prepared.scale;
  const limits = LEVEL_LIMITS.leg;
  const step = limits.sampleMeters * mmPerMeter;
  const samples = along(leg.best, step);
  const follow = limits.followMeters * mmPerMeter, free = limits.lineFreeMeters * mmPerMeter, detailRadius = limits.detailRadiusMeters * mmPerMeter;
  let strongOn = 0, anyOn = 0, offStrong = 0, offAny = 0, longestStrong = 0, longestAny = 0, detail = 0, longestDetail = 0, gap = 0;
  let offStart = 0, longestStart = 0, decisions = 0;
  let current: { feature: number; angle: number; main: number } | undefined, candidate: typeof current, run = 0;
  // Stigkorsningar som vägen passerar (stignät: att hålla rätt stig bland många är en uppgift i sig).
  const passed = new Set<number>();
  samples.forEach((sample, index) => {
    // Öppen mark är en yta, ingen ledstång: bara kanterna (mot skogen) räknas, och de är linjer i `nearestHandrail`.
    const open = inOpenLand(prepared, sample);
    const strong = nearestHandrail(prepared, sample, follow, true);
    const any = nearestHandrail(prepared, sample, free, false);
    const onStrong = strong !== undefined, onAny = any !== undefined && any.distance <= follow;
    for (const junction of networkJunctionsNear(prepared, sample, follow)) passed.add(junction);
    if (onStrong) { strongOn += 1; offStrong = 0; } else { offStrong += 1; longestStrong = Math.max(longestStrong, offStrong); }
    if (onAny) { anyOn += 1; offAny = 0; } else {
      if (offAny === 0) offStart = index;
      offAny += 1;
      if (offAny > longestAny) { longestAny = offAny; longestStart = offStart; }
    }
    // Kurvläsning: långt från alla ledstänger i detaljrik kurvbild (många höjdkurvor eller föremål runt vägen).
    if (!open && any === undefined) {
      const contourMeters = contourLengthNear(prepared, sample, detailRadius) / mmPerMeter;
      const points = objectsNear(prepared, sample, detailRadius).length;
      if (contourMeters >= limits.detailContourMeters || points >= limits.detailPoints) { detail += 1 + gap; gap = 0; longestDetail = Math.max(longestDetail, detail); }
      else if (detail > 0 && gap < 1) gap += 1; else { detail = 0; gap = 0; }
    } else { detail = 0; gap = 0; }
    // Vägvalspunkter: vägen byter till en annan ledstång som går åt ett annat håll (och följer den minst 15 m).
    if (onAny && any) {
      const angle = direction(any.segment.a, any.segment.b);
      const here = { feature: any.segment.feature, angle, main: any.segment.main };
      if (!current) current = here;
      else if (here.feature !== current.feature) {
        if (candidate?.feature === here.feature) run += 1; else { candidate = here; run = 1; }
        if (run * limits.sampleMeters >= limits.decisionRunMeters) {
          if (here.main !== current.main || lineAngle(here.angle, current.angle) > limits.decisionAngleDegrees) decisions += 1;
          current = here; candidate = undefined; run = 0;
        }
      } else { candidate = undefined; run = 0; }
    }
  });
  const total = samples.length;
  const offAt = longestAny > 0 ? samples[Math.min(total - 1, longestStart + Math.floor(longestAny / 2))] : undefined;
  let length = 0;
  for (let i = 1; i < leg.best.length; i++) length += Math.hypot(leg.best[i]!.x - leg.best[i - 1]!.x, leg.best[i]!.y - leg.best[i - 1]!.y);
  return {
    key: leg.key, from: leg.from, to: leg.to,
    meters: round(length / mmPerMeter),
    strongShare: total > 0 ? strongOn / total : 1,
    handrailShare: total > 0 ? anyOn / total : 1,
    longestOffStrongMeters: longestStrong * limits.sampleMeters,
    longestOffMeters: longestAny * limits.sampleMeters,
    decisions,
    junctions: passed.size,
    closeAlternatives: (leg.alternatives ?? []).filter(ratio => ratio <= 1 + limits.closeAlternative).length,
    shortcutGain: Math.max(0, (leg.followRatio ?? 1) - 1),
    detailMeters: longestDetail * limits.sampleMeters,
    ...(offAt ? { offAt } : {})
  };
}
