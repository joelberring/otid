"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { controlMapResponseSchema, type ControlMapResponse } from "@o-tid/contracts";
import { forkingLetters } from "@o-tid/domain";
import { controlMapSv as text } from "../../i18n/control-map-sv";
import { forkingSv } from "../../i18n/forking-sv";
import { controlMapView, loadLevel, typicalSpacing } from "../../lib/control-map";
import { ForkingDiagram } from "../forking/forking-diagram";
import { Button, Notice } from "../ui";
import type { Workspace } from "../race-administrator/workspace-state";
import { adminDrawing } from "./control-map-drawing";
import { ControlMapSvg } from "./control-map-svg";
import styles from "./control-map.module.css";

/**
 * Steg 52 (ADR-0176): knappen "Kontrollkarta" i Banor och kartan i en egen dialog, så att den inte tar plats vid vanlig
 * genomgång. Belastning (alla kontroller efter planerade löpare eller stämplingar) eller en bana (variant) med linjer.
 */
export function ControlMapButton({ ws }: { ws: Workspace }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="secondary" aria-haspopup="dialog" aria-expanded={open} aria-label={text.openLabel} onClick={() => setOpen(true)}>{text.open}</Button>
    {open && <ControlMapDialog ws={ws} onClose={() => setOpen(false)} />}
  </>;
}

