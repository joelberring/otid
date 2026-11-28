"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClubArchiveList, ClubArchiveListItem } from "@o-tid/contracts";
import { SWEDISH_TIME_ZONE, zonedDate } from "@o-tid/domain";
import { TRAINING_LEVELS } from "@o-tid/contracts";
import { clubArchiveEn } from "../../i18n/club-archive-en";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { clubArchiveChecksEn } from "../../i18n/club-archive-more-en";
import { clubArchiveChecksSv } from "../../i18n/club-archive-checks-sv";
import { listEn } from "../../i18n/list-en";
import { listSv } from "../../i18n/list-sv";
import { trainingMomentsEn } from "../../i18n/training-moments-en";
import { trainingMomentsSv } from "../../i18n/training-moments-sv";
import { entryThumbnailUrl } from "../../lib/club-archive-check-view";
import { activeFilters, ARCHIVE_STATUSES, archiveFacets, archiveGroups, EMPTY_FILTER, filterArchive, filterFromSearch, filterToSearch,
  type ArchiveFilter } from "../../lib/club-archive-filter";
import { monthHeading } from "../../lib/human-date";
import { useLanguage, useTexts } from "../language-provider";
import { Chips } from "../training-moments/moment-picker";
import { Button, DateTile, EmptyState, ListHeading, ListRow, RowBadge, RowList, Thumb } from "../ui";
import { ScrollRow } from "../ui/scroll-row";
import styles from "./club-archive.module.css";

/** Så många rader visas först; «Visa fler» lägger till lika många. */
const PAGE = 60;

/** Valen under «Fler filter» (allt utom sökningen, År, Karta och egna ord). */
const moreFilters = (filter: ArchiveFilter) => activeFilters(filter, { withTags: false }) - (filter.year ? 1 : 0) - (filter.mapId ? 1 : 0);

/**
 * ADR-0194: arkivets träningar med sökning och filter (år, karta, ledare, läge; ADR-0222 moment, nivåer och egna ord). Steg F2:
 * sök först och filter på begäran (datorn: År och Karta bredvid sökrutan, resten under «Fler filter»; telefonen: allt under
 * «Filter»), egna ord på en rad som rullar i sidled, täta rader grupperade per månad (i år och i fjol) och per år. Valen står i
 * adressen (`?ar=2026&ord=natt`), så att Bakåt från en träning ger samma urval. Sökningen gäller hela arkivet.
 */
