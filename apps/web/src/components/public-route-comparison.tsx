"use client";

import { publicParticipantRouteComparisonResponseSchema, type PublicParticipantRouteComparisonResponse } from "@o-tid/contracts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { publicRouteComparisonSv as text } from "../i18n/public-route-comparison-sv";
import { publicRouteComparisonPlaybackDuration, publicRouteComparisonPlaybackMarkers } from "../lib/public-route-comparison-playback";
import { routeDistance, routeDuration, routeTimingText } from "../lib/route-display";
import { PublicLinkShare } from "./public-link-share";

const playbackSpeed = 20;
const maximumZoom = 4;
const zoomStep = 0.5;
const keyboardPanPixels = 80;
const routeClasses = ["public-route-comparison-first", "public-route-comparison-second", "public-route-comparison-third"] as const;
type ComparisonRoute = PublicParticipantRouteComparisonResponse["routes"][number];
type AvailableSplits = Extract<ComparisonRoute["resultSplits"], { status: "AVAILABLE" }>["splits"];

function routePath(points: ComparisonRoute["points"]): string {
  return points.reduce((value, point, index, all) => value + (index === 0 || point.segment !== all[index - 1]?.segment ? "M" : "L") + point.x + " " + point.y + " ", "");
}

function comparisonQuery(first: string, second: string, third?: string): URLSearchParams {
  const query = new URLSearchParams({ first, second });
  if (third !== undefined) query.set("third", third);
  return query;
}

function routeLabel(index: number, route: ComparisonRoute): string {
  const name = route.participant.givenName + " " + route.participant.familyName;
  if (index === 0) return text.firstRoute(name);
  if (index === 1) return text.secondRoute(name);
  return text.thirdRoute(name);
}

function routesWithSplits(routes: readonly ComparisonRoute[]): readonly AvailableSplits[] | null {
  const splits: AvailableSplits[] = [];
  for (const route of routes) {
    if (route.resultSplits.status !== "AVAILABLE") return null;
    splits.push(route.resultSplits.splits);
  }
  return splits;
}

