"use client";

import { mapPointToProjected, type MapGeoreference } from "@o-tid/map-file";
import { DEFAULT_FLAT_LEVEL, flatLimitsAt, flatSlopeFrom, slopeGridOf } from "@o-tid/map-revision/base-map";
import { useEffect, useRef, useState } from "react";
import { mapFlatContoursEn } from "../../i18n/map-knolls-en";
import { mapFlatContoursSv } from "../../i18n/map-knolls-sv";
import { bitmapPixels, layerAffine } from "../../lib/map-project-flat-contours";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

const number = (value: number) => value.toLocaleString("sv-SE");
const CONTOURS = /^(contour|depression|formline)$/i;

/**
 * Ägaren 2026-11-13 (Järflotta: «går det att ha en algoritm för att få bort bruset i helt flacka områden?»): reglaget «Lugna
 * kurvor på flack mark». Lutningen läses ur laserkörningens fuktdjup (underlaget som slutar på «fuktdjup», som «Fukt med
 * reglage»), och hjälpkurvor och små ringar på flack mark tas bort ur kandidaterna som visas (`calmFlatContours`), utan en
 * ny körning. Efter första «Visa som kandidater» räknas det om en kort stund efter att reglaget flyttats.
 */
export function MapProjectFlatPanel({ layers, georeference, importer }: { layers: ReturnType<typeof useMapProjectLayers>; georeference: MapGeoreference;
  importer: ReturnType<typeof useMapProjectImport> }) {
  const text = useTexts(mapFlatContoursSv, mapFlatContoursEn);
  const [chosen, setChosen] = useState("");
  // Grundkartan som just lästs in är redan lugnad med förvalet: reglaget börjar där den står.
  const [level, setLevel] = useState<number>();
  const [live, setLive] = useState(false);
  const [problem, setProblem] = useState<string>();
  const slope = useRef<{ layerId: string; crs: number; at: (x: number, y: number) => number | undefined } | undefined>(undefined);
  const shown = layers.loaded.map(drawn => ({ drawn, name: layers.layers.find(row => row.layerId === drawn.layerId)?.name ?? drawn.layerId }))
    .filter(row => /fuktdjup$/.test(row.name));
  const current = shown.find(row => row.drawn.layerId === chosen) ?? shown[0];
  const mapCrs = georeference.crs.kind === "EPSG" ? georeference.crs.code : undefined;
  const crs = importer.crs, calm = importer.calm;
  // En grundkarta som lästs in sedan reglaget senast användes står på sin egen nivå, inte på reglagets gamla.
  const mine = useRef(calm);
  const value = calm && calm !== mine.current ? calm.level : level ?? calm?.level ?? DEFAULT_FLAT_LEVEL;
  const hasContours = !!calm || importer.layers.some(layer => CONTOURS.test(layer.name));

  const ran = useRef<number | undefined>(undefined);
  function run(next: number) {
    ran.current = next;
    if (!current || mapCrs === undefined || crs === undefined) return;
    setProblem(undefined);
    try {
      const { image, toMap } = current.drawn;
      if (slope.current?.layerId !== current.drawn.layerId || slope.current.crs !== crs) {
        const pixels = bitmapPixels(image);
        if (!pixels) { setProblem(text.failed); return; }
        const affine = layerAffine((column, row) => {
          const at = mapPointToProjected(georeference, { x: toMap.a * column + toMap.b * row + toMap.c, y: toMap.d * column + toMap.e * row + toMap.f });
          return [at.easting, at.northing];
        }, image.width, image.height, mapCrs, crs);
        slope.current = { layerId: current.drawn.layerId, crs, at: flatSlopeFrom(slopeGridOf(pixels), affine) };
      }
      mine.current = importer.calmContours(next, slope.current.at);
    } catch (error) {
      console.error("Fuktdjupet kunde inte läsas", error);
      setProblem(text.failed);
    }
  }
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!live || ran.current === value) return;
    const timer = setTimeout(() => latest.current(value), 250);
    return () => clearTimeout(timer);
  }, [live, value]);

  if (!importer.canImport || mapCrs === undefined) return null;
  const limits = flatLimitsAt(value);
  return <details className={styles.settings} data-testid="map-project-flat">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {!current ? <p className={styles.muted}>{text.none}</p> : !hasContours ? <p className={styles.muted}>{text.noContours}</p> : <>
      <label>{text.layer}<select value={current.drawn.layerId} onChange={event => { setChosen(event.target.value); setLive(false); }}>
        {shown.map(row => <option key={row.drawn.layerId} value={row.drawn.layerId}>{row.name}</option>)}
      </select></label>
      <label>{text.level(value, number(limits?.slopeDegrees ?? 0), number(limits?.ringM2 ?? 0))}
        <input type="range" min={0} max={10} step={1} value={value} data-testid="map-project-flat-level" onChange={event => { mine.current = calm; setLevel(Number(event.target.value)); }} /></label>
      <p className={styles.muted}>{text.levelHelp}</p>
      <span className={styles.actions}><Button variant="secondary" onClick={() => { setLive(true); run(value); }} data-testid="map-project-flat-run">{text.run}</Button></span>
    </>}
    {problem ? <p role="alert" className={styles.problem} data-testid="map-project-flat-message">{problem}</p>
      : calm && hasContours && <p role="status" data-testid="map-project-flat-message">
        {calm.formlineMeters + calm.rings > 0 ? text.done(number(calm.formlineMeters), calm.rings) : text.untouched}</p>}
  </details>;
}
