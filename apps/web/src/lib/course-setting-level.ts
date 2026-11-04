import {
  levelControls, levelDeviation, levelLegPairs, levelRank, type CourseCheck, type CourseLevel, type CourseSettingDocument, type LevelAssessment,
  type LevelDeviation, type LevelRank, type LevelVerdict
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { courseSettingLevelSv as text, LEVEL_REASONS, LEVEL_TIPS } from "../i18n/course-setting-level-sv";
import type { LevelLegRequest } from "./route-choice-worker-protocol";
import { controlLabel, hash, legInput } from "./course-setting-text";

/**
 * Nivåstödet (ADR-0212) i editorn: indata till vägvalens Worker, signaturen som säger när en bedömning är inaktuell, och
 * raderna i resultatpanelen och Varningar. Ren logik.
 */
export interface LevelRequest {
  readonly legs: readonly LevelLegRequest[];
  readonly controls: ReturnType<typeof levelControls>;
  readonly sprint: boolean;
}

export function levelRequest(document: CourseSettingDocument, course: string): LevelRequest {
  const legs = levelLegPairs(document, course).flatMap(({ from, to }) => {
    const input = legInput(document, from, to, [], course);
    return input ? [{ input, from, to }] : [];
  });
  return { legs, controls: levelControls(document, course), sprint: document.event.overprintStandard === "ISSPROM2019" };
}

/** Ändras när banan, kontrollerna, deras beskrivningar, spärrarna eller kartan ändras (då är bedömningen inaktuell). */
export function levelSignature(request: LevelRequest, mapSha256: string | undefined): string {
  return hash(JSON.stringify([mapSha256 ?? "", request.sprint, request.legs.map(leg => leg.input.key), request.controls]));
}

export interface LevelRow {
  readonly key: string;
  readonly kind: "control" | "leg";
  readonly label: string;
  readonly rank: LevelRank;
  readonly reason: string;
  readonly deviation?: LevelDeviation | undefined;
  readonly tip?: string | undefined;
  /** Kontrollen eller sträckan att välja. */
  readonly control?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  /** Punkterna som visas på kartan ("Visa på kartan"). */
  readonly points: readonly Point[];
  /** Förslagen ("Visa förslag på kartan"). */
  readonly candidates: readonly { readonly kind: "junction" | "handrail" | "bigFeature" | "offAt"; readonly at: Point }[];
}

function reasonOf(kind: "control" | "leg", verdict: LevelVerdict): string {
  if (!verdict.rule) return kind === "control" ? text.panel.okControl : text.panel.okLeg;
  const reason = LEVEL_REASONS[verdict.rule as keyof typeof LEVEL_REASONS];
  return reason ? reason(verdict.values) : verdict.rule;
}

const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Raderna i panelen: avvikelserna mot målnivån först, sedan de svåraste. */
export function levelRows(document: CourseSettingDocument, assessment: LevelAssessment, target: CourseLevel | undefined): LevelRow[] {
  const goal = target ? levelRank(target) : undefined;
  const rows: LevelRow[] = [];
  for (const item of assessment.controls) {
    const id = item.features.control;
    const point = document.controls[id]?.at;
    if (!point) continue;
    const deviation = goal !== undefined ? levelDeviation("control", item.features, item.verdict.rank, goal) : undefined;
    const candidates = (deviation?.show ?? []).flatMap(kind => {
      const at = kind === "offAt" ? undefined : item.features.candidates[kind];
      return at ? [{ kind, at }] : [];
    });
    rows.push({ key: `c:${id}`, kind: "control", label: capital(controlLabel(document, id)), rank: item.verdict.rank, reason: reasonOf("control", item.verdict),
      deviation, tip: deviation ? LEVEL_TIPS[deviation.rule] : undefined, control: id, points: [point], candidates });
  }
  for (const item of assessment.legs) {
    const { from, to } = item.features;
    const a = document.controls[from]?.at, b = document.controls[to]?.at;
    if (!a || !b) continue;
    const deviation = goal !== undefined ? levelDeviation("leg", item.features, item.verdict.rank, goal) : undefined;
    const offAt = item.features.offAt;
    const candidates = deviation?.show.includes("offAt") && offAt ? [{ kind: "offAt" as const, at: offAt }] : [];
    rows.push({ key: `l:${from}-${to}`, kind: "leg", label: capital(text.panel.leg(controlLabel(document, from), controlLabel(document, to))),
      rank: item.verdict.rank, reason: reasonOf("leg", item.verdict), deviation, tip: deviation ? LEVEL_TIPS[deviation.rule] : undefined, from, to,
      points: [a, b], candidates });
  }
  const weight = (row: LevelRow) => row.deviation?.direction === "HARDER" ? 0 : row.deviation ? 1 : 2;
  return rows.sort((x, y) => weight(x) - weight(y) || y.rank - x.rank);
}

/** Notisen i Varningar för en avvikelse. */
export function levelCheckText(document: CourseSettingDocument, check: Extract<CourseCheck, { kind: "LEVEL_DEVIATION" }>, assessment: LevelAssessment | undefined): string {
  const label = check.control !== undefined ? capital(controlLabel(document, check.control))
    : capital(text.panel.leg(controlLabel(document, check.from ?? ""), controlLabel(document, check.to ?? "")));
  const verdict = check.control !== undefined ? assessment?.controls.find(item => item.features.control === check.control)?.verdict
    : assessment?.legs.find(item => item.features.from === check.from && item.features.to === check.to)?.verdict;
  const reason = check.direction === "EASIER" ? text.panel.easierTag.toLowerCase() : verdict ? reasonOf(check.control !== undefined ? "control" : "leg", verdict) : "";
  return text.check(label, text.rankName(check.rank), text.levelName(check.target), reason, LEVEL_TIPS[check.rule]);
}

/** Nivåns färg (märket och markeringen på kartan): SOFT:s färger, Blå–Svart delad. */
export const LEVEL_COLORS: Readonly<Record<LevelRank, { readonly fill: string; readonly text: string; readonly border: string }>> = {
  0: { fill: "#2e8b3a", text: "#ffffff", border: "#1f6a2a" },
  1: { fill: "#ffffff", text: "#1a1a1a", border: "#6b6b6b" },
  2: { fill: "#f2c200", text: "#1a1a1a", border: "#b08d00" },
  3: { fill: "#f28c00", text: "#1a1a1a", border: "#b86a00" },
  4: { fill: "#8a3ab9", text: "#ffffff", border: "#6a2c8e" },
  5: { fill: "#1f4fae", text: "#ffffff", border: "#111111" }
};
