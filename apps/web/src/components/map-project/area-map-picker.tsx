"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { mapProjectEn } from "../../i18n/map-project-en";
import { mapProjectSv } from "../../i18n/map-project-sv";
import type { AreaInput } from "../../lib/map-project-area-input";
import { NOMINATIM_URL, OSM_TILE_URL, OVERPASS_URL, osmAreaChoices, overpassContaining, project, TILE, unproject,
  type OsmAreaChoice } from "../../lib/osm-area";
import { useLocale, useTexts } from "../language-provider";
import { Button } from "../ui";
import styles from "./map-project.module.css";

type Mode = "osm" | "draw";
const HEIGHT = 420;
/** Mitten i Sverige ungefär, tills man sökt eller dragit (Stockholm). */
const START = { lon: 18.07, lat: 59.33, zoom: 11 };

/**
 * Ägaren 2026-11-10: kartans område valt på OpenStreetMaps karta. "Välj yta i OSM": klicka i en park, skog, ö eller ett
 * naturreservat och välj bland ytorna som innehåller punkten. "Rita": klicka hörnen och tryck Klar. Bakgrunden och sökningen
 * hämtas direkt från OpenStreetMap (© OpenStreetMaps bidragsgivare); inget skickas till O-Tid förrän kartan skapas.
 */
