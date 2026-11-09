"use client";

import { useMemo } from "react";
import { routeChoiceAnalysisEn } from "../../i18n/route-choice-en";
import { useTexts } from "../language-provider";
import type { LegAnalysis } from "@o-tid/route-choice";
import { routeChoiceSv } from "../../i18n/route-choice-sv";
import { controlMapView } from "../../lib/control-map";
import {
  alternativeColor, alternativeLabels, corridorPath, legBounds, legName, mmToPixel, polyline, ROUTE_CHOICE_COLORS, type PlannedLeg, type Render
} from "../../lib/route-choice-view";
import { ControlMapSvg, type DrawnControl } from "./control-map-svg";
import styles from "./route-choice.module.css";

/**
 * Steg 60: vald sträcka på kartbilden. Stråket (vägar högst 5 % sämre) som tonad yta, alternativen streckade i var sin
 * färg med vit kant och en etikett med nummer och tidsskillnad, och bästa vägen överst som tjock blå linje med vit kant;
 * ändarna som kontrollringar. Linjerna är kartfilens mm omräknade till bildens pixlar.
 */
export function RouteChoiceMap({ render, image, leg, analysis, metersPerUnit }: {
  render: Render; image: { href: string; width: number; height: number } | undefined; leg: PlannedLeg;
  analysis: LegAnalysis | undefined; metersPerUnit: number | null;
}) {
  const text = useTexts(routeChoiceSv, routeChoiceAnalysisEn);
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
  const stroke = view.radius * 0.45;
  const labels = analysis ? alternativeLabels(analysis, view.radius * 3 / render.pxPerMm, text) : [];
  const alternatives = analysis?.alternatives ?? [];
  return <ControlMapSvg view={view} image={image} controls={ends} lines={[]} ends={[...start, ...finish]} metersPerUnit={metersPerUnit}
    label={text.map(legName(leg.key, text))} underlay={<g className={styles.routes} data-testid="route-choice-lines">
      {corridor && <path className={styles.corridor} d={corridor} data-testid="route-choice-corridor" />}
      {alternatives.map((alternative, index) => ({ alternative, index })).reverse().map(({ alternative, index }) => <g key={index}
        data-testid="route-choice-alternative">
        <title>{text.alternative(index, Math.round((alternative.timeRatio - 1) * 100))}</title>
        <polyline className={styles.halo} points={polyline(render, alternative.points)} style={{ strokeWidth: stroke * 1.9 }} />
        <polyline className={styles.alternative} points={polyline(render, alternative.points)}
          style={{ stroke: alternativeColor(index), strokeWidth: stroke, strokeDasharray: `${stroke * 2.6} ${stroke * 1.5}` }} />
      </g>)}
      {analysis?.best && <g data-testid="route-choice-best">
        <polyline className={styles.halo} points={polyline(render, analysis.best.points)} style={{ strokeWidth: stroke * 2.2 }} />
        <polyline className={styles.best} points={polyline(render, analysis.best.points)} style={{ stroke: ROUTE_CHOICE_COLORS.best, strokeWidth: stroke * 1.25 }} />
      </g>}
      {labels.map(label => { const at = mmToPixel(render, label.at), size = view.radius * 0.9, width = size * (label.text.length * 0.62 + 0.8);
        return <g key={label.index} className={styles.label} data-testid="route-choice-label">
          <rect x={at.x - width / 2} y={at.y - size * 0.75} width={width} height={size * 1.5} style={{ stroke: alternativeColor(label.index), strokeWidth: size * 0.15 }} />
          <text x={at.x} y={at.y} style={{ fontSize: size }}>{label.text}</text>
        </g>; })}
    </g>} />;
}
