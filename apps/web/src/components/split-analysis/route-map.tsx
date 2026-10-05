"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { PublicLegRoutes } from "@o-tid/contracts";
import { routeChoiceSv as text, splitAnalysisSv } from "../../i18n/split-analysis-sv";
import { formatDuration } from "../../lib/clock-time";
import { routeHref } from "../../lib/split-analysis";
import styles from "./route-map.module.css";

type Box = { x: number; y: number; w: number; h: number };
type Runner = PublicLegRoutes["runners"][number];

/** Rutans gränser runt punkterna, med marginal och en minsta storlek så att en kort sträcka inte blir för inzoomad. */
function fit(runners: readonly Runner[], width: number, height: number): Box {
  const xs = runners.flatMap(runner => runner.points.map(point => point[0]));
  const ys = runners.flatMap(runner => runner.points.map(point => point[1]));
  if (xs.length === 0) return { x: 0, y: 0, w: width, h: height };
  const minSide = Math.max(width, height) / 12;
  const w = Math.max(Math.max(...xs) - Math.min(...xs), minSide) * 1.3;
  const h = Math.max(Math.max(...ys) - Math.min(...ys), minSide) * 1.3;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

const path = (points: readonly (readonly [number, number])[]) => points.map(point => `${point[0]},${point[1]}`).join(" ");

/**
 * Vägval på kartan (PLAN.md steg 16): kartbilden och rutterna som SVG. Den valda löparen ritas tjock och röd med vit
 * kant, andra löpare på samma sträcka tunna och mörka. Start och slut på den valda sträckan är ringar. Dra för att
 * flytta, zooma med knappar eller mushjul. Ingen animation.
 */
export function RouteMap({ raceId, data }: { raceId: string; data: PublicLegRoutes }) {
  const { width, height, version } = data.map;
  const selected = data.runners[0]!;
  const others = data.runners.slice(1);
  const [showOthers, setShowOthers] = useState(true);
  const [highlight, setHighlight] = useState<string>();
  const [imageFailed, setImageFailed] = useState(false);
  const shown = useMemo(() => showOthers ? data.runners : [selected], [showOthers, data.runners, selected]);
  const legBox = useMemo(() => fit(shown, width, height), [shown, width, height]);
  const [box, setBox] = useState<Box>(() => fit(data.runners, width, height));
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; box: Box; id: number }>(undefined);

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
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, box, id: event.pointerId };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const { scale } = geometry(start.box);
    setBox({ ...start.box, x: start.box.x - (event.clientX - start.x) * scale, y: start.box.y - (event.clientY - start.y) * scale });
  };
  const endDrag = () => { drag.current = undefined; };
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
        {showOthers && others.map(runner => <g key={runner.publicResultId} className={styles.other}
          data-highlight={highlight === runner.publicResultId || undefined}>
          <polyline className={styles.halo} points={path(runner.points)} vectorEffect="non-scaling-stroke" />
          <polyline className={styles.line} points={path(runner.points)} vectorEffect="non-scaling-stroke" />
        </g>)}
        <g className={styles.selected} data-testid="selected-route">
          <polyline className={styles.halo} points={path(selected.points)} vectorEffect="non-scaling-stroke" />
          <polyline className={styles.line} points={path(selected.points)} vectorEffect="non-scaling-stroke" />
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
      <p className={styles.sub}>{text.gpsNotice}</p>
    </section>
  </div>;
}
