"use client";

import { useMemo } from "react";
import type { LegAnalysis } from "@o-tid/route-choice";
import { routeChoiceSv as text } from "../../i18n/route-choice-sv";
import { controlMapView } from "../../lib/control-map";
import { corridorPath, legBounds, legName, mmToPixel, polyline, type PlannedLeg, type Render } from "../../lib/route-choice-view";
import { ControlMapSvg, type DrawnControl } from "./control-map-svg";
import styles from "./route-choice.module.css";

/**
 * Steg 60: vald sträcka på kartbilden. Stråket (vägar högst 5 % sämre) som tonad yta, alternativen streckade och bästa
 * vägen som en tydlig linje; ändarna som kontrollringar. Linjerna är kartfilens mm omräknade till bildens pixlar.
 */
export function RouteChoiceMap({ render, image, leg, analysis, metersPerUnit }: {
  render: Render; image: { href: string; width: number; height: number } | undefined; leg: PlannedLeg;
  analysis: LegAnalysis | undefined; metersPerUnit: number | null;
}) {
  const bounds = useMemo(() => legBounds(render, leg, analysis), [render, leg, analysis]);
  const view = useMemo(() => controlMapView(bounds, image ? { width: image.width, height: image.height } : null), [bounds, image]);
  const corridor = useMemo(() => analysis?.corridor ? corridorPath(render, analysis.corridor) : "", [render, analysis]);
  if (!view || !leg.input) return <p className={styles.muted}>{text.noPlaces}</p>;
  const [fromKey = "", toKey = ""] = leg.key.split("-");
  const ends: DrawnControl[] = ([[fromKey, leg.input.from], [toKey, leg.input.to]] as const).flatMap(([key, point]) => {
    if (key === "S" || key === "F") return [];
    const code = Number(key.split(".")[0]);
    return [{ key: `e${key}`, code, at: mmToPixel(render, point), tone: "course" as const, title: text.control(code) }];
  });
  const start = fromKey === "S" ? [{ key: "s", at: mmToPixel(render, leg.input.from), kind: "START" as const, tone: "course" as const }] : [];
  const finish = toKey === "F" ? [{ key: "f", at: mmToPixel(render, leg.input.to), kind: "FINISH" as const, tone: "course" as const }] : [];
  const stroke = view.radius * 0.35;
  return <ControlMapSvg view={view} image={image} controls={ends} lines={[]} ends={[...start, ...finish]} metersPerUnit={metersPerUnit}
    label={text.map(legName(leg.key))} underlay={<g className={styles.routes} data-testid="route-choice-lines">
      {corridor && <path className={styles.corridor} d={corridor} data-testid="route-choice-corridor" />}
      {analysis?.alternatives.map((alternative, index) => <polyline key={index} className={styles.alternative} points={polyline(render, alternative.points)}
        style={{ strokeWidth: stroke * 0.8, strokeDasharray: `${stroke * 2.5} ${stroke * 1.5}` }} data-testid="route-choice-alternative">
        <title>{text.alternative(index, Math.round((alternative.timeRatio - 1) * 100))}</title></polyline>)}
      {analysis?.best && <g data-testid="route-choice-best">
        <polyline className={styles.halo} points={polyline(render, analysis.best.points)} style={{ strokeWidth: stroke * 2.2 }} />
        <polyline className={styles.best} points={polyline(render, analysis.best.points)} style={{ strokeWidth: stroke }} />
      </g>}
    </g>} />;
}
