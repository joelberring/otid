"use client";

import { mapPointToProjected, type MapGeoreference } from "@o-tid/map-file";
import { useState } from "react";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { interpretPhoto } from "../../lib/map-project-photo-interpret";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

/** Bilden skalas så att en bildpunkt blir ungefär så många meter, och ritytan blir högst så stor. */
const METERS_PER_PIXEL = 1, MAX_SIDE = 4096, CELL_METERS = 2, MIN_AREA_M2 = 150;

/**
 * Grundkartan G8c (ägaren 2026-11-10: «flygbildstolkning för öppna ytor och berg i dagen»): ett underlag som är ett ortofoto
 * tolkas i webbläsaren (`lib/map-project-photo-interpret.ts`) och ytorna blir kandidater i importen. Bilden lämnar aldrig
 * webbläsaren.
 */
export function MapProjectPhotoPanel({ layers, georeference, importer }: { layers: ReturnType<typeof useMapProjectLayers>; georeference: MapGeoreference;
  importer: ReturnType<typeof useMapProjectImport> }) {
  const text = useTexts(mapSourcesSv.photo, mapSourcesEn.photo);
  const [chosen, setChosen] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const shown = layers.drawn.map(drawn => ({ drawn, name: layers.layers.find(row => row.layerId === drawn.layerId)?.name ?? drawn.layerId }));
  if (!importer.canImport || georeference.crs.kind !== "EPSG") return null;
  const crs = georeference.crs.code;
  const current = shown.find(row => row.drawn.layerId === chosen) ?? shown[0];

  function interpret() {
    if (!current) return;
    setMessage(undefined);
    try {
      const { image, toMap } = current.drawn;
      // Bildpunktens storlek i terrängen, och skalningen till ritytan.
      const meters = Math.hypot(toMap.a, toMap.d) * georeference.scale / 1000;
      const factor = Math.min(1, meters / METERS_PER_PIXEL, MAX_SIDE / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * factor)), height = Math.max(1, Math.round(image.height * factor));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) { setMessage({ tone: "error", text: text.failed }); return; }
      context.drawImage(image, 0, 0, width, height);
      const cellMeters = meters / factor, cellPixels = Math.max(1, Math.round(CELL_METERS / cellMeters));
      const cellArea = (cellPixels * cellMeters) ** 2;
      const result = interpretPhoto(context.getImageData(0, 0, width, height), { cellPixels, minCells: Math.max(4, Math.round(MIN_AREA_M2 / cellArea)) },
        (column, row) => {
          const x = column / factor, y = row / factor;
          const at = mapPointToProjected(georeference, { x: toMap.a * x + toMap.b * y + toMap.c, y: toMap.d * x + toMap.e * y + toMap.f });
          return [at.easting, at.northing];
        }, crs);
      if (result.data.features.length === 0) { setMessage({ tone: "error", text: text.nothing }); return; }
      importer.openData(text.name(current.name), result.data);
      const hectares = (cells: number) => Math.round(cells * cellArea / 1000) / 10;
      setMessage({ tone: "ok", text: text.done(hectares(result.rockCells), hectares(result.openCells)) });
    } catch (error) {
      console.error("Flygbilden kunde inte tolkas", error);
      setMessage({ tone: "error", text: text.failed });
    }
  }

  return <details className={styles.settings} data-testid="map-project-photo">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {shown.length === 0 ? <p className={styles.muted}>{text.none}</p> : <>
      <label>{text.layer}<select value={current?.drawn.layerId ?? ""} onChange={event => setChosen(event.target.value)} data-testid="map-project-photo-layer">
        {shown.map(row => <option key={row.drawn.layerId} value={row.drawn.layerId}>{row.name}</option>)}
      </select></label>
      <span className={styles.actions}><Button variant="secondary" onClick={interpret} data-testid="map-project-photo-run">{text.run}</Button></span>
    </>}
    {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? styles.problem : undefined}
      data-testid="map-project-photo-message">{message.text}</p>}
  </details>;
}
