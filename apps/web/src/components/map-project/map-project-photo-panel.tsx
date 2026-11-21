"use client";

import { mapPointToProjected, type MapGeoreference } from "@o-tid/map-file";
import { useState } from "react";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { DEFAULT_ROCK_PERCENTILE, interpretPhotoWithLaser, type PhotoLaser } from "@o-tid/map-revision/base-map";
import type { MapProjectView } from "@o-tid/contracts";
import { mapProjectBase } from "../../lib/map-project-client";
import { loadPhotoLaser } from "../../lib/map-project-photo-laser";
import { useTexts } from "../language-provider";
import { IR_LAYER_SUFFIX } from "../../lib/map-project-layer-file";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

/** Bilden skalas så att en bildpunkt blir ungefär så många meter, och ritytan blir högst så stor. */
const SWEREF99TM = 3006;
const METERS_PER_PIXEL = 1, MAX_SIDE = 4096, CELL_METERS = 2, MIN_AREA_M2 = 150;

/**
 * Grundkartan G8c (ägaren 2026-11-10: «flygbildstolkning för öppna ytor och berg i dagen»): ett underlag som är ett ortofoto
 * tolkas i webbläsaren (`lib/map-project-photo-interpret.ts`) och ytorna blir kandidater i importen. Bilden lämnar aldrig
 * webbläsaren.
 */
export function MapProjectPhotoPanel({ view, layers, georeference, importer }: { view: MapProjectView; layers: ReturnType<typeof useMapProjectLayers>; georeference: MapGeoreference;
  importer: ReturnType<typeof useMapProjectImport> }) {
  const text = useTexts(mapSourcesSv.photo, mapSourcesEn.photo);
  const [chosen, setChosen] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  // Ägaren 2026-11-18: lasern ger formen, fotot vad ytan är; reglaget flyttar gränsen mellan berg i dagen och glänta.
  const [rockPercentile, setRockPercentile] = useState(DEFAULT_ROCK_PERCENTILE);
  const [laser, setLaser] = useState<PhotoLaser | "none">();
  const [busy, setBusy] = useState(false);
  const shown = layers.drawn.map(drawn => ({ drawn, name: layers.layers.find(row => row.layerId === drawn.layerId)?.name ?? drawn.layerId }));
  if (!importer.canImport || georeference.crs.kind !== "EPSG") return null;
  const crs = georeference.crs.code;
  // Ägaren 2026-11-21 (nästa steg): alla tända ortofoton tolkas på en gång, som en mosaik, så att bildrutornas gränser inte
  // syns i ytorna och percentilerna räknas över hela området. Finns falskfärgsbilder (IR) används bara de.
  const photos = shown.filter(row => row.name.startsWith("Ortofoto"));
  const irPhotos = photos.filter(row => row.name.endsWith(IR_LAYER_SUFFIX));
  const allTiles = irPhotos.length ? irPhotos : photos;
  const ALL = "__alla";
  const chosenId = chosen || (allTiles.length > 1 ? ALL : "");
  const picked = shown.find(row => row.drawn.layerId === chosenId) ?? shown[0];
  // Ägaren 2026-11-17: finns ortofotots falskfärgsbild (nära infrarött) tolkas den i stället för färgbilden.
  const single = picked && !picked.name.endsWith(IR_LAYER_SUFFIX) ? shown.find(row => row.name === `${picked.name}${IR_LAYER_SUFFIX}`) ?? picked : picked;
  const tiles = chosenId === ALL ? allTiles : single ? [single] : [];
  const infrared = tiles.length > 0 && tiles.every(row => row.name.endsWith(IR_LAYER_SUFFIX));

  async function interpret() {
    if (tiles.length === 0) return;
    setMessage(undefined);
    let found = laser;
    if (found === undefined) {
      setBusy(true);
      found = await loadPhotoLaser(mapProjectBase(view.projectId)).catch(() => undefined) ?? "none";
      setLaser(found); setBusy(false);
    }
    if (found === "none" || crs !== SWEREF99TM) { setMessage({ tone: "error", text: found === "none" ? text.noLaser : text.notSweref }); return; }
    try {
      // Mosaiken i kartans mm (y uppåt): bildrutornas hörn ger utbredningen, en bildpunkt ≈ METERS_PER_PIXEL m.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const { drawn: { image, toMap } } of tiles) for (const [px, py] of [[0, 0], [image.width, 0], [0, image.height], [image.width, image.height]] as const) {
        const x = toMap.a * px + toMap.b * py + toMap.c, y = toMap.d * px + toMap.e * py + toMap.f;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      let step = METERS_PER_PIXEL * 1000 / georeference.scale; // mm per bildpunkt
      step = Math.max(step, (maxX - minX) / MAX_SIDE, (maxY - minY) / MAX_SIDE);
      const width = Math.max(1, Math.ceil((maxX - minX) / step)), height = Math.max(1, Math.ceil((maxY - minY) / step));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) { setMessage({ tone: "error", text: text.failed }); return; }
      for (const { drawn: { image, toMap } } of tiles) {
        context.setTransform(toMap.a / step, -toMap.d / step, toMap.b / step, -toMap.e / step, (toMap.c - minX) / step, (maxY - toMap.f) / step);
        context.drawImage(image, 0, 0);
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      const cellMeters = step * georeference.scale / 1000, cellPixels = Math.max(1, Math.round(CELL_METERS / cellMeters));
      const cellArea = (cellPixels * cellMeters) ** 2;
      const result = interpretPhotoWithLaser(context.getImageData(0, 0, width, height), { cellPixels, minCells: Math.max(4, Math.round(MIN_AREA_M2 / cellArea)), infrared, rockPercentile },
        (column, row) => {
          const at = mapPointToProjected(georeference, { x: minX + column * step, y: maxY - row * step });
          return [at.easting, at.northing];
        }, crs, found);
      if (result.data.features.length === 0) { setMessage({ tone: "error", text: text.nothing }); return; }
      importer.openData(text.name(tiles.length > 1 ? text.allName(tiles.length) : tiles[0]!.name), result.data, true);
      const hectares = (cells: number) => Math.round(cells * cellArea / 1000) / 10;
      setMessage({ tone: "ok", text: text.done(hectares(result.rockCells), hectares(result.openCells)) + (infrared ? "" : ` ${text.noInfrared}`) });
    } catch (error) {
      console.error("Flygbilden kunde inte tolkas", error);
      setMessage({ tone: "error", text: text.failed });
    }
  }

  return <details className={styles.settings} data-testid="map-project-photo">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {shown.length === 0 ? <p className={styles.muted}>{text.none}</p> : <>
      <label>{text.layer}<select value={chosenId === ALL ? ALL : single?.drawn.layerId ?? ""} onChange={event => setChosen(event.target.value)} data-testid="map-project-photo-layer">
        {allTiles.length > 1 && <option value={ALL}>{text.allTiles(allTiles.length)}</option>}
        {shown.map(row => <option key={row.drawn.layerId} value={row.drawn.layerId}>{row.name}</option>)}
      </select></label>
      <label>{text.rockShare(rockPercentile)}
        <input type="range" min={0} max={30} step={1} value={rockPercentile} onChange={event => setRockPercentile(Number(event.target.value))}
          data-testid="map-project-photo-rock" /></label>
      <small className={styles.muted}>{text.rockShareHelp}</small>
      <span className={styles.actions}><Button variant="secondary" disabled={busy} onClick={() => void interpret()} data-testid="map-project-photo-run">{busy ? text.loading : text.run}</Button></span>
    </>}
    {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? styles.problem : undefined}
      data-testid="map-project-photo-message">{message.text}</p>}
  </details>;
}
