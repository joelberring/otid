"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TRAINING_LEVELS, type ClubArchiveEntryView, type ClubArchiveList } from "@o-tid/contracts";
import { planCopyEn } from "../../i18n/club-plan-copy-en";
import { planCopySv } from "../../i18n/club-plan-copy-sv";
import { clubPlanningEn } from "../../i18n/club-planning-en";
import { clubPlanningSv } from "../../i18n/club-planning-sv";
import { trainingMomentsEn } from "../../i18n/training-moments-en";
import { trainingMomentsSv } from "../../i18n/training-moments-sv";
import { clubBase, clubRequest } from "../../lib/club-archive-client";
import { archiveFacets, EMPTY_FILTER, filterArchive, type ArchiveFilter } from "../../lib/club-archive-filter";
import { archiveSuggestions, sameWeeksEarlierYears } from "../../lib/club-plan-archive";
import { planFailure, planningBase, planRequest } from "../../lib/club-planning-client";
import { useTexts } from "../language-provider";
import { Chips, MomentBadges } from "../training-moments/moment-picker";
import { Button, DateInput, Dialog, Field, Notice } from "../ui";
import { EntryThumbnail } from "../club-archive/map-check";
import { ReuseDialog } from "../club-archive/reuse-dialog";
import archive from "../club-archive/club-archive.module.css";
import styles from "./club-planning.module.css";

const today = () => new Date().toLocaleDateString("sv-SE");

/**
 * Ägaren 2026-11-12: "Hämta ur arkivet" i terminsplanens vecka. Ett kort per arkivträning (bilden, rubriken, datumet, kartan,
 * moment och nivåer, banorna), sökning på moment, nivå, karta och plats (som arkivlistan), samma veckor tidigare år först.
 * Servern gör planraden (med moment och ledarna om de är valda); banorna och kartan läggs sedan på med Använd igen, som skapar
 * träningen och kopplar den till raden.
 */
