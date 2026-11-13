"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { mapProjectLayersEn } from "../../i18n/map-project-en";
import { useTexts, useLocale } from "../language-provider";
import type { Texts } from "../../lib/language";
import { mapProjectLayersSv } from "../../i18n/map-project-layers-sv";
import { Button } from "../ui";
import type { Bounds } from "../../lib/course-setting-viewport";
import { residualMeters } from "../../lib/map-project-control-points";
import { groupLayers } from "../../lib/map-project-layer-groups";
import type { LayerProblem, useMapProjectLayers } from "./use-map-project-layers";
import type { useMapProjectControlPoints } from "./use-map-project-control-points";
import styles from "./map-project-editor.module.css";

type Layers = ReturnType<typeof useMapProjectLayers>;
type Control = ReturnType<typeof useMapProjectControlPoints>;
const meters = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 });
const megabytes = (bytes: number, locale: string) => `${(bytes / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;

function problemText(problem: LayerProblem, text: Texts<typeof mapProjectLayersSv>): string {
  if (typeof problem === "number") return text.problems.generic(problem);
  return problem === "quota" ? text.problems.quota : text.problems[problem];
}

/**
 * ADR-0219 tillägget om underlagen (K4a): underlagen i sidopanelen. Varje underlag kan döljas (för en själv) och göras mer eller
 * mindre genomskinligt (för alla) och tas bort av den som lade till det och ägarna; ägarna ändrar ordningen. Nya läggs till med bild och kanske världsfil.
 */
export function MapProjectLayersPanel({ layers, mapEpsg, before, after, control, scale, area }: { layers: Layers; mapEpsg: number | undefined;
  /** Guiden «Ny grundkarta», överst under rubriken. */
  before?: ReactNode;
  /** K4b: importen av vektorer, under underlagen. */
  after?: ReactNode;
  /** K6b: passpunkterna, kartans skala (för avvikelserna i meter) och området där en bild utan georeferens läggs. */
  control: Control; scale: number; area: Bounds | undefined }) {
  const text = useTexts(mapProjectLayersSv, mapProjectLayersEn);
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [crs, setCrs] = useState(mapEpsg ? String(mapEpsg) : "");
  // Formuläret stängs när underlaget är upplagt (lite plats i telefonen).
  const [adding, setAdding] = useState(false);
  const problem = layers.problem;
  // Ägaren 2026-11-13: samma bild ur en körning i etapper blir en rad; listan kan fällas ihop och allt släckas på en gång.
  const [collapsed, setCollapsed] = useState(false);
  const groups = groupLayers(layers.layers);
  const allHidden = layers.layers.every(layer => layers.hidden.has(layer.layerId));

  return <section className={styles.panel} aria-labelledby="map-project-layers" data-testid="map-project-layers">
    <h2 id="map-project-layers">{text.heading}</h2>
    {before}
    {layers.layers.length === 0 ? <p className={styles.muted}>{text.none}</p> : <>
      <span className={styles.actions}>
        <Button variant="quiet" data-testid="map-project-layers-all" onClick={() => layers.setShown(layers.layers.map(layer => layer.layerId), allHidden)}>
          {allHidden ? text.showAll : text.hideAll}</Button>
        <Button variant="quiet" aria-expanded={!collapsed} data-testid="map-project-layers-collapse" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? text.expand(layers.layers.length) : text.collapse}</Button>
      </span>
      {!collapsed && <ul className={styles.rows}>
        {groups.map(group => group.members.length === 1
          ? <LayerRow key={group.members[0]!.layerId} layer={group.members[0]!} layers={layers} control={control} mapEpsg={mapEpsg} scale={scale} />
          : <GroupRow key={group.name} name={group.name} members={group.members} layers={layers} control={control} mapEpsg={mapEpsg} scale={scale} />)}
      </ul>}
    </>}
    {problem !== undefined && <p role="alert" className={styles.problem}>{problemText(problem, text)}{" "}
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

type Layer = Layers["layers"][number];
interface RowProps { layers: Layers; control: Control; mapEpsg: number | undefined; scale: number }

/** Ett underlag: visa, genomskinlighet, ordning, passpunkter och ta bort. */
function LayerRow({ layer, layers, control, mapEpsg, scale }: RowProps & { layer: Layer }) {
  const locale = useLocale();
  const text = useTexts(mapProjectLayersSv, mapProjectLayersEn);
  const index = layers.layers.indexOf(layer);
  return <li className={styles.layerRow} data-testid="map-project-layer">
    <label className={styles.check}><input type="checkbox" checked={!layers.hidden.has(layer.layerId)} aria-label={text.show(layer.name)}
      onChange={() => layers.toggle(layer.layerId)} />{layer.name}</label>
    <span className={styles.muted}>{text.by(layer.own ? null : layer.createdBy.name, megabytes(layer.byteLength, locale))}</span>
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
  </li>;
}

/** Samma bild ur alla etapper: en ruta och ett reglage för alla, och etapperna var för sig när raden fälls ut. */
function GroupRow({ name, members, layers, control, mapEpsg, scale }: RowProps & { name: string; members: readonly Layer[] }) {
  const locale = useLocale();
  const text = useTexts(mapProjectLayersSv, mapProjectLayersEn);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const shown = members.filter(layer => !layers.hidden.has(layer.layerId)).length;
  useEffect(() => { if (box.current) box.current.indeterminate = shown > 0 && shown < members.length; }, [shown, members.length]);
  const ids = members.map(layer => layer.layerId), manage = members.every(layer => layers.canManage(layer));
  const opacity = members[0]!.opacity, bytes = members.reduce((sum, layer) => sum + layer.byteLength, 0);
  const setAll = (value: number, save: boolean) => { for (const id of ids) void layers.setOpacity(id, value, save); };
  return <li className={styles.layerRow} data-testid="map-project-layer-group">
    <label className={styles.check}><input ref={box} type="checkbox" checked={shown === members.length} aria-label={text.show(name)}
      onChange={() => layers.setShown(ids, shown < members.length)} />{name}</label>
    <span className={styles.muted}>{text.stages(members.length)} · {megabytes(bytes, locale)}</span>
    <input type="range" min={0.1} max={1} step={0.05} value={opacity} aria-label={text.opacity(name)} disabled={!manage}
      onChange={event => setAll(Number(event.target.value), false)}
      onPointerUp={event => setAll(Number(event.currentTarget.value), true)}
      onKeyUp={event => setAll(Number(event.currentTarget.value), true)} />
    <span className={styles.actions}>
      <Button variant="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? text.hideStages : text.showStages}</Button>
    </span>
    {open && <ul className={styles.rows}>
      {members.map(layer => <LayerRow key={layer.layerId} layer={layer} layers={layers} control={control} mapEpsg={mapEpsg} scale={scale} />)}
    </ul>}
  </li>;
}

/** K6b: passpunkterna för ett underlag med avvikelserna, valet likformig och knapparna. */
function ControlPoints({ control, name, scale }: { control: Control; name: string; scale: number }) {
  const text = useTexts(mapProjectLayersSv, mapProjectLayersEn);
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