export function AreaMapPicker({ value, onChange }: { value: AreaInput | undefined; onChange: (area: AreaInput | undefined) => void }) {
  const text = useTexts(mapProjectSv.picker, mapProjectEn.picker);
  const locale = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [view, setView] = useState(START);
  const [mode, setMode] = useState<Mode>("osm");
  const [drawn, setDrawn] = useState<[number, number][]>([]);
  const [choices, setChoices] = useState<OsmAreaChoice[]>();
  const [chosen, setChosen] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [query, setQuery] = useState("");
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean }>(undefined);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth || 600));
    observer.observe(element);
    // Hjulet zoomar kartan, inte sidan (lyssnaren får inte vara passiv för att kunna hindra sidan från att rulla).
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setView(current => ({ ...current, zoom: Math.max(3, Math.min(18, current.zoom + (event.deltaY < 0 ? 1 : -1))) }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener("wheel", wheel); };
  }, []);

  const center = project(view.lon, view.lat, view.zoom);
  const left = center.x - width / 2, top = center.y - HEIGHT / 2;
  const toScreen = ([lon, lat]: [number, number]) => { const p = project(lon, lat, view.zoom); return [p.x - left, p.y - top] as const; };
  const toLonLat = (x: number, y: number) => unproject(left + x, top + y, view.zoom);
  const zoomBy = (step: number) => setView(current => ({ ...current, zoom: Math.max(3, Math.min(18, current.zoom + step)) }));

  async function pick(lon: number, lat: number) {
    setStatus(text.searching); setChoices(undefined);
    try {
      const response = await fetch(OVERPASS_URL, { method: "POST", body: new URLSearchParams({ data: overpassContaining(lat, lon) }) });
      if (!response.ok) throw new Error(String(response.status));
      const found = osmAreaChoices(await response.json());
      setChoices(found);
      setStatus(found.length === 0 ? text.noneFound : undefined);
      if (found[0]) { setChosen(found[0].id); onChange(found[0].area); }
    } catch { setStatus(text.osmFailed); }
  }

  async function search() {
    if (!query.trim()) return;
    setStatus(text.searching);
    try {
      const response = await fetch(`${NOMINATIM_URL}?format=json&limit=1&countrycodes=se,no,fi,dk&q=${encodeURIComponent(query.trim())}`,
        { headers: { accept: "application/json" } });
      const [hit] = await response.json() as { lat: string; lon: string }[];
      if (!hit) { setStatus(text.placeNotFound); return; }
      setView({ lon: Number(hit.lon), lat: Number(hit.lat), zoom: 14 });
      setStatus(undefined);
    } catch { setStatus(text.osmFailed); }
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, cx: center.x, cy: center.y, moved: false };
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) current.moved = true;
    if (current.moved) setView(previous => ({ ...previous, ...unproject(current.cx - dx, current.cy - dy, previous.zoom) }));
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    drag.current = undefined;
    if (!current || current.moved) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const { lon, lat } = toLonLat(event.clientX - rect.left, event.clientY - rect.top);
    if (mode === "osm") void pick(lon, lat);
    else setDrawn(points => [...points, [lon, lat]]);
  }

  function finishDrawing() {
    if (drawn.length < 3) return;
    setChosen(undefined); setChoices(undefined);
    onChange({ crs: "WGS84", rings: [drawn] });
  }

  const tiles: { key: string; x: number; y: number; url: string }[] = [];
  const count = 2 ** view.zoom;
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + HEIGHT) / TILE); ty++) {
      if (ty < 0 || ty >= count) continue;
      tiles.push({ key: `${view.zoom}/${tx}/${ty}`, x: tx * TILE - left, y: ty * TILE - top, url: OSM_TILE_URL(view.zoom, ((tx % count) + count) % count, ty) });
    }
  }
  const shown = value?.crs === "WGS84" ? value.rings : [];
  const path = (ring: readonly [number, number][]) => ring.map((point, index) => `${index ? "L" : "M"}${toScreen(point).join(",")}`).join("") + "Z";

  return <div className={styles.picker} data-testid="area-map-picker">
    <div className={styles.row}>
      <label className={styles.pickerSearch}><span className={styles.srOnly}>{text.search}</span>
        <input type="search" value={query} placeholder={text.searchHelp} aria-label={text.search} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} /></label>
      <Button variant="secondary" type="button" onClick={() => void search()}>{text.go}</Button>
    </div>
    <div className={styles.actions} role="group" aria-label={text.modeLabel}>
      <Button type="button" variant={mode === "osm" ? "primary" : "secondary"} aria-pressed={mode === "osm"} onClick={() => setMode("osm")}>{text.osm}</Button>
      <Button type="button" variant={mode === "draw" ? "primary" : "secondary"} aria-pressed={mode === "draw"}
        onClick={() => { setMode("draw"); setDrawn([]); }}>{text.draw}</Button>
      {mode === "draw" && <>
        <Button type="button" disabled={drawn.length < 3} onClick={finishDrawing}>{text.done}</Button>
        <Button type="button" variant="quiet" disabled={drawn.length === 0} onClick={() => setDrawn(points => points.slice(0, -1))}>{text.undo}</Button>
      </>}
    </div>
    <p className={styles.muted}>{mode === "osm" ? text.osmHelp : text.drawHelp}</p>
    <div ref={box} className={styles.pickerMap} style={{ height: HEIGHT }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} role="application" aria-label={text.mapLabel}>
      {tiles.map(tile => <img key={tile.key} src={tile.url} alt="" width={TILE} height={TILE} draggable={false} referrerPolicy="strict-origin-when-cross-origin"
        style={{ position: "absolute", left: tile.x, top: tile.y }} />)}
      <svg width={width} height={HEIGHT} style={{ position: "absolute", inset: 0 }} aria-hidden="true">
        {shown.length > 0 && <path d={shown.map(path).join("")} fill="rgb(160 0 160 / 18%)" stroke="#a000a0" strokeWidth={2} fillRule="evenodd" />}
        {drawn.length > 0 && <polyline points={drawn.map(point => toScreen(point).join(",")).join(" ")} fill="none" stroke="#a000a0" strokeWidth={2} strokeDasharray="6 4" />}
        {drawn.map((point, index) => { const [x, y] = toScreen(point); return <circle key={index} cx={x} cy={y} r={4} fill="#a000a0" />; })}
      </svg>
      <div className={styles.pickerZoom}>
        <button type="button" aria-label={text.zoomIn} onPointerDown={event => event.stopPropagation()} onClick={() => zoomBy(1)}>+</button>
        <button type="button" aria-label={text.zoomOut} onPointerDown={event => event.stopPropagation()} onClick={() => zoomBy(-1)}>−</button>
      </div>
      <small className={styles.pickerCredit}>© OpenStreetMap</small>
    </div>
    {status && <p className={styles.muted} role="status">{status}</p>}
    {choices && choices.length > 0 && <fieldset className={styles.choice} data-testid="osm-area-choices">
      <legend>{text.choices}</legend>
      {choices.slice(0, 8).map(choice => <label key={choice.id}><input type="radio" name="osm-area" checked={chosen === choice.id}
        onChange={() => { setChosen(choice.id); onChange(choice.area); }} /> {choice.name || text.unnamed} <small className={styles.muted}>
        {choice.kind} · {text.km2(choice.km2.toLocaleString(locale, { maximumFractionDigits: 2 }))}</small></label>)}
    </fieldset>}
  </div>;
}
