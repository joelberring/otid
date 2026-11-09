"use client";

import { useRef, useState, type ReactNode } from "react";
import { mapProjectLayersSv } from "../../i18n/map-project-layers-sv";
import { Button } from "../ui";
import type { Bounds } from "../../lib/course-setting-viewport";
import { residualMeters } from "../../lib/map-project-control-points";
import type { LayerProblem, useMapProjectLayers } from "./use-map-project-layers";
import type { useMapProjectControlPoints } from "./use-map-project-control-points";
import styles from "./map-project-editor.module.css";

const text = mapProjectLayersSv;
type Layers = ReturnType<typeof useMapProjectLayers>;
type Control = ReturnType<typeof useMapProjectControlPoints>;
const meters = (value: number) => value.toLocaleString("sv-SE", { maximumFractionDigits: value < 10 ? 1 : 0 });
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB`;

function problemText(problem: LayerProblem): string {
  if (typeof problem === "number") return text.problems.generic(problem);
  return problem === "quota" ? text.problems.quota : text.problems[problem];
}

/**
 * ADR-0219 tillägget om underlagen (K4a): underlagen i sidopanelen. Varje underlag kan döljas (för en själv) och göras mer eller
 * mindre genomskinligt (för alla) och tas bort av den som lade till det och ägarna; ägarna ändrar ordningen. Nya läggs till med bild och kanske världsfil.
 */
export function MapProjectLayersPanel({ layers, mapEpsg, after, control, scale, area }: { layers: Layers; mapEpsg: number | undefined;
  /** K4b: importen av vektorer, under underlagen. */
  after?: ReactNode;
  /** K6b: passpunkterna, kartans skala (för avvikelserna i meter) och området där en bild utan georeferens läggs. */
  control: Control; scale: number; area: Bounds | undefined }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [crs, setCrs] = useState(mapEpsg ? String(mapEpsg) : "");
  // Formuläret stängs när underlaget är upplagt (lite plats i telefonen).
  const [adding, setAdding] = useState(false);
  const problem = layers.problem;

  return <section className={styles.panel} aria-labelledby="map-project-layers" data-testid="map-project-layers">
    <h2 id="map-project-layers">{text.heading}</h2>
    {layers.layers.length === 0 ? <p className={styles.muted}>{text.none}</p> : <ul className={styles.rows}>
      {layers.layers.map((layer, index) => <li key={layer.layerId} className={styles.layerRow} data-testid="map-project-layer">
        <label className={styles.check}><input type="checkbox" checked={!layers.hidden.has(layer.layerId)} aria-label={text.show(layer.name)}
          onChange={() => layers.toggle(layer.layerId)} />{layer.name}</label>
        <span className={styles.muted}>{text.by(layer.own ? null : layer.createdBy.name, megabytes(layer.byteLength))}</span>
        <input type="range" min={0.1} max={1} step={0.05} value={layer.opacity} aria-label={text.opacity(layer.name)} data-testid="map-project-layer-opacity"
          disabled={!layers.canManage(layer)}
          onChange={event => void layers.setOpacity(layer.layerId, Number(event.target.value), false)}
          onPointerUp={event => void layers.setOpacity(layer.layerId, Number(event.currentTarget.value), true)}
          onKeyUp={event => void layers.setOpacity(layer.layerId, Number(event.currentTarget.value), true)} />
        <span className={styles.actions}>
          {layers.canReorder && layers.layers.length > 1 && <>
            <Button variant="quiet" disabled={index === 0} aria-label={text.up(layer.name)} onClick={() => void layers.move(layer.layerId, true)}>↑</Button>
            <Button variant="quiet" disabled={index === layers.layers.length - 1} aria-label={text.down(layer.name)}
              onClick={() => void layers.move(layer.layerId, false)}>↓</Button>
          </>}
          {layers.canManage(layer) && mapEpsg !== undefined && control.layerId !== layer.layerId && <Button variant="quiet"
            aria-label={text.control.startFor(layer.name)} data-testid="map-project-layer-control" onClick={() => control.start(layer.layerId)}>
            {text.control.start}</Button>}
          {layers.canManage(layer) && <Button variant="quiet" onClick={() => { if (window.confirm(text.removeConfirm)) void layers.remove(layer.layerId); }}>
            {text.remove}</Button>}
        </span>
        {control.layerId === layer.layerId && <ControlPoints control={control} name={layer.name} scale={scale} />}
      </li>)}
    </ul>}
    {problem !== undefined && <p role="alert" className={styles.problem}>{problemText(problem)}{" "}
      <Button variant="quiet" onClick={() => layers.setProblem(undefined)}>OK</Button></p>}
    {layers.canAdd && <details className={styles.settings} open={adding} onToggle={event => setAdding(event.currentTarget.open)}>
      <summary>{text.upload}</summary>
      <p className={styles.muted}>{text.help}</p>
      <form className={styles.areaForm} onSubmit={event => {
        event.preventDefault();
        const code = Number(crs);
        void layers.upload(files, name, Number.isInteger(code) && code > 0 ? code : undefined, area).then(ok => { if (ok) { setFiles([]); setName(""); setAdding(false); } });
      }}>
        <span className={styles.actions}>
          <Button variant="secondary" onClick={() => input.current?.click()}>{text.choose}</Button>
          <input ref={input} type="file" multiple hidden data-testid="map-project-layer-file"
            accept=".tif,.tiff,.png,.jpg,.jpeg,.pgw,.pngw,.jgw,.jpgw,.tfw,.tifw,.wld,image/png,image/jpeg,image/tiff"
            onChange={event => { setFiles([...event.target.files ?? []]); event.target.value = ""; }} />
        </span>
        {files.length > 0 && <p className={styles.muted}>{text.chosen(files.map(file => file.name).join(", "))}</p>}
        <label>{text.name}<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
        <label>{text.crs}<input inputMode="numeric" value={crs} onChange={event => setCrs(event.target.value.replace(/\D/g, ""))} /></label>
        <p className={styles.muted}>{text.crsHelp}</p>
        <span className={styles.actions}>
          <Button type="submit" disabled={files.length === 0 || !!layers.busy} data-testid="map-project-layer-upload">
            {layers.busy === "preparing" ? text.preparing : layers.busy === "uploading" ? text.uploading : text.upload}</Button>
        </span>
      </form>
    </details>}
    {after}
  </section>;
}

/** K6b: passpunkterna för ett underlag med avvikelserna, valet likformig och knapparna. */
function ControlPoints({ control, name, scale }: { control: Control; name: string; scale: number }) {
  const t = text.control;
  const fit = control.fit;
  return <div className={styles.controlPoints} data-testid="map-project-control-points">
    <p><strong>{t.heading(name)}</strong></p>
    <p className={styles.muted}>{t.help}</p>
    <p aria-live="polite" data-testid="map-project-control-hint">{control.pending ? t.hintMap : t.hintImage}</p>
    {control.points.length === 0 ? <p className={styles.muted}>{t.none}</p> : <ol className={styles.rows} data-testid="map-project-control-list">
      {control.points.map((_, index) => <li key={index}>
        {t.point(index + 1, fit?.residuals[index] !== undefined ? meters(residualMeters(fit.residuals[index], scale)) : "–")}{" "}
        <Button variant="quiet" aria-label={t.removePoint(index + 1)} onClick={() => control.remove(index)}>×</Button>
      </li>)}
    </ol>}
    {fit && <p data-testid="map-project-control-fit">{t.fit(fit.kind, meters(residualMeters(fit.rms, scale)))}</p>}
    {control.points.length >= 3 && <label className={styles.check}><input type="checkbox" checked={control.similarity}
      onChange={event => control.setSimilarity(event.target.checked)} />{t.similarity}</label>}
    <span className={styles.actions}>
      <Button disabled={!fit || control.saving} onClick={() => void control.save()} data-testid="map-project-control-save">
        {control.saving ? t.saving : t.save}</Button>
      <Button variant="secondary" disabled={!control.pending && control.points.length === 0} onClick={control.undo}>{t.undo}</Button>
      <Button variant="secondary" onClick={control.cancel}>{t.cancel}</Button>
    </span>
  </div>;
}