export function ArchiveList({ clubId, list, admin }: { clubId: string; list: ClubArchiveList; admin: boolean }) {
  const text = useTexts(clubArchiveSv, clubArchiveEn);
  const checkText = useTexts(clubArchiveChecksSv, clubArchiveChecksEn);
  const momentText = useTexts(trainingMomentsSv, trainingMomentsEn);
  const words = useTexts(listSv, listEn);
  const language = useLanguage();
  const [filter, setFilter] = useState<ArchiveFilter>(EMPTY_FILTER);
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const saved = filterFromSearch(window.location.search);
    setFilter(saved);
    if (moreFilters(saved) > 0) setOpen(true);
  }, []);
  const update = (change: Partial<ArchiveFilter>) => {
    const next = { ...filter, ...change };
    setFilter(next);
    setLimit(PAGE);
    try {
      const { pathname, search, hash } = window.location;
      window.history.replaceState(window.history.state, "", `${pathname}${filterToSearch(next, search)}${hash}`);
    } catch { /* adressen är bara en bekvämlighet */ }
  };
  const facets = useMemo(() => archiveFacets(list.entries), [list.entries]);
  const shown = useMemo(() => filterArchive(list.entries, filter, moment => momentText.momentNames[moment]), [list.entries, filter, momentText]);
  const levels = useMemo(() => TRAINING_LEVELS.filter(level => list.entries.some(entry => entry.levels.includes(level))), [list.entries]);
  const today = zonedDate(new Date(), SWEDISH_TIME_ZONE);
  const groups = useMemo(() => {
    let left = limit;
    return archiveGroups(shown, today).flatMap(group => {
      const entries = group.entries.slice(0, Math.max(0, left));
      left -= entries.length;
      return entries.length > 0 ? [{ ...group, entries }] : [];
    });
  }, [shown, today, limit]);
  // Bildkolumnen finns när någon träning i arkivet har (eller kan få) en bild; annars ingen kolumn alls.
  const thumbs = list.entries.some(entry => entry.thumbnailSource !== null || entry.thumbnail?.status === "OK");

  if (list.entries.length === 0) return <EmptyState title={text.empty.title}>{admin ? text.empty.admin : text.empty.reader}</EmptyState>;
  const f = text.filters;
  const moreCount = moreFilters(filter);
  const filtering = filter.text.trim() !== "" || activeFilters(filter) > 0;
  const heading = (group: (typeof groups)[number]) => group.kind === "undated" ? words.undated : group.kind === "year" ? group.key
    : monthHeading(group.key, language);
  const row = (entry: ClubArchiveListItem, month: boolean) => {
    const where = entry.place || entry.maps.map(map => map.name).join(", ");
    const meta = [entry.trainingDate ? "" : entry.year ? String(entry.year) : "", where,
      entry.courseNames.length > 0 ? text.entry.courseCount(entry.courseNames.length) : ""].filter(Boolean).join(" · ");
    const image = entry.thumbnail?.status === "OK" ? <Thumb src={entryThumbnailUrl(clubId, entry.entryId, entry.thumbnail.createdAt)}
      alt={entry.thumbnail.courseName ? `${checkText.trainingImage(entry.title)} (${entry.thumbnail.courseName})` : checkText.trainingImage(entry.title)}
      testId="entry-thumbnail" /> : null;
    // Statusen bara när något saknas: «Karta saknas» i åtgärdsfärgen med en symbol, «Bara karta» dämpat. Det vanliga fallet visar ingenting.
    const status = entry.status === "MAP_MISSING" ? <span className={styles.rowMissing} data-testid="archive-entry-status">
      <span aria-hidden="true">!</span> {text.status.MAP_MISSING}</span>
      : entry.status === "MAP_ONLY" ? <span className={styles.rowStatus} data-testid="archive-entry-status">{text.status.MAP_ONLY}</span> : null;
    const tags = entry.tags.length > 0;
    return <ListRow key={entry.entryId} href={`/organizer/clubs/${clubId}/arkiv/${entry.entryId}`} testId="archive-entry"
      date={<DateTile date={entry.trainingDate} month={!month} />} thumb={thumbs ? image : undefined} title={entry.title}
      meta={<>{meta}{tags && <span className={styles.phoneOnly}>{meta ? " · " : ""}{entry.tags.join(", ")}</span>}</>}
      end={status || tags ? <>{status}{entry.tags.map(tag => <span key={tag} className={styles.desktopOnly}><RowBadge>{tag}</RowBadge></span>)}</>
        : undefined} />;
  };

  return <section aria-label={text.tabs.trainings} className={styles.archive}>
    <div className={styles.searchBar} data-open={open}>
      <input type="search" className={styles.searchInput} value={filter.text} aria-label={f.search} placeholder={f.searchPlaceholder(list.entries.length)}
        onChange={event => update({ text: event.target.value })} data-testid="archive-search" />
      <label className={styles.firstFilter}>{f.year}<select value={filter.year} onChange={event => update({ year: event.target.value })}>
        <option value="">{f.all}</option>{facets.years.map(year => <option key={year}>{year}</option>)}</select></label>
      <label className={styles.firstFilter}>{f.map}<select value={filter.mapId} onChange={event => update({ mapId: event.target.value })}>
        <option value="">{f.all}</option>{list.maps.map(map => <option key={map.mapId} value={map.mapId}>{map.name}</option>)}</select></label>
      <Button variant="secondary" className={styles.moreButton} aria-expanded={open} aria-controls="archive-more-filters"
        onClick={() => setOpen(!open)} data-testid="archive-more">{f.more(moreCount)}</Button>
      <Button variant="secondary" className={styles.phoneButton} aria-expanded={open} aria-controls="archive-more-filters"
        onClick={() => setOpen(!open)} data-testid="archive-filter-button">{f.phone(activeFilters(filter, { withTags: false }))}</Button>
      <div className={styles.moreFilters} id="archive-more-filters" hidden={!open}>
        <label>{f.leader}<select value={filter.leader} onChange={event => update({ leader: event.target.value })}>
          <option value="">{f.all}</option>{facets.leaders.map(leader => <option key={leader}>{leader}</option>)}</select></label>
        {facets.addedBy.length > 0 && <label>{f.addedBy}<select value={filter.addedBy} data-testid="archive-filter-added-by"
          onChange={event => update({ addedBy: event.target.value })}>
          <option value="">{f.all}</option>{facets.addedBy.map(name => <option key={name}>{name}</option>)}</select></label>}
        <label>{f.status}<select value={filter.status} onChange={event => update({ status: event.target.value as ArchiveFilter["status"] })}>
          <option value="">{f.all}</option>{ARCHIVE_STATUSES.map(status => <option key={status} value={status}>{text.status[status]}</option>)}</select></label>
        {(facets.moments.length > 0 || levels.length > 0) && <div className={styles.momentFilters} data-testid="archive-moment-filters">
          {levels.length > 0 && <Chips legend={momentText.filterLevels} help={momentText.filterLevelsHelp} options={levels} chosen={filter.levels}
            name={level => momentText.levelNames[level]} dots onChange={next => update({ levels: next })} />}
          {facets.moments.length > 0 && <Chips legend={momentText.filterMoments} help={momentText.filterMomentsHelp} options={facets.moments}
            chosen={filter.moments} name={moment => momentText.momentNames[moment]} onChange={next => update({ moments: next })} />}
        </div>}
      </div>
    </div>
    {facets.tags.length > 0 && <ScrollRow rowClassName={styles.tagRow} role="group" aria-label={f.tag} className={styles.tagRowWrap}
      data-testid="archive-tags">
      {facets.tags.map(tag => <button key={tag} type="button" className={styles.tagChip} aria-pressed={filter.tags.includes(tag)}
        onClick={() => update({ tags: filter.tags.includes(tag) ? filter.tags.filter(chosen => chosen !== tag) : [...filter.tags, tag] })}>{tag}</button>)}
    </ScrollRow>}
    <div className={styles.count} hidden={!filtering}>
      <span role="status" aria-live="polite">{filtering ? f.count(shown.length, list.entries.length) : ""}</span>
      {filtering && <Button variant="quiet" onClick={() => update(EMPTY_FILTER)}>{f.clear}</Button>}
    </div>
    {shown.length === 0 ? <p className={styles.muted}>{f.none}</p> : <div data-testid="archive-entries">
      {groups.map(group => <div key={group.key || "undated"} className={styles.group}>
        <ListHeading>{heading(group)}</ListHeading>
        <RowList label={heading(group)}>{group.entries.map(entry => row(entry, group.kind === "month"))}</RowList>
      </div>)}
    </div>}
    {shown.length > limit && <p className={styles.showMore}><Button variant="secondary" onClick={() => setLimit(limit + PAGE)}
      data-testid="archive-show-more">{words.showMore(shown.length - limit)}</Button></p>}
  </section>;
}
