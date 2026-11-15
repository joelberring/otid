"use client";

import { useState, type ReactNode } from "react";
import { BINGO_CELL_SIZES, BINGO_LIMITS, COURSE_PRINT_SCALES, type CourseSettingDocument, type CourseSettingEdit, type MapRect } from "@o-tid/course-setting";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { addBingoGroupEdits, bingoGroups, setBingoCellEdits } from "../../lib/bingo-setup";
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
export function BingoBlock({ document, view, readOnly, tool, onTool, pendingArea, onEdits, onView, phone }: {
  document: CourseSettingDocument; view: string; readOnly: boolean; tool: TrainingTool | undefined; onTool: (tool: TrainingTool | undefined) => void;
  pendingArea: MapRect | undefined; onEdits: Edits; onView: (course: string) => void; phone?: ReactNode;
}) {
  const text = useTexts(bingoSv.setup, bingoEn.setup);
  const groups = bingoGroups(document);
  const area = groups[0]?.bingo.area ?? pendingArea;
  const metersPerMm = document.event.mapScale / 1000;
  const [cell, setCell] = useState<number>(BINGO_CELL_SIZES[0]);
  const [name, setName] = useState("");
  const [scale, setScale] = useState<number | undefined>(undefined);
  const drawing = tool?.kind === "BINGO";
  const scales = [...new Set([document.event.mapScale, ...COURSE_PRINT_SCALES.filter(value => value >= 4000 && value <= 15000)])].sort((a, b) => a - b);
  const add = () => {
    if (!area) return;
    const { edits, courseId } = addBingoGroupEdits(document, name.trim() || text.suggestedName(cell), cell, area,
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
        <span className={styles.muted}>{text.cells(group.cells)} · {scaleText(group.printScale ?? document.event.mapScale)}</span>
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
          {group.course !== view && <Button variant="secondary" onClick={() => onView(group.course)}>{text.open}</Button>}
          {!readOnly && <Button variant="quiet" onClick={() => onEdits([{ type: "DELETE_COURSE", course: group.course }])}>{text.remove}</Button>}
        </div>
      </li>)}
    </ul>}
    {!readOnly && <div className={styles.item}>
      <div className={styles.row}>
        <label className={styles.stack}>{text.name}<input type="text" maxLength={60} value={name} placeholder={text.suggestedName(cell)}
          onChange={event => setName(event.target.value)} data-testid="bingo-name" /></label>
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
