"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { publicParticipantRouteViewResponseSchema, type PublicParticipantRouteViewResponse } from "@o-tid/contracts";
import { publicParticipantRouteSv as text } from "../i18n/public-participant-route-sv";
import { routeDistance, routeDuration, routeTimingText } from "../lib/route-display";
import { publicRoutePlaybackMarker } from "../lib/public-route-playback";
import { PublicLinkShare } from "./public-link-share";

const playbackSpeed = 20;
const maximumZoom = 4;
const zoomStep = 0.5;
const keyboardPanPixels = 80;

export function PublicParticipantRoute({ raceId, publicResultId }: { raceId: string; publicResultId: string }) {
  const [route, setRoute] = useState<PublicParticipantRouteViewResponse>();
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackElapsedMilliseconds, setPlaybackElapsedMilliseconds] = useState(0);
  const [zoom, setZoom] = useState(1);
  const playbackElapsedRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<SVGSVGElement>(null);
  const pendingCenterRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { void (async () => { try { const response = await fetch(`/api/public/races/${raceId}/participants/${publicResultId}/route`, { cache: "no-store" }); const parsed = publicParticipantRouteViewResponseSchema.safeParse(await response.json()); if (!response.ok || !parsed.success) throw new Error("UNAVAILABLE"); setRoute(parsed.data); } catch { setFailed(true); } })(); }, [raceId, publicResultId]);
  const playback = route?.playback;
  const playbackDuration = playback?.status === "AVAILABLE" && route?.metadata.timing.status === "AVAILABLE" ? route.metadata.timing.durationMilliseconds : 0;
  const setPlaybackElapsed = (next: number) => {
    const value = Math.max(0, Math.min(playbackDuration, Math.round(next)));
    playbackElapsedRef.current = value;
    setPlaybackElapsedMilliseconds(value);
  };
  useEffect(() => {
    setPlaying(false);
    playbackElapsedRef.current = 0;
    setPlaybackElapsedMilliseconds(0);
  }, [playback?.status, playbackDuration]);
  useEffect(() => {
    if (!playing || playback?.status !== "AVAILABLE") return;
    let animationFrame: number | undefined;
    const startedAt = window.performance.now() - playbackElapsedRef.current / playbackSpeed;
    const tick = (now: number) => {
      const next = Math.min(playbackDuration, (now - startedAt) * playbackSpeed);
      setPlaybackElapsed(next);
      if (next >= playbackDuration) { setPlaying(false); return; }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => { if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame); };
  }, [playing, playback?.status, playbackDuration]);
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
  const path = useMemo(() => route?.points.reduce((value, point, index, all) => `${value}${index === 0 || point.segment !== all[index - 1]?.segment ? "M" : "L"}${point.x} ${point.y} `, "") ?? "", [route]);
  if (failed) return <p role="alert">{text.unavailable}</p>;
  if (!route) return <p role="status">{text.loading}</p>;
  const image = `/api/public/races/${raceId}/participants/${publicResultId}/route/map`;
  const timing = route.metadata.timing;
  const markerRadius = Math.max(5, Math.min(route.imageWidth, route.imageHeight) / 80);
  const markerOffset = markerRadius * 1.3;
  const playbackMarker = playback?.status === "AVAILABLE" ? publicRoutePlaybackMarker(route.points, playback.pointElapsedMilliseconds, playbackElapsedMilliseconds) : null;
  return <section className="public-participant-route stack"><PublicLinkShare path={`/results/${encodeURIComponent(raceId)}/participants/${encodeURIComponent(publicResultId)}/route`} title={text.title} /><dl className="public-participant-route-metadata"><div><dt>{text.distance}</dt><dd>{routeDistance(route.metadata.distanceMeters)}</dd></div><div><dt>{text.points}</dt><dd>{route.metadata.pointCount}</dd></div><div><dt>{text.segments}</dt><dd>{route.metadata.segmentCount}</dd></div><div><dt>{text.recordedTime}</dt><dd>{routeTimingText(timing, text.timeless)}</dd></div></dl><p>{text.notice}</p>{playback?.status === "AVAILABLE" && <section className="public-route-playback" aria-label={text.playbackTitle}><h2>{text.playbackTitle}</h2><p>{text.playbackNotice}</p><div><button type="button" onClick={() => setPlaying((current) => !current)}>{playing ? text.playbackPause : text.playbackPlay}</button><button type="button" onClick={() => { setPlaying(false); setPlaybackElapsed(0); }}>{text.playbackRestart}</button><output aria-live="polite">{routeDuration(playbackElapsedMilliseconds)} / {routeDuration(playbackDuration)}</output></div><label>{text.playbackTimeline}<input type="range" min="0" max={playbackDuration} step="1000" value={playbackElapsedMilliseconds} onChange={(event) => { setPlaying(false); setPlaybackElapsed(Number(event.currentTarget.value)); }} /></label></section>}
    <div className="public-route-map-controls" role="group" aria-label={text.zoomControls}>
      <button type="button" onClick={() => changeZoom(zoom + zoomStep)} disabled={zoom >= maximumZoom}>{text.zoomIn}</button>
      <button type="button" onClick={() => changeZoom(zoom - zoomStep)} disabled={zoom <= 1}>{text.zoomOut}</button>
      <button type="button" onClick={() => changeZoom(1)} disabled={zoom <= 1}>{text.zoomReset}</button>
      <output aria-live="polite">{text.zoomLevel}: {Math.round(zoom * 100)} %</output>
    </div>
    <p className="public-route-pan-hint" id="public-route-pan-hint">{text.panHint}</p>
    <div ref={viewportRef} className="public-route-map-viewport" data-zoomed={zoom > 1} role="region" aria-label={text.mapViewport} aria-describedby="public-route-pan-hint" tabIndex={0} onKeyDown={panWithKeyboard}>
      <svg ref={mapRef} viewBox={`0 0 ${route.imageWidth} ${route.imageHeight}`} role="img" aria-label={text.image} style={{ inlineSize: `${zoom * 100}%` }}><image href={image} width={route.imageWidth} height={route.imageHeight} /><path d={path} fill="none" stroke="#c00020" strokeWidth={Math.max(1, Math.min(route.imageWidth, route.imageHeight) / 500)} />{playbackMarker && <circle className="public-route-playback-marker" cx={playbackMarker.x} cy={playbackMarker.y} r={markerRadius * 0.7} />}{route.controls.map((control) => <g className="public-participant-route-control" key={`${control.sequence}:${control.controlCode}`} aria-label={text.control(control.sequence, control.controlCode)}><title>{text.control(control.sequence, control.controlCode)}</title><circle cx={control.x} cy={control.y} r={markerRadius} /><text x={control.x} y={control.y} dy="0.35em" textAnchor="middle">{control.sequence}</text><text className="public-participant-route-control-code" x={control.x + markerOffset} y={control.y - markerOffset}>{control.controlCode}</text></g>)}</svg>
    </div></section>;
}
