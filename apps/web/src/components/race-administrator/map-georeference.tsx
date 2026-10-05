"use client";

import { useState, type MouseEvent } from "react";
import type { AdminRaceMapState, RaceMapTiePoint } from "@o-tid/contracts";
import { raceMapSv } from "../../i18n/race-map-sv";
import { formatCoordinate, parseCoordinate } from "../../lib/coordinate";
import { Button, Field } from "../ui";
import styles from "./map-routes.module.css";

const text = raceMapSv.georeference;
type PointInput = { pixelX: string; pixelY: string; coordinate: string };
type Map = NonNullable<AdminRaceMapState["map"]>;

function initialPoints(map: Map): PointInput[] {
  return [0, 1, 2].map(index => {
    const point = map.tiePoints?.[index];
    return point ? { pixelX: String(point.pixelX), pixelY: String(point.pixelY), coordinate: formatCoordinate(point) }
      : { pixelX: "", pixelY: "", coordinate: "" };
  });
}

/** Tre punkter, eller undefined när någon saknar pixel eller giltig koordinat. */
function tiePoints(points: readonly PointInput[]): [RaceMapTiePoint, RaceMapTiePoint, RaceMapTiePoint] | undefined {
  const parsed = points.map(point => {
    const coordinate = parseCoordinate(point.coordinate);
    const pixelX = Number(point.pixelX), pixelY = Number(point.pixelY);
    if (!coordinate || point.pixelX === "" || point.pixelY === "" || !Number.isFinite(pixelX) || !Number.isFinite(pixelY)) return undefined;
    return { pixelX, pixelY, ...coordinate };
  });
  return parsed.every(point => point !== undefined) ? parsed as [RaceMapTiePoint, RaceMapTiePoint, RaceMapTiePoint] : undefined;
}

/**
 * Georeferens (PLAN.md steg 16): välj en punkt, klicka på kartan och skriv in koordinaten. Domänen räknar ut
 * transformen när punkterna sparas (tre punkter ger en affin transform, som även klarar kartor ritade mot magnetisk norr).
 */
export function MapGeoreference({ map, image, busy, onSave, onInvalid }: {
  map: Map; image: string; busy: boolean; onSave: (points: [RaceMapTiePoint, RaceMapTiePoint, RaceMapTiePoint]) => Promise<void>;
  onInvalid: () => void;
}) {
  const [points, setPoints] = useState<PointInput[]>(() => initialPoints(map));
  const [active, setActive] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const change = (index: number, value: Partial<PointInput>) =>
    setPoints(current => current.map((point, candidate) => candidate === index ? { ...point, ...value } : point));
  const place = (event: MouseEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const pixelX = Math.round(Math.min(map.width - 1, Math.max(0, (event.clientX - rect.left) * map.width / rect.width)));
    const pixelY = Math.round(Math.min(map.height - 1, Math.max(0, (event.clientY - rect.top) * map.height / rect.height)));
    change(active, { pixelX: String(pixelX), pixelY: String(pixelY) });
    setActive(current => (current + 1) % 3);
  };
  const save = () => {
    const parsed = tiePoints(points);
    if (!parsed) { onInvalid(); return; }
    void onSave(parsed);
  };
  return <section className={styles.part} aria-labelledby="map-georeference-heading">
    <h3 id="map-georeference-heading">{text.heading}</h3>
    <p className={styles.muted}>{text.help}</p>
    <div className={styles.georeference}>
      <div className={styles.points}>
        {points.map((point, index) => <fieldset key={index} className={styles.point} data-active={active === index || undefined}>
          <legend><label className={styles.choose}><input type="radio" name="map-point" checked={active === index} onChange={() => setActive(index)}
            aria-label={text.choose(index)} /><span className={styles.pin}>{index + 1}</span>{text.point(index)}</label></legend>
          <div className={styles.pixels}>
            <Field label={text.pixelX}><input inputMode="numeric" value={point.pixelX} disabled={busy}
              aria-label={`${text.point(index)} ${text.pixelX}`} onChange={event => change(index, { pixelX: event.target.value })} /></Field>
            <Field label={text.pixelY}><input inputMode="numeric" value={point.pixelY} disabled={busy}
              aria-label={`${text.point(index)} ${text.pixelY}`} onChange={event => change(index, { pixelY: event.target.value })} /></Field>
          </div>
          <Field label={text.coordinate}><input value={point.coordinate} placeholder={text.coordinatePlaceholder} disabled={busy} autoComplete="off"
            aria-label={`${text.point(index)} ${text.coordinate}`} onChange={event => change(index, { coordinate: event.target.value })} /></Field>
        </fieldset>)}
        <div><Button disabled={busy} onClick={save}>{text.save}</Button></div>
      </div>
      <div className={styles.mapFrame}>
        {imageFailed ? <p className={styles.muted} role="alert">{text.imageFailed}</p> : <>
          {/* Klick placerar den valda punkten; samma värden kan också skrivas in för hand. */}
          <img src={image} alt={text.mapImage} onClick={place} onError={() => setImageFailed(true)} draggable={false} />
          {points.map((point, index) => point.pixelX !== "" && point.pixelY !== "" && <span key={index} className={styles.marker} aria-hidden="true"
            style={{ left: `${Number(point.pixelX) / map.width * 100}%`, top: `${Number(point.pixelY) / map.height * 100}%` }}>{index + 1}</span>)}
        </>}
      </div>
    </div>
  </section>;
}
