"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ClubArchiveEntryStatus, ClubArchiveList } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { archiveFacets, EMPTY_FILTER, filterArchive, type ArchiveFilter } from "../../lib/club-archive-filter";
import { Button, EmptyState } from "../ui";
import { EntryThumbnail } from "./map-check";
import checks from "./archive-checks.module.css";
import styles from "./club-archive.module.css";

const text = clubArchiveSv;
const STATUSES: readonly ClubArchiveEntryStatus[] = ["COMPLETE", "COURSES_ONLY", "MAP_MISSING", "MAP_ONLY"];
const STORAGE_KEY = "otid.club-archive.filter";

/** ADR-0194: arkivets träningar med sökning och filter (år, karta, tagg, ledare, läge). Filtret sparas i webbläsaren. */
export function ArchiveList({ clubId, list, admin }: { clubId: string; list: ClubArchiveList; admin: boolean }) {
  const [filter, setFilter] = useState<ArchiveFilter>(EMPTY_FILTER);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(`${STORAGE_KEY}.${clubId}`) ?? "null") as Partial<ArchiveFilter> | null;
      if (saved) setFilter({ ...EMPTY_FILTER, ...saved });
    } catch { /* inget sparat filter */ }
  }, [clubId]);
  const update = (change: Partial<ArchiveFilter>) => setFilter(current => {
    const next = { ...current, ...change };
    try { window.sessionStorage.setItem(`${STORAGE_KEY}.${clubId}`, JSON.stringify(next)); } catch { /* bara en bekvämlighet */ }
    return next;
  });
  const facets = useMemo(() => archiveFacets(list.entries), [list.entries]);
  const shown = useMemo(() => filterArchive(list.entries, filter), [list.entries, filter]);

  if (list.entries.length === 0) return <EmptyState title={text.empty.title}>{admin ? text.empty.admin : text.empty.reader}</EmptyState>;
  const f = text.filters;
  return <section aria-label={text.tabs.trainings}>
    <div className={styles.filters}>
      <label>{f.search}<input type="search" value={filter.text} placeholder={f.searchPlaceholder} onChange={event => update({ text: event.target.value })} /></label>
      <label>{f.year}<select value={filter.year} onChange={event => update({ year: event.target.value })}>
        <option value="">{f.all}</option>{facets.years.map(year => <option key={year}>{year}</option>)}</select></label>
      <label>{f.map}<select value={filter.mapId} onChange={event => update({ mapId: event.target.value })}>
        <option value="">{f.all}</option>{list.maps.map(map => <option key={map.mapId} value={map.mapId}>{map.name}</option>)}</select></label>
      <label>{f.tag}<select value={filter.tag} onChange={event => update({ tag: event.target.value })}>
        <option value="">{f.all}</option>{facets.tags.map(tag => <option key={tag}>{tag}</option>)}</select></label>
      <label>{f.leader}<select value={filter.leader} onChange={event => update({ leader: event.target.value })}>
        <option value="">{f.all}</option>{facets.leaders.map(leader => <option key={leader}>{leader}</option>)}</select></label>
      <label>{f.status}<select value={filter.status} onChange={event => update({ status: event.target.value as ArchiveFilter["status"] })}>
        <option value="">{f.all}</option>{STATUSES.map(status => <option key={status} value={status}>{text.status[status]}</option>)}</select></label>
    </div>
    <div className={styles.count}>
      <span role="status" aria-live="polite">{f.count(shown.length, list.entries.length)}</span>
      {JSON.stringify(filter) !== JSON.stringify(EMPTY_FILTER) && <Button variant="quiet" onClick={() => update(EMPTY_FILTER)}>{f.clear}</Button>}
    </div>
    {shown.length === 0 ? <p className={styles.muted}>{f.none}</p> : <ul className={styles.entries} data-testid="archive-entries">
      {shown.map(entry => <li key={entry.entryId}>
        <Link href={`/organizer/clubs/${clubId}/arkiv/${entry.entryId}`} className={checks.withThumb}>
          <EntryThumbnail clubId={clubId} entry={entry} />
          <span className={`${styles.date} ${checks.dateCell}`}>{entry.trainingDate ?? entry.year ?? "–"}</span>
          <span className={styles.entryTitle}>{entry.title}</span>
          <span className={styles.status} data-status={entry.status}>{text.status[entry.status]}</span>
          <span className={`${styles.entryMeta} ${checks.metaShift}`}>
            {entry.leader && <span>{entry.leader}</span>}
            {entry.maps.length > 0 && <span>{entry.maps.map(map => map.name).join(", ")}</span>}
            {entry.courseNames.length > 0 && <span>{text.entry.courseCount(entry.courseNames.length)}</span>}
            {entry.tags.map(tag => <span key={tag} className={styles.tag}>{tag}</span>)}
          </span>
        </Link>
      </li>)}
    </ul>}
  </section>;
}
