"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { PublicLegRoutes } from "@o-tid/contracts";
import { routeChoiceSv, splitAnalysisSv as splitSv } from "../../i18n/split-analysis-sv";
import { routeChoiceEn, splitAnalysisEn } from "../../i18n/public-en";
import { useLanguage } from "../language-provider";
import { formatDuration } from "../../lib/clock-time";
import { routeHref } from "../../lib/split-analysis";
import styles from "./route-map.module.css";

type Box = { x: number; y: number; w: number; h: number };
type Runner = PublicLegRoutes["runners"][number];

/** Rutans gränser runt punkterna, med marginal och en minsta storlek så att en kort sträcka inte blir för inzoomad. */
export function fitRouteBox(runners: readonly Runner[], width: number, height: number): Box {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const runner of runners) {
    for (const [x, y] of runner.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: width, h: height };
  const minSide = Math.max(width, height) / 12;
  const w = Math.max(maxX - minX, minSide) * 1.3;
  const h = Math.max(maxY - minY, minSide) * 1.3;
  const cx = (maxX + minX) / 2, cy = (maxY + minY) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

const path = (points: readonly (readonly [number, number])[]) => points.map(point => `${point[0]},${point[1]}`).join(" ");

/**
 * Vägval på kartan (PLAN.md steg 16): kartbilden och rutterna som SVG. Den valda löparen ritas tjock och röd med vit
 * kant, andra löpare på samma sträcka tunna och mörka. Start och slut på den valda sträckan är ringar. Dra för att
 * flytta, zooma med knappar eller mushjul. Ingen animation.
 */
export function RouteMap({ raceId, data }: { raceId: string; data: PublicLegRoutes }) {
  const en = useLanguage() === "en";
  const text = en ? routeChoiceEn : routeChoiceSv, splitAnalysisSv = en ? splitAnalysisEn : splitSv;
  const { width, height, version } = data.map;
  const selected = data.runners[0]!;
  const others = data.runners.slice(1);
  const [showOthers, setShowOthers] = useState(true);
  const [highlight, setHighlight] = useState<string>();
  const [imageFailed, setImageFailed] = useState(false);
  const shown = useMemo(() => showOthers ? data.runners : [selected], [showOthers, data.runners, selected]);
  const legBox = useMemo(() => fitRouteBox(shown, width, height), [shown, width, height]);
  const [box, setBox] = useState<Box>(() => fitRouteBox(data.runners, width, height));
  const paths = useMemo(() => ({
    course: data.course ? data.course.points.map(point => `${point.x},${point.y}`).join(" ") : undefined,
    best: data.bestRoute ? path(data.bestRoute.points) : undefined,
    selected: path(data.runners[0]!.points),
    others: data.runners.slice(1).map(runner => ({ id: runner.publicResultId, points: path(runner.points) }))
  }), [data]);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; box: Box; id: number }>(undefined);
  const panRaf = useRef<number | undefined>(undefined);
  const pendingPan = useRef<{ readonly start: { x: number; y: number; box: Box }; readonly clientX: number; readonly clientY: number } | undefined>(undefined);

  /** Kartpixlar per skärmpixel och den tomma kanten när rutan och SVG:n har olika form ("meet"). */
  const geometry = (current: Box) => {
    const rect = svg.current!.getBoundingClientRect();
    const scale = Math.max(current.w / rect.width, current.h / rect.height);
    return { rect, scale, offsetX: (rect.width * scale - current.w) / 2, offsetY: (rect.height * scale - current.h) / 2 };
  };
  /** Zoomar runt en punkt i skärmkoordinater (annars mitten). */
  const zoom = (factor: number, client?: { x: number; y: number }) => setBox(current => {
    const maxSide = Math.max(width, height) * 1.5;
    const w = Math.min(Math.max(current.w * factor, 40), maxSide), h = current.h * (w / current.w);
    let cx = current.x + current.w / 2, cy = current.y + current.h / 2;
    if (client && svg.current) {
      const { rect, scale, offsetX, offsetY } = geometry(current);
      cx = current.x - offsetX + (client.x - rect.left) * scale;
      cy = current.y - offsetY + (client.y - rect.top) * scale;
    }
    return { x: cx - (cx - current.x) * (w / current.w), y: cy - (cy - current.y) * (h / current.h), w, h };
  });
  // Mushjulet zoomar kartan i stället för att rulla sidan (kräver en lyssnare som inte är passiv).
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      zoomRef.current(event.deltaY > 0 ? 1.25 : 0.8, { x: event.clientX, y: event.clientY });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => () => { if (panRaf.current !== undefined) cancelAnimationFrame(panRaf.current); }, []);
  const applyPendingPan = () => {
    const pending = pendingPan.current;
    pendingPan.current = undefined;
    if (!pending || !svg.current) return;
    const { scale } = geometry(pending.start.box);
    setBox({ ...pending.start.box, x: pending.start.box.x - (pending.clientX - pending.start.x) * scale, y: pending.start.box.y - (pending.clientY - pending.start.y) * scale });
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, box, id: event.pointerId };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    pendingPan.current = { start, clientX: event.clientX, clientY: event.clientY };
    if (panRaf.current === undefined) {
      panRaf.current = requestAnimationFrame(() => { panRaf.current = undefined; applyPendingPan(); });
    }
  };
  const endDrag = () => {
    if (panRaf.current !== undefined) { cancelAnimationFrame(panRaf.current); panRaf.current = undefined; }
    applyPendingPan();
    drag.current = undefined;
  };
  const marker = box.w / 110;
  const first = selected.points[0]!, last = selected.points.at(-1)!;

  return <div className={styles.layout}>
    <section className={styles.mapPane} aria-label={text.map}>
      <div className={styles.controls} role="group" aria-label={text.map}>
        <button type="button" onClick={() => zoom(0.67)}>{text.zoomIn}</button>
        <button type="button" onClick={() => zoom(1.5)}>{text.zoomOut}</button>
        <button type="button" onClick={() => setBox(legBox)}>{text.fitLeg}</button>
        <button type="button" onClick={() => setBox({ x: 0, y: 0, w: width, h: height })}>{text.fitMap}</button>
        {others.length > 0 && <label className={styles.toggle}><input type="checkbox" checked={showOthers}
          onChange={event => setShowOthers(event.target.checked)} />{text.others}</label>}
      </div>
      {imageFailed && <p className={styles.error} role="alert">{text.imageError}</p>}
      <svg ref={svg} className={styles.map} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet"
        role="img" aria-label={text.map} data-testid="route-map" onPointerDown={onPointerDown}
        onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <image href={`/api/public/races/${encodeURIComponent(raceId)}/map?v=${version}`} x={0} y={0} width={width} height={height}
          preserveAspectRatio="none" onError={() => setImageFailed(true)} />
        {/* Steg 49: löparens bana (variant) ur banfilens lägen, med den valda sträckan markerad. */}
        {data.course && paths.course !== undefined && <g className={styles.course} data-testid="route-course">
          <polyline points={paths.course} vectorEffect="non-scaling-stroke" />
          {data.course.points.map((point, index) => <g key={`${point.label}-${index}`} data-leg={point.leg || undefined}>
            <circle cx={point.x} cy={point.y} r={marker * 1.6} vectorEffect="non-scaling-stroke" />
            {point.label === "M" && <circle cx={point.x} cy={point.y} r={marker * 1.1} vectorEffect="non-scaling-stroke" />}
            <text x={point.x + marker * 1.9} y={point.y - marker * 1.2} fontSize={marker * 2}>{point.label === "S" ? text.courseStart
              : point.label === "M" ? text.courseFinish : point.label}</text>
          </g>)}
        </g>}
        {/* Steg 60: bästa vägvalet enligt kartan, som arrangören publicerat (bara när banorna är publika). */}
        {paths.best !== undefined && <g className={styles.best} data-testid="best-route">
          <polyline className={styles.halo} points={paths.best} vectorEffect="non-scaling-stroke" />
          <polyline className={styles.line} points={paths.best} vectorEffect="non-scaling-stroke" />
        </g>}
        {showOthers && paths.others.map(runner => <g key={runner.id} className={styles.other}
          data-highlight={highlight === runner.id || undefined}>
          <polyline className={styles.halo} points={runner.points} vectorEffect="non-scaling-stroke" />
          <polyline className={styles.line} points={runner.points} vectorEffect="non-scaling-stroke" />
        </g>)}
        <g className={styles.selected} data-testid="selected-route">
          <polyline className={styles.halo} points={paths.selected} vectorEffect="non-scaling-stroke" />
          <polyline className={styles.line} points={paths.selected} vectorEffect="non-scaling-stroke" />
          <circle className={styles.end} cx={first[0]} cy={first[1]} r={marker} vectorEffect="non-scaling-stroke" />
          <circle className={styles.end} cx={last[0]} cy={last[1]} r={marker} vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <p className={styles.hint}>{text.panHint}</p>
    </section>
    <section className={styles.runners} aria-labelledby="route-runners">
      <h2 id="route-runners">{text.runnersHeading}</h2>
      <ol>
        {data.runners.map(runner => {
          const diff = runner.legMs - selected.legMs;
          return <li key={runner.publicResultId} data-selected={runner.selected || undefined}
            onMouseEnter={() => setHighlight(runner.publicResultId)} onMouseLeave={() => setHighlight(undefined)}>
            <span className={styles.swatch} data-kind={runner.selected ? "selected" : "other"} aria-hidden="true" />
            <span className={styles.who}>
              {runner.selected ? <strong>{runner.name}</strong> : <Link href={routeHref(raceId, runner.publicResultId, data.leg)}>{runner.name}</Link>}
              <span className={styles.sub}>{runner.className}{runner.selected ? ` · ${text.selected}` : ""}</span>
            </span>
            <span className={styles.time}>{formatDuration(runner.legMs)}
              {!runner.selected && diff !== 0 && <span className={styles.sub}>
                {diff > 0 ? splitAnalysisSv.lossValue(formatDuration(diff)) : splitAnalysisSv.gainValue(formatDuration(-diff))}</span>}</span>
          </li>;
        })}
      </ol>
      {others.length === 0 && <p className={styles.sub}>{text.noOthers}</p>}
      {data.bestRoute && <p className={styles.bestLegend}><span className={styles.swatch} data-kind="best" aria-hidden="true" />{text.bestRoute}</p>}
      <p className={styles.sub}>{text.gpsNotice}</p>
    </section>
  </div>;
}
