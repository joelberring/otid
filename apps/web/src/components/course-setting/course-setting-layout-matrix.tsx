"use client";

import type { LayoutEntry } from "@o-tid/course-setting";
import { layoutEn } from "../../i18n/course-setting-layout-en";
import { useTexts } from "../language-provider";
import { layoutSv } from "../../i18n/course-setting-layout-sv";
import { scaleText, type MatrixCell, type MatrixRow } from "../../lib/course-setting-layouts";
import styles from "./course-setting-layout.module.css";

/**
 * ADR-0217 beslut 5: överblicken, banor × layouter. En ruta är ett ark med klasserna, antalet kartor (anmälda + reserver) och
 * status; en tom ruta har "+ Lägg till ark" (provtryck). På telefonen en lista per bana i stället för tabellen.
 */
export function LayoutMatrix({ columns, rows, open, readOnly, onOpen, onAdd }: {
  columns: readonly LayoutEntry[]; rows: readonly MatrixRow[]; open: { course: string; layout: string } | undefined; readOnly: boolean;
  onOpen: (course: string, layout: string) => void; onAdd: (course: string, layout: string) => void;
}) {
  const text = useTexts(layoutSv, layoutEn);
  const nameOf = (id: string) => columns.find(column => column.id === id)?.name ?? id;
  const cell = (row: MatrixRow, item: MatrixCell, list = false) => item.exists
    ? <button type="button" className={styles.cell} aria-pressed={open?.course === row.course && open.layout === item.layout}
      aria-label={text.overview.open(row.name, nameOf(item.layout))} onClick={() => onOpen(row.course, item.layout)}
      data-testid={list ? "layout-cell-list" : "layout-cell"} data-course={row.course} data-layout={item.layout} data-status={item.status ?? ""}>
      <span className={styles.cellClasses}>{item.classes.length > 0 ? item.classes.join(", ") : text.overview.noClasses}</span>
      {item.classes.length > 0 && <span>{text.overview.maps(item.entered, item.reserves)}</span>}
      <span className={styles.muted}>{[item.scale ? scaleText(item.scale) : "", item.paper ?? ""].filter(Boolean).join(" · ")}</span>
      {item.status && <span className={styles.badge} data-status={item.status}>{item.status === "PARTS" ? text.overview.parts(item.parts) : text.overview.status[item.status]}</span>}
      {item.adjustments > 0 && <span className={styles.badge} data-status="ADJUSTED">{text.overview.adjustments(item.adjustments)}</span>}
    </button>
    : readOnly ? <span className={styles.muted}>–</span>
    : <button type="button" className={styles.addCell} onClick={() => onAdd(row.course, item.layout)} aria-label={text.overview.addLabel(row.name, nameOf(item.layout))}
      data-testid={list ? "layout-add-sheet-list" : "layout-add-sheet"} data-course={row.course} data-layout={item.layout}>{text.overview.add}</button>;
  return <section className={styles.panelWide} aria-labelledby="layout-overview" data-testid="layout-overview">
    <h2 id="layout-overview">{text.overview.heading}</h2>
    <p className={styles.muted}>{text.overview.help}</p>
    <div className={styles.matrixWrap}>
      <table className={styles.matrix} data-testid="layout-matrix">
        <thead><tr><th scope="col">{text.overview.course}</th>{columns.map(column => <th key={column.id} scope="col">{column.name}
          <span className={styles.muted}> {column.scale ? scaleText(column.scale) : ""}</span></th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.course}><th scope="row">{row.name}</th>
          {row.cells.map(item => <td key={item.layout}>{cell(row, item)}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {/* Telefonen: en lista per bana med arken under varandra. */}
    <ul className={styles.matrixList} data-testid="layout-matrix-list">
      {rows.map(row => <li key={row.course}><h3>{row.name}</h3>
        <ul>{row.cells.map(item => <li key={item.layout}><span className={styles.listLayout}>{nameOf(item.layout)}</span>{cell(row, item, true)}</li>)}</ul></li>)}
    </ul>
  </section>;
}
