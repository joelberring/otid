"use client";

import { useId, useState } from "react";
import { trainingEn } from "../../i18n/course-setting-training-en";
import { useTexts } from "../language-provider";
import {
  filterShows, presetFilter, setSymbol, SYMBOL_GROUPS, toggleGroup, type FilterPreset, type SymbolCatalogEntry, type SymbolFilter
} from "@o-tid/course-setting";
import { trainingSv } from "../../i18n/course-setting-training-sv";
import styles from "./course-setting-training.module.css";

const PRESETS: readonly Exclude<FilterPreset, "CUSTOM">[] = ["ALL", "CONTOURS", "CONTOURS_WATER_ROCK", "NO_VEGETATION", "NO_PATHS", "PATHS_ROADS"];

/**
 * ADR-0192 beslut 4: symbolfiltret. Förvalen som knappar, grupperna (ISOM 2017-2/ISSprOM 2019-2) och kartans symboler med
 * antal objekt som kryssrutor; en symbol som skiljer sig från sin grupp sparas som undantag.
 */
export function SymbolFilterEditor({ filter, onChange, symbols, readOnly, label }: {
  filter: SymbolFilter; onChange: (filter: SymbolFilter) => void; symbols: readonly SymbolCatalogEntry[]; readOnly: boolean; label: string;
}) {
  const text = useTexts(trainingSv, trainingEn);
  const id = useId();
  const [search, setSearch] = useState("");
  const found = search.trim() === "" ? symbols : symbols.filter(row => `${row.code} ${row.name}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className={styles.filter} role="group" aria-label={label}>
    <div className={styles.presets}>
      {PRESETS.map(preset => <button key={preset} type="button" className={styles.chip} aria-pressed={filter.preset === preset} disabled={readOnly}
        onClick={() => onChange(presetFilter(preset))}>{text.filter.presets[preset]}</button>)}
      {filter.preset === "CUSTOM" && <span className={styles.chip} aria-current="true">{text.filter.presets.CUSTOM}</span>}
    </div>
    <details className={styles.details}>
      <summary>{text.filter.presets.CUSTOM} …</summary>
      <p className={styles.muted}>{text.filter.safety}</p>
      <div className={styles.groups}>
        {SYMBOL_GROUPS.map(group => <label key={group} className={styles.check}>
          <input type="checkbox" checked={filter.groups.includes(group)} disabled={readOnly}
            onChange={event => onChange(toggleGroup(filter, group, event.target.checked))} />{text.filter.groups[group]}</label>)}
      </div>
      <details className={styles.details}>
        <summary>{text.filter.symbols}</summary>
        <p className={styles.muted}>{text.filter.symbolsHelp}</p>
        {symbols.length === 0 ? <p className={styles.muted}>{text.filter.noSymbols}</p> : <>
          <label className={styles.stack} htmlFor={`${id}-search`}>{text.filter.search}</label>
          <input id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} className={styles.input} />
          <ul className={styles.symbolList}>
            {found.map(row => {
              const shown = filterShows(filter, row.key, row.group);
              const byGroup = filter.groups.includes(row.group);
              return <li key={row.key}><label className={styles.check}>
                <input type="checkbox" checked={shown} disabled={readOnly}
                  onChange={event => onChange(setSymbol(filter, row.key, event.target.checked === byGroup ? undefined : event.target.checked))} />
                <span><b>{row.code || "–"}</b> {row.name} <span className={styles.muted}>{text.filter.count(row.count)}</span>
                  {shown !== byGroup && <span className={styles.override}> ≠ {text.filter.groups[row.group]?.split(" (")[0]}</span>}</span>
              </label></li>;
            })}
          </ul>
        </>}
      </details>
    </details>
  </div>;
}
