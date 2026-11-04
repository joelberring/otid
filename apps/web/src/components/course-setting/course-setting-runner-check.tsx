"use client";

import { useMemo, useState } from "react";
import { runnerPrintSv as text } from "../../i18n/course-setting-runner-print-sv";
import { checkRowsCsv, sortCheckRows, CHECK_COLUMNS, type CheckColumn, type CheckRow } from "../../lib/course-setting-runner-select";
import { Button } from "../ui";
import { HelpLink } from "../help/help-panel";
import styles from "./course-setting-print-page.module.css";

/**
 * ADR-0213: "Kontrollera kopplingen" före utskriften av en karta per löpare: sidan i PDF:en, löparen, klassen, laget och
 * sträckan, banan, varianten och starttiden, med varningar. Sorteras på kolumnen, filtreras på text eller varningar och
 * sparas som CSV; ett klick på en rad visar löparens ark.
 */
export function RunnerCheckTable({ rows, onPreview, selected }: { rows: readonly CheckRow[]; onPreview: (row: CheckRow) => void; selected: string | undefined }) {
  const [sort, setSort] = useState<{ column: CheckColumn; descending: boolean }>({ column: "page", descending: false });
  const [filter, setFilter] = useState("");
  const [warningsOnly, setWarningsOnly] = useState(false);
  const shown = useMemo(() => sortCheckRows(rows, sort.column, sort.descending, filter, warningsOnly), [rows, sort, filter, warningsOnly]);
  const warned = rows.filter(row => row.warnings.length > 0).length;
  const csv = () => {
    const header = [...CHECK_COLUMNS.map(column => text.columns[column]), text.warningsColumn];
    const blob = new Blob(["﻿", checkRowsCsv(shown, header, warning => text.warnings[warning])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url; link.download = `${text.csvFile}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className={styles.panel} id="runner-check" aria-labelledby="runner-check-title" data-testid="runner-check">
    <h2 id="runner-check-title">{text.checkTitle}</h2>
    <p className={styles.muted}>{text.checkHelp} <HelpLink article="lopar-kartor" view={["CS_PRINT_PAGE", "CS_PRINT"]} /></p>
    <div className={styles.row}>
      <label className={styles.field}>{text.filter}<input type="search" className={styles.medium} value={filter} onChange={event => setFilter(event.target.value)}
        data-testid="runner-check-filter" /></label>
      <label className={styles.check}><input type="checkbox" checked={warningsOnly} onChange={event => setWarningsOnly(event.target.checked)}
        data-testid="runner-check-warnings-only" />{text.warningsOnly}</label>
      <Button variant="secondary" onClick={csv} data-testid="runner-check-csv">{text.csv}</Button>
      <span className={styles.muted} role="status" data-testid="runner-check-status">{text.rows(shown.length, rows.length)}. {text.warningCount(warned)}</span>
    </div>
    <div className={styles.tableBox}>
      <table className={styles.table}>
        <thead><tr>
          {CHECK_COLUMNS.map(column => <th key={column} scope="col" aria-sort={sort.column === column ? (sort.descending ? "descending" : "ascending") : "none"}>
            <button type="button" className={styles.sortButton} aria-label={text.sortBy(text.columns[column])} data-testid={`runner-check-sort-${column}`}
              onClick={() => setSort(current => ({ column, descending: current.column === column ? !current.descending : false }))}>
              {text.columns[column]}{sort.column === column ? (sort.descending ? " ▼" : " ▲") : ""}</button></th>)}
          <th scope="col">{text.warningsColumn}</th>
        </tr></thead>
        <tbody>{shown.map(row => <tr key={row.key} data-testid="runner-check-row" data-page={row.page ?? ""} data-warnings={row.warnings.join(" ")}
          data-selected={selected === row.key ? "" : undefined} className={row.warnings.length > 0 ? styles.warnRow : undefined}
          onClick={() => { if (row.item !== undefined) onPreview(row); }}>
          {CHECK_COLUMNS.map(column => <td key={column}>{column === "name" && row.item !== undefined
            ? <button type="button" className={styles.sortButton} onClick={() => onPreview(row)} aria-label={text.preview(row.name)} data-testid="runner-check-preview">
              {row.name}</button>
            : column === "page" ? row.page ?? text.noPage : row[column] ?? ""}</td>)}
          <td>{row.warnings.map(warning => <span key={warning} className={styles.paperWarning}>⚠ {text.warnings[warning]} </span>)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