function ControlMapDialog({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const { beginRequest, request, json, finish, current } = ws;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [data, setData] = useState<ControlMapResponse>();
  const [image, setImage] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<"LOAD" | "COURSE">("LOAD");
  const [metric, setMetric] = useState<"planned" | "punched">("planned");
  const [courseId, setCourseId] = useState<string>("");
  const [variant, setVariant] = useState<string | null>(null);
  useEffect(() => { const element = dialog.current; if (element && !element.open) element.showModal(); }, []);
  async function load() {
    setFailed(false);
    const op = beginRequest();
    try {
      const response = await request("/control-map", op);
      if (!response.ok) throw new Error("Kontrollkartan kunde inte hämtas");
      const next = controlMapResponseSchema.parse(await json(response, op));
      let blob: Blob | undefined;
      if (next.map) {
        const imageResponse = await request("/map/image", op);
        if (imageResponse.ok) blob = await imageResponse.blob();
      }
      if (!current(op)) return;
      setImage(previous => { if (previous) URL.revokeObjectURL(previous); return blob ? URL.createObjectURL(blob) : undefined; });
      setData(next);
      setCourseId(id => id || next.courses[0]?.courseId || "");
      if (next.controls.some(control => control.punched > 0)) setMetric("punched");
    } catch { if (current(op)) setFailed(true); } finally { finish(op); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);
  const course = data?.courses.find(row => row.courseId === courseId);
  const view = useMemo(() => data ? controlMapView(data.bounds, data.map,
    typicalSpacing(data.controls.flatMap(control => control.position ? [control.position] : []))) : null, [data]);
  const drawing = useMemo(() => data && view ? adminDrawing(data, view, mode, metric, course, variant) : undefined,
    [data, view, mode, metric, course, variant]);
  const max = Math.max(0, ...(data?.controls ?? []).map(control => control[metric]));
  const missing = data ? data.controls.filter(control => !control.position).length : 0;
  const rows = useMemo(() => [...(data?.controls ?? [])].sort((left, right) => right[metric] - left[metric] || left.code - right.code),
    [data, metric]);
  const forked = course && course.variants.length > 1;
  const letters = useMemo(() => course?.forking ? forkingLetters({ items: course.forking.items }) : undefined, [course]);
  const choices = course?.forking && variant ? course.forking.variants.find(row => row.code === variant)?.choices : undefined;

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
    <div className={styles.panel}>
      <header className={styles.head}>
        <h2 id={titleId}>{text.title}</h2>
        <Button variant="quiet" onClick={() => dialog.current?.close()}>{text.close}</Button>
      </header>
      {failed && <Notice tone="error" role="alert"><p>{text.failed}</p><div><Button variant="secondary" onClick={() => void load()}>{text.retry}</Button></div></Notice>}
      {!data && !failed && <p role="status" className={styles.muted}>{text.loading}</p>}
      {data && <>
        <div className={styles.controls}>
          <div className={styles.segmented} role="group" aria-label={text.mode}>
            <button type="button" aria-pressed={mode === "LOAD"} onClick={() => setMode("LOAD")}>{text.modeLoad}</button>
            <button type="button" aria-pressed={mode === "COURSE"} disabled={data.courses.length === 0} onClick={() => setMode("COURSE")}>{text.modeCourse}</button>
          </div>
          {mode === "LOAD" && <label>{text.metric}<select value={metric} onChange={event => setMetric(event.target.value as "planned" | "punched")}>
            <option value="planned">{text.metricPlanned}</option><option value="punched">{text.metricPunched}</option></select></label>}
          {mode === "COURSE" && <label>{text.course}<select value={courseId} onChange={event => { setCourseId(event.target.value); setVariant(null); }}>
            {data.courses.map(row => <option key={row.courseId} value={row.courseId}>{row.name}{row.classNames.length > 0 ? ` (${row.classNames.join(", ")})` : ""}</option>)}
          </select></label>}
          {mode === "COURSE" && forked && <label>{text.variant}<select value={variant ?? ""} onChange={event => setVariant(event.target.value || null)}>
            <option value="">{text.allVariants}</option>
            {course.variants.map(row => <option key={row.code} value={row.code ?? ""}>{text.variantOption(row.code ?? "", row.entryCount)}</option>)}
          </select></label>}
        </div>
        <div className={styles.layout}>
          <div className={styles.runner}>
            {view && drawing ? <ControlMapSvg view={view} controls={drawing.controls} lines={drawing.lines} ends={drawing.ends}
              metersPerUnit={data.metersPerUnit} image={image && data.map ? { href: image, width: data.map.width, height: data.map.height } : undefined}
              label={mode === "COURSE" && course ? text.courseMapLabel(variant ? `${course.name} ${variant}` : course.name) : text.mapLabel} />
              : <Notice tone="info">{text.noPositions}</Notice>}
            {view && missing > 0 && <p className={styles.muted}>{text.missingPositions(missing)}</p>}
            {data.frame === "PAPER" && !data.metersPerUnit && <p className={styles.muted}>{text.paperNoScale}</p>}
            {data.mapFile === "MISMATCH" && <Notice tone="attention">{text.mapFileMismatch}</Notice>}
            {!data.map && <p className={styles.muted}>{text.noMapImage}</p>}
            {mode === "LOAD" && view && <p className={styles.muted}>{text.legend}</p>}
            {/* Utan lägen (eller som komplement): gafflingsbilden och kontrollerna i ordning. */}
            {mode === "COURSE" && course && (!view || course.forking) && <>
              {course.forking && letters && <ForkingDiagram items={course.forking.items} letters={letters} choices={choices}
                label={forkingSv.courseDiagram(course.name)} />}
              {(!view) && <div>{(variant ? course.variants.filter(row => row.code === variant) : course.variants).map(row =>
                <p key={row.code ?? "bana"} className={styles.codes}><strong>{row.code ? text.variantControls(row.code) : text.courseControls}:</strong>{" "}
                  {row.controlCodes.join(" ")}</p>)}</div>}
            </>}
          </div>
          <div className={styles.side}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <caption>{text.table.caption}</caption>
                <thead><tr><th scope="col">{text.table.code}</th><th scope="col">{text.table.courses}</th><th scope="col">{text.table.variants}</th>
                  <th scope="col">{text.table.planned}</th><th scope="col">{text.table.punched}</th><th scope="col">{text.table.level}</th></tr></thead>
                <tbody>{rows.map(control => <tr key={control.code} data-control={control.code}>
                  <th scope="row">{control.code}{control.outOfOrder ? ` (${text.outOfOrder})` : ""}</th>
                  <td>{control.courses}</td><td>{control.variants}</td><td>{control.planned}</td><td>{control.punched}</td>
                  <td>{text.levels[loadLevel(control[metric], max)]}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>
        </div>
      </>}
    </div>
  </dialog>;
}