export function PublicRouteComparison({ raceId, firstPublicResultId, secondPublicResultId, thirdPublicResultId }: { raceId: string; firstPublicResultId: string; secondPublicResultId: string; thirdPublicResultId?: string }) {
  const [comparison, setComparison] = useState<PublicParticipantRouteComparisonResponse>();
  const [unavailable, setUnavailable] = useState<"NOT_COMPARABLE" | "TEMPORARY" | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackElapsedMilliseconds, setPlaybackElapsedMilliseconds] = useState(0);
  const [zoom, setZoom] = useState(1);
  const playbackElapsedRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<SVGSVGElement>(null);
  const pendingCenterRef = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    pendingCenterRef.current = null;
    setZoom(1);
    viewportRef.current?.scrollTo(0, 0);
  }, [raceId, firstPublicResultId, secondPublicResultId, thirdPublicResultId]);

  useLayoutEffect(() => {
    const center = pendingCenterRef.current;
    const viewport = viewportRef.current;
    const map = mapRef.current;
    if (!center || !viewport || !map) return;
    pendingCenterRef.current = null;
    if (zoom === 1) {
      viewport.scrollTo(0, 0);
      return;
    }
    const bounds = map.getBoundingClientRect();
    viewport.scrollTo(
      Math.max(0, center.x * bounds.width - viewport.clientWidth / 2),
      Math.max(0, center.y * bounds.height - viewport.clientHeight / 2)
    );
  }, [zoom]);

  const changeZoom = (next: number) => {
    const level = Math.max(1, Math.min(maximumZoom, next));
    if (level === zoom) return;
    const viewport = viewportRef.current;
    const map = mapRef.current;
    if (viewport && map) {
      const bounds = map.getBoundingClientRect();
      pendingCenterRef.current = {
        x: Math.max(0, Math.min(1, (viewport.scrollLeft + viewport.clientWidth / 2) / bounds.width)),
        y: Math.max(0, Math.min(1, (viewport.scrollTop + viewport.clientHeight / 2) / bounds.height))
      };
    }
    setZoom(level);
  };

  const panWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    let left = 0;
    let top = 0;
    switch (event.key) {
      case "ArrowLeft": left = -keyboardPanPixels; break;
      case "ArrowRight": left = keyboardPanPixels; break;
      case "ArrowUp": top = -keyboardPanPixels; break;
      case "ArrowDown": top = keyboardPanPixels; break;
      default: return;
    }
    const maximumLeft = viewport.scrollWidth - viewport.clientWidth;
    const maximumTop = viewport.scrollHeight - viewport.clientHeight;
    if ((left < 0 && viewport.scrollLeft <= 0) || (left > 0 && viewport.scrollLeft >= maximumLeft - 1) ||
        (top < 0 && viewport.scrollTop <= 0) || (top > 0 && viewport.scrollTop >= maximumTop - 1)) return;
    event.preventDefault();
    viewport.scrollBy({ left, top, behavior: "auto" });
  };

  const setPlaybackElapsed = (next: number) => {
    const duration = comparison ? publicRouteComparisonPlaybackDuration(comparison.routes) : null;
    const value = Math.max(0, Math.min(duration ?? 0, Math.round(next)));
    playbackElapsedRef.current = value;
    setPlaybackElapsedMilliseconds(value);
  };

  useEffect(() => {
    void (async () => {
      try {
        setComparison(undefined);
        setUnavailable(null);
        const response = await fetch("/api/public/races/" + raceId + "/route-comparison?" + comparisonQuery(firstPublicResultId, secondPublicResultId, thirdPublicResultId).toString(), { cache: "no-store" });
        if (response.status === 404) {
          setUnavailable("NOT_COMPARABLE");
          return;
        }
        if (!response.ok) throw new Error("UNAVAILABLE");
        const parsed = publicParticipantRouteComparisonResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("UNAVAILABLE");
        setComparison(parsed.data);
      } catch {
        setUnavailable("TEMPORARY");
      }
    })();
  }, [raceId, firstPublicResultId, secondPublicResultId, thirdPublicResultId]);

  const paths = useMemo(() => comparison?.routes.map((route) => routePath(route.points)) ?? [], [comparison]);
  const playbackDuration = comparison ? publicRouteComparisonPlaybackDuration(comparison.routes) : null;

  useEffect(() => {
    playbackElapsedRef.current = 0;
    setPlaybackElapsedMilliseconds(0);
    setPlaying(false);
  }, [comparison, playbackDuration]);

  useEffect(() => {
    if (!playing || playbackDuration === null) return;
    const startedAt = window.performance.now() - playbackElapsedRef.current / playbackSpeed;
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(playbackDuration, (now - startedAt) * playbackSpeed);
      setPlaybackElapsed(next);
      if (next >= playbackDuration) {
        setPlaying(false);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, playbackDuration]);

  if (unavailable === "NOT_COMPARABLE") return <p role="alert">{text.notComparable}</p>;
  if (unavailable === "TEMPORARY") return <p role="alert">{text.unavailable}</p>;
  if (!comparison) return <p role="status">{text.loading}</p>;

  const query = comparisonQuery(firstPublicResultId, secondPublicResultId, thirdPublicResultId);
  const image = "/api/public/races/" + raceId + "/route-comparison/map?" + query.toString();
  const markerRadius = Math.max(5, Math.min(comparison.imageWidth, comparison.imageHeight) / 80);
  const markerOffset = markerRadius * 1.3;
  const labels = comparison.routes.map((route, index) => routeLabel(index, route));
  const splitRoutes = routesWithSplits(comparison.routes);
  const playbackMarkers = playbackDuration === null ? null : publicRouteComparisonPlaybackMarkers(comparison.routes, playbackElapsedMilliseconds);

  return <section className="public-route-comparison stack">
    <p>{text.notice}</p>
    <PublicLinkShare path={`/results/${encodeURIComponent(raceId)}/route-comparison?${query.toString()}`} title={text.title} />
    <ul className="public-route-comparison-legend" aria-label={text.title}>
      {labels.map((label, index) => <li className={routeClasses[index]} key={label}><span aria-hidden="true" />{label}</li>)}
    </ul>
    <ul className="public-route-comparison-facts">
      {comparison.routes.map((route, index) => <li className={routeClasses[index]} key={labels[index]}><strong>{labels[index]}</strong><span>{routeDistance(route.metadata.distanceMeters)} · {route.metadata.pointCount} {text.points} · {route.metadata.segmentCount} {text.segments} · {routeTimingText(route.metadata.timing, text.timeless)}</span></li>)}
    </ul>
    {playbackDuration !== null ? <section className="public-route-playback" aria-label={text.playbackTitle(comparison.routes.length)}>
      <h2>{text.playbackTitle(comparison.routes.length)}</h2>
      <p>{text.playbackNotice(comparison.routes.length)}</p>
      <div>
        <button type="button" onClick={() => setPlaying((current) => !current)}>{playing ? text.playbackPause : text.playbackPlay}</button>
        <button type="button" onClick={() => { setPlaying(false); setPlaybackElapsed(0); }}>{text.playbackRestart}</button>
        <output aria-live="polite">{routeDuration(playbackElapsedMilliseconds)} / {routeDuration(playbackDuration)}</output>
      </div>
      <label>{text.playbackTimeline(comparison.routes.length)}<input type="range" min="0" max={playbackDuration} step="1000" value={playbackElapsedMilliseconds} onChange={(event) => { setPlaying(false); setPlaybackElapsed(Number(event.currentTarget.value)); }} /></label>
    </section> : <p className="warning">{text.playbackUnavailable(comparison.routes.length)}</p>}
    {splitRoutes ? <section className="public-route-comparison-splits">
      <h2>{text.resultSplits}</h2>
      {comparison.routes.length === 2 ? <><p className="public-route-comparison-table-hint">{text.tablePanHint}</p><table>
        <thead><tr><th scope="col">{text.controlHeading}</th><th scope="col" aria-label={`${labels[0]} · ${text.leg}`}>{text.firstShort} · {text.leg}</th><th scope="col" aria-label={`${labels[0]} · ${text.total}`}>{text.firstShort} · {text.total}</th><th scope="col" aria-label={`${labels[1]} · ${text.leg}`}>{text.secondShort} · {text.leg}</th><th scope="col" aria-label={`${labels[1]} · ${text.total}`}>{text.secondShort} · {text.total}</th></tr></thead>
        <tbody>{(splitRoutes[0] ?? []).map((split, index) => {
          const other = splitRoutes[1]?.[index];
          return <tr key={split.controlCode + ":" + split.occurrence}><td>{split.controlCode}{split.occurrence > 1 ? " (" + split.occurrence + ")" : ""}</td><td>{routeDuration(split.legMs)}</td><td>{routeDuration(split.elapsedMs)}</td><td>{other && routeDuration(other.legMs)}</td><td>{other && routeDuration(other.elapsedMs)}</td></tr>;
        })}</tbody>
      </table></> : <ol className="public-route-comparison-triple-splits">{(splitRoutes[0] ?? []).map((split, splitIndex) => <li key={split.controlCode + ":" + split.occurrence}>
        <strong>{text.controlSplit(split.controlCode, split.occurrence)}</strong>
        <ul>{comparison.routes.map((route, routeIndex) => {
          const routeSplit = splitRoutes[routeIndex]?.[splitIndex];
          return <li className={routeClasses[routeIndex]} key={labels[routeIndex]}><strong>{labels[routeIndex]}</strong><span>{text.leg}: {routeSplit ? routeDuration(routeSplit.legMs) : "–"} · {text.total}: {routeSplit ? routeDuration(routeSplit.elapsedMs) : "–"}</span></li>;
        })}</ul>
      </li>)}</ol>}
    </section> : <p className="warning">{text.splitsUnavailable}</p>}
    <div className="public-route-comparison-map-controls" role="group" aria-label={text.zoomControls}>
      <button type="button" onClick={() => changeZoom(zoom + zoomStep)} disabled={zoom >= maximumZoom}>{text.zoomIn}</button>
      <button type="button" onClick={() => changeZoom(zoom - zoomStep)} disabled={zoom <= 1}>{text.zoomOut}</button>
      <button type="button" onClick={() => changeZoom(1)} disabled={zoom <= 1}>{text.zoomReset}</button>
      <output aria-live="polite">{text.zoomLevel}: {Math.round(zoom * 100)} %</output>
    </div>
    <p className="public-route-comparison-pan-hint" id="public-route-comparison-pan-hint">{text.panHint}</p>
    <div ref={viewportRef} className="public-route-comparison-map-viewport" data-zoomed={zoom > 1} role="region" aria-label={text.mapViewport(comparison.routes.length)} aria-describedby="public-route-comparison-pan-hint" tabIndex={0} onKeyDown={panWithKeyboard}>
    <svg ref={mapRef} viewBox={"0 0 " + comparison.imageWidth + " " + comparison.imageHeight} role="img" aria-label={text.image(comparison.routes.length)} style={{ inlineSize: `${zoom * 100}%` }}>
      <image href={image} width={comparison.imageWidth} height={comparison.imageHeight} />
      {paths.map((path, index) => <path className={routeClasses[index]} d={path} fill="none" strokeWidth={Math.max(1, Math.min(comparison.imageWidth, comparison.imageHeight) / 500)} key={labels[index]} />)}
      {playbackMarkers?.map((marker, index) => marker && <circle className={"public-route-comparison-playback-marker " + routeClasses[index]} cx={marker.x} cy={marker.y} r={markerRadius * 0.7} key={labels[index]} />)}
      {comparison.controls.map((control) => <g className="public-participant-route-control" key={control.sequence + ":" + control.controlCode} aria-label={text.control(control.sequence, control.controlCode)}>
        <title>{text.control(control.sequence, control.controlCode)}</title>
        <circle cx={control.x} cy={control.y} r={markerRadius} />
        <text x={control.x} y={control.y} dy="0.35em" textAnchor="middle">{control.sequence}</text>
        <text className="public-participant-route-control-code" x={control.x + markerOffset} y={control.y - markerOffset}>{control.controlCode}</text>
      </g>)}
    </svg>
    </div>
  </section>;
}