export function PlanArchivePicker({ clubId, termId, week, initialDate, minDate, maxDate, onDone }: {
  clubId: string; termId: string; week: number; initialDate: string; minDate: string; maxDate: string; onDone: (message: string | undefined) => void;
}) {
  const text = useTexts(planCopySv, planCopyEn);
  const planText = useTexts(clubPlanningSv, clubPlanningEn);
  const momentText = useTexts(trainingMomentsSv, trainingMomentsEn);
  const dialog = useRef<HTMLDialogElement>(null);
  const [list, setList] = useState<ClubArchiveList>();
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<ArchiveFilter>(EMPTY_FILTER);
  const [chosenId, setChosenId] = useState<string>();
  const [date, setDate] = useState(initialDate);
  const [withMoments, setWithMoments] = useState(true);
  const [withPeople, setWithPeople] = useState(true);
  const [withCourses, setWithCourses] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const [reuse, setReuse] = useState<{ view: ClubArchiveEntryView; sessionId: string }>();

  useEffect(() => {
    void clubRequest(`${clubBase(clubId)}/archive`).then(result => {
      if (result.status === 200) setList(result.json as ClubArchiveList); else setFailed(true);
    }).catch(() => setFailed(true));
  }, [clubId]);
  const entries = useMemo(() => list ? archiveSuggestions(filterArchive(list.entries, filter, moment => momentText.momentNames[moment]), initialDate) : [],
    [list, filter, momentText, initialDate]);
  const facets = useMemo(() => archiveFacets(list?.entries ?? []), [list]);
  const levels = useMemo(() => TRAINING_LEVELS.filter(level => list?.entries.some(entry => entry.levels.includes(level))), [list]);
  const chosen = list?.entries.find(entry => entry.entryId === chosenId);
  const coursesPossible = Boolean(chosen && chosen.courseFiles > 0 && date >= today());

  async function add() {
    if (!chosen) return;
    setBusy(true); setProblem("");
    const result = await planRequest(`${planningBase(clubId)}/terms/${encodeURIComponent(termId)}/archive`, "POST", { formatVersion: 1, requestId,
      entryId: chosen.entryId, sessionDate: date, startTime: null, withMoments, withPeople });
    if (result.status !== 200) { setBusy(false); setProblem(planFailure(result.status, result.json, planText)); return; }
    const sessionId = (result.json as { sessionId: string }).sessionId;
    if (coursesPossible && withCourses) {
      const entry = await clubRequest(`${clubBase(clubId)}/archive/${encodeURIComponent(chosen.entryId)}`).catch(() => undefined);
      if (entry?.status === 200) { setReuse({ view: entry.json as ClubArchiveEntryView, sessionId }); return; }
    }
    onDone(text.added);
  }

  if (reuse) return <ReuseDialog view={reuse.view} initialFileId={undefined} plan={{ termId, sessionId: reuse.sessionId }}
    onClose={() => onDone(text.added)} />;
  return <Dialog dialogRef={dialog} className={archive.dialog} labelledBy="plan-archive-title" onClose={() => onDone(undefined)}>
    <div className={archive.dialogBody} data-testid="plan-archive-picker">
      <h2 id="plan-archive-title">{text.title(week)}</h2>
      <p className={styles.muted}>{text.help}</p>
      {failed && <Notice tone="error" role="alert">{text.failed}</Notice>}
      {!list && !failed && <p role="status">{text.loading}</p>}
      {list && list.entries.length === 0 && <p>{text.empty}</p>}
      {list && list.entries.length > 0 && <>
        <label className={styles.termChoice}>{text.search}
          <input type="search" value={filter.text} placeholder={text.searchPlaceholder} onChange={event => setFilter({ ...filter, text: event.target.value })} />
        </label>
        {levels.length > 0 && <Chips legend={momentText.filterLevels} options={levels} chosen={filter.levels} dots
          name={level => momentText.levelNames[level]} onChange={next => setFilter({ ...filter, levels: next })} />}
        {facets.moments.length > 0 && <Chips legend={momentText.filterMoments} options={facets.moments} chosen={filter.moments}
          name={moment => momentText.momentNames[moment]} onChange={next => setFilter({ ...filter, moments: next })} />}
        <p className={styles.small} role="status">{text.count(entries.length, list.entries.length)}</p>
        {entries.length === 0 ? <p className={styles.empty}>{text.none}</p> : <ul className={styles.pickList} data-testid="plan-archive-entries">
          {entries.map(entry => <li key={entry.entryId} className={styles.pickItem} data-chosen={entry.entryId === chosenId || undefined}>
            <EntryThumbnail clubId={clubId} entry={entry} />
            <div>
              <p className={styles.when}>{entry.trainingDate ?? entry.year ?? text.noDate}
                {sameWeeksEarlierYears(entry, initialDate) && <> · <strong>{text.sameWeeks}</strong></>}</p>
              <h3>{entry.title}</h3>
              <p className={styles.small}>{[entry.maps.map(map => map.name).join(", "), entry.courseNames.length > 0
                ? `${text.courses(entry.courseNames.length)}: ${entry.courseNames.slice(0, 6).join(", ")}` : ""].filter(Boolean).join(" · ")}</p>
              <MomentBadges moments={entry.moments} levels={entry.levels} />
            </div>
            <Button variant={entry.entryId === chosenId ? "primary" : "secondary"} aria-pressed={entry.entryId === chosenId}
              aria-label={text.choose(entry.title)} onClick={() => setChosenId(entry.entryId)}>
              {entry.entryId === chosenId ? text.chosen : text.pick}</Button>
          </li>)}
        </ul>}
      </>}
      {chosen && <div className={styles.form}>
        <Field label={text.date}><DateInput value={date} min={minDate} max={maxDate} onChange={event => setDate(event.target.value)} /></Field>
        <fieldset className={styles.form}>
          <legend>{text.include}</legend>
          <label className={styles.check}><input type="checkbox" checked={withMoments} onChange={event => setWithMoments(event.target.checked)} />
            {text.withMoments}</label>
          <label className={styles.check}><input type="checkbox" checked={withPeople} onChange={event => setWithPeople(event.target.checked)} />
            {text.withPeople}</label>
          {coursesPossible ? <label className={styles.check}><input type="checkbox" checked={withCourses} onChange={event => setWithCourses(event.target.checked)} />
            {text.withCourses}</label> : chosen.courseFiles > 0 && <p className={styles.small}>{text.coursesLater}</p>}
        </fieldset>
      </div>}
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
      <div className={styles.actions}>
        <Button disabled={!chosen || busy || !/^\d{4}-\d{2}-\d{2}$/.test(date)} onClick={() => void add()}>{busy ? text.adding : text.add}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => dialog.current?.close()}>{text.cancel}</Button>
      </div>
    </div>
  </Dialog>;
}
