"use client";

import { useEffect, useState, type ReactNode } from "react";
import { bingoAdminViewSchema } from "@o-tid/contracts";
import { courseSettingBase } from "../../lib/course-setting-api";
import { BINGO_CELL_SIZES, BINGO_LIMITS, COURSE_PRINT_SCALES, type CourseSettingDocument, type CourseSettingEdit, type MapRect } from "@o-tid/course-setting";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { shipSplitFor } from "@o-tid/domain";
import {
  addBingoGroupEdits, BINGO_GROUP_NAMES, rerollSharedEdits, bingoGroups, parseShips, setBingoCellEdits, setGroupAreaEdits, setShipsEdits, suggestedGroupName,
  trainingBingoArea
} from "../../lib/bingo-setup";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { TrainingTool } from "./use-course-setting-training";
import styles from "./course-setting-training.module.css";

type Edits = (edits: readonly CourseSettingEdit[]) => void;
const scaleText = (scale: number) => `1:${scale.toLocaleString("sv-SE")}`;

/**
 * Bingoorientering (ägaren 2026-11-15): området (två hörn på kartan), grupperna med namn och rutstorlek, och vägen till
 * utskriften. En grupp är en bana utan kontroller; rutnätet ritas i banpåtrycket. `phone` är delen om telefonen (anmälan på
 * plats och GPS), som bara finns i en tävling.
 */
/** Ledarens verktyg (admin): visa gruppens gemensamma skepp på kartan och slumpa om dem innan någon har startat. */
export interface BingoLeaderTools { readonly raceId: string; readonly shown: string | undefined; readonly onShow: (course: string | undefined) => void }

/** Grupperna där någon har startat (ur ledarens vy); undefined medan den hämtas eller om den inte går att läsa. */
function useStartedGroups(raceId: string | undefined): ReadonlySet<string> | undefined {
  const [started, setStarted] = useState<ReadonlySet<string>>();
  useEffect(() => {
    if (!raceId) return;
    let stopped = false;
    void fetch(`${courseSettingBase(raceId)}/bingo`, { credentials: "same-origin", cache: "no-store" })
      .then(async response => { if (response.ok && !stopped) setStarted(new Set(bingoAdminViewSchema.parse(await response.json()).runners.map(row => row.course))); })
      .catch((error: unknown) => console.warn("Bingons löpare kunde inte hämtas", error));
    return () => { stopped = true; };
  }, [raceId]);
  return started;
}

