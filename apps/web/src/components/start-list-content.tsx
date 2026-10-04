"use client";

import React, { useMemo, useState } from "react";
import type { StartListPublicationContent } from "@o-tid/contracts";
import { filterPublishedStartListClasses } from "../lib/start-list-filter";
import { formatStartListTime } from "../lib/start-list-time";
import { startListSv as text } from "../i18n/start-list-sv";
import { courseVariantsSv as variantText } from "../i18n/course-variants-sv";
import styles from "./start-list-content.module.css";

export function StartListContent({ content }: { content: StartListPublicationContent }) {
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const visibleClasses = useMemo(() => filterPublishedStartListClasses(content.classes, selected, query), [content.classes, selected, query]);
  const total = useMemo(() => content.classes.reduce((count, row) => count + row.entries.length, 0), [content.classes]);
  const shown = visibleClasses.reduce((count, row) => count + row.entries.length, 0);
  const filtered = selected !== "" || query.trim() !== "";
  return <section className={`stack start-list-admin ${styles.content}`} aria-label={text.listCaption}>
    <div className={styles.identity}><h2>{content.eventName}</h2>
      <p>{content.raceName} · {content.raceDate} · {text.timeZone}: {content.timeZone}</p></div>
    <div className={styles.controls}>
      <label>{text.publicSearch}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>{text.raceClass}<select value={selected} onChange={(event) => setSelected(event.target.value)}>
        <option value="">{text.allClasses}</option>{content.classes.map((row, index) => <option key={index} value={String(index)}>{row.name}</option>)}
      </select></label>
      <div className={styles.controlSummary}><span role="status" aria-live="polite">{text.publicFilterCount(shown, total)}</span>
        {filtered && <button type="button" className="secondary" onClick={() => { setQuery(""); setSelected(""); }}>{text.clearFilters}</button>}</div>
    </div>
    {filtered && <p className={styles.viewNote}>{text.publicViewOnly}</p>}
    {filtered && <p className={styles.printSelection}>{text.publicPrintSelection} · {text.publicFilterCount(shown, total)}
      {selected && ` · ${text.raceClass}: ${content.classes[Number(selected)]?.name ?? text.allClasses}`}
      {query.trim() && ` · ${text.publicSearch}: ${query.trim()}`}</p>}
    {visibleClasses.length === 0 && filtered && <p className={styles.noMatches}>{text.publicNoMatches}</p>}
    {visibleClasses.map((row) => <section className={styles.classSection} key={row.index}>
      <div className={styles.classHeading}><h3>{row.name}</h3>
        <p>{row.startRule === "PUNCH" ? text.punch : text.fixed} · {query.trim() ? text.publicFilteredClassCount(row.entries.length, content.classes[row.index]!.entries.length) : text.classCount(row.entries.length)}</p></div>
      {row.entries.length === 0 && <p>{text.empty}</p>}
      {row.entries.length > 0 && <div className={styles.columnHeadings} aria-hidden="true">
        <span>{text.name}</span><span>{text.organisation}</span><span>{text.plannedStart}</span>
      </div>}
      {row.entries.map((entry, entryIndex) => <article key={entryIndex} className={styles.entry}>
        <h4>{entry.displayName}{entry.courseVariantCode && <span className={styles.variant}> · {variantText.variantShort(entry.courseVariantCode)}</span>}</h4>
        <p><span className={styles.inlineLabel}>{text.organisation}: </span>{entry.organisationName ?? text.noOrganisation}</p>
        <p><span className={styles.inlineLabel}>{text.plannedStart}: </span>
          {row.startRule === "PUNCH" ? text.punch : entry.fixedStartTime ? formatStartListTime(entry.fixedStartTime, content.timeZone) : text.missingTime}</p>
      </article>)}
    </section>)}
  </section>;
}