export function BingoBlock({ document, view, readOnly, tool, onTool, pendingArea, onEdits, onView, phone, leader }: {
  document: CourseSettingDocument; view: string; readOnly: boolean; tool: TrainingTool | undefined; onTool: (tool: TrainingTool | undefined) => void;
  pendingArea: MapRect | undefined; onEdits: Edits; onView: (course: string) => void; phone?: ReactNode; leader?: BingoLeaderTools | undefined;
}) {
  const ships = useTexts(bingoSv.ships, bingoEn.ships);
  const started = useStartedGroups(leader?.raceId);
  const text = useTexts(bingoSv.setup, bingoEn.setup);
  const groups = bingoGroups(document);
  const area = trainingBingoArea(document, pendingArea);
  const suggested = suggestedGroupName(document);
  const metersPerMm = document.event.mapScale / 1000;
  const [cell, setCell] = useState<number>(BINGO_CELL_SIZES[0]);
  const [name, setName] = useState("");
  const [scale, setScale] = useState<number | undefined>(undefined);
  const drawing = tool?.kind === "BINGO";
  const [shipsProblem, setShipsProblem] = useState<string>();
  const scales = [...new Set([document.event.mapScale, ...COURSE_PRINT_SCALES.filter(value => value >= 4000 && value <= 15000)])].sort((a, b) => a - b);
  const add = () => {
    if (!area) return;
    const { edits, courseId } = addBingoGroupEdits(document, name.trim() || suggested || text.suggestedName(cell), cell, area,
      scale === document.event.mapScale ? undefined : scale);
    onEdits(edits);
    setName("");
    onView(courseId);
  };
  return <section className={styles.block} aria-labelledby="training-bingo" data-testid="training-bingo">
    <h3 id="training-bingo">{text.heading}</h3>
    <p className={styles.muted}>{text.help}</p>
    <h4 className={styles.muted}>{text.area}</h4>
    <p className={styles.muted} data-testid="bingo-area">{area
      ? text.areaSize(Math.round((area.maxX - area.minX) * metersPerMm), Math.round((area.maxY - area.minY) * metersPerMm)) : text.noArea}</p>
    {!readOnly && !drawing && <div className={styles.row}>
      <Button variant={area ? "secondary" : "primary"} onClick={() => onTool({ kind: "BINGO", points: [] })} data-testid="bingo-draw">
        {area ? text.redraw : text.draw}</Button>
    </div>}
    <h4 className={styles.muted}>{text.groups}</h4>
    {groups.length === 0 ? <p className={styles.muted}>{text.noGroups}</p> : <ul className={styles.bingoList}>
      {groups.map(group => <li key={group.course} className={styles.item} data-testid="bingo-group" data-selected={group.course === view || undefined}>
        <strong>{group.name}</strong>
        <span className={styles.muted}>{text.cells(group.cells)} · {scaleText(group.printScale ?? document.event.mapScale)}
          {group.bingo.ownArea && <> · {text.ownArea}</>}</span>
        {group.cells === 0 && <span className={styles.muted} role="alert">{text.tooMany}</span>}
        <div className={styles.row}>
          <label className={styles.stack}>{text.cell}<input type="number" min={BINGO_LIMITS.minCellMeters} max={BINGO_LIMITS.maxCellMeters} step={10}
            disabled={readOnly} defaultValue={group.bingo.cellMeters} key={group.bingo.cellMeters}
            onBlur={event => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= BINGO_LIMITS.minCellMeters && value <= BINGO_LIMITS.maxCellMeters && value !== group.bingo.cellMeters)
                onEdits(setBingoCellEdits(document, group, Math.round(value)));
            }} /></label>
          <label className={styles.stack}>{text.scale}<select value={group.printScale ?? document.event.mapScale} disabled={readOnly}
            onChange={event => onEdits([{ type: "UPDATE_COURSE", course: group.course, changes: {
              printScale: Number(event.target.value) === document.event.mapScale ? null : Number(event.target.value) } }])}>
            {[...new Set([...scales, group.printScale ?? document.event.mapScale])].sort((a, b) => a - b).map(value => <option key={value} value={value}>
              {value === document.event.mapScale ? text.mapScale(scaleText(value)) : scaleText(value)}</option>)}</select></label>
        </div>
        <div className={styles.row}>
          {(["shared", "own"] as const).map(kind => {
            const current = kind === "shared" ? group.bingo.sharedShips : group.bingo.ships;
            const fallback = shipSplitFor(group.cells, group.bingo.sharedShips, group.bingo.ships)[kind];
            return <label key={kind} className={styles.stack}>{kind === "shared" ? text.sharedShips : text.ownShips}
              <input type="text" inputMode="numeric" disabled={readOnly} key={(current ?? []).join(",")} defaultValue={(current ?? []).join(", ")}
                placeholder={fallback.join(", ") || "–"} data-testid={`bingo-ships-${kind}`}
                onBlur={event => {
                  const ships = parseShips(event.target.value);
                  if (ships === undefined) { setShipsProblem(group.course); return; }
                  setShipsProblem(undefined);
                  if ((ships ?? []).join(",") !== (current ?? []).join(",")) onEdits(setShipsEdits(document, group, kind, ships));
                }} /></label>;
          })}
        </div>
        <span className={styles.muted} role={shipsProblem === group.course ? "alert" : undefined}>
          {shipsProblem === group.course ? text.shipsInvalid : text.shipsHelp}</span>
        <div className={styles.row}>
          {group.course !== view && <Button variant="secondary" onClick={() => onView(group.course)}>{text.open}</Button>}
          {leader && <Button variant="secondary" aria-pressed={leader.shown === group.course} data-testid="bingo-show-ships"
            onClick={() => { leader.onShow(leader.shown === group.course ? undefined : group.course); if (group.course !== view) onView(group.course); }}>
            {leader.shown === group.course ? ships.hideShips : ships.showShips}</Button>}
          {leader && !readOnly && <Button variant="quiet" disabled={!started || started.has(group.course)}
            title={started?.has(group.course) ? ships.rerollStarted : undefined}
            onClick={() => onEdits(rerollSharedEdits(document, group, globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!))}>{ships.reroll}</Button>}
          {!readOnly && !drawing && <Button variant="secondary" onClick={() => onTool({ kind: "BINGO", points: [], course: group.course })}>
            {text.drawOwn}</Button>}
          {!readOnly && group.bingo.ownArea && <Button variant="quiet" onClick={() => onEdits(setGroupAreaEdits(document, group,
            pendingArea ?? groups.find(row => !row.bingo.ownArea)?.bingo.area ?? group.bingo.area, false))}>
            {text.useTrainingArea}</Button>}
          {!readOnly && <Button variant="quiet" onClick={() => onEdits([{ type: "DELETE_COURSE", course: group.course }])}>{text.remove}</Button>}
        </div>
      </li>)}
    </ul>}
    {!readOnly && <div className={styles.item}>
      <div className={styles.row}>
        <label className={styles.stack}>{text.name}<input type="text" maxLength={60} value={name} placeholder={suggested ?? text.suggestedName(cell)}
          list="bingo-group-names" onChange={event => setName(event.target.value)} data-testid="bingo-name" /></label>
        <datalist id="bingo-group-names">{BINGO_GROUP_NAMES.map(item => <option key={item} value={item} />)}</datalist>
        <label className={styles.stack}>{text.cell}<select value={cell} onChange={event => setCell(Number(event.target.value))} data-testid="bingo-cell">
          {BINGO_CELL_SIZES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className={styles.stack}>{text.scale}<select value={scale ?? document.event.mapScale} onChange={event => setScale(Number(event.target.value))}>
          {scales.map(value => <option key={value} value={value}>{value === document.event.mapScale ? text.mapScale(scaleText(value)) : scaleText(value)}</option>)}
        </select></label>
      </div>
      <Button onClick={add} disabled={!area} data-testid="bingo-add">{text.add}</Button>
    </div>}
    {groups.length > 0 && <p className={styles.muted}>{text.print}</p>}
    {phone}
  </section>;
}
