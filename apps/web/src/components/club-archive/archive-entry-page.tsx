"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import type { ClubArchiveEntryView, MapAgreement } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { clubBase, clubFailure, clubRequest } from "../../lib/club-archive-client";
import { Button, DateInput, Field, Notice } from "../ui";
import { MapAgreementSummary } from "../training-group/map-agreement";
import { CoursePreview, useRenderedVersion } from "./course-preview";
import { MapCheckChip } from "./map-check";
import { MapRightsEditor } from "./map-rights-editor";
import { ReuseDialog } from "./reuse-dialog";
import { usePpen } from "./use-ppen";
import { HelpButton } from "../help/help-panel";
import styles from "./club-archive.module.css";

const text = clubArchiveSv.entry;
type Message = { tone: "ok" | "error"; text: string };

function EditForm({ view, onSaved, onCancel }: { view: ClubArchiveEntryView; onSaved: () => Promise<void>; onCancel: () => void }) {
  const entry = view.entry;
  const [date, setDate] = useState(entry.trainingDate ?? "");
  const [place, setPlace] = useState(entry.place);
  const [title, setTitle] = useState(entry.title);
  const [leader, setLeader] = useState(entry.leader ?? "");
  const [tags, setTags] = useState(entry.tags.join(", "));
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [problem, setProblem] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    const result = await clubRequest(`${clubBase(view.clubId)}/archive/${entry.entryId}`, "PUT", { formatVersion: 1, trainingDate: date || null,
      place: place.trim(), title: title.trim(), leader: leader.trim(), notes: notes.trim(),
      tags: [...new Set(tags.split(",").map(tag => tag.trim()).filter(Boolean))].slice(0, 30) });
    if (result.status !== 200) { setProblem(clubFailure(result.status)); return; }
    await onSaved();
  }
  return <form className={styles.form} onSubmit={event => void save(event)} aria-label={text.edit}>
    <div className={styles.inline}>
      <Field label={text.date}><DateInput value={date} onChange={event => setDate(event.target.value)} /></Field>
      <Field label={text.place}><input value={place} maxLength={200} onChange={event => setPlace(event.target.value)} /></Field>
    </div>
    <Field label={text.titleField}><input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></Field>
    <Field label={text.leader}><input value={leader} maxLength={200} onChange={event => setLeader(event.target.value)} /></Field>
    <Field label={text.tags} help={text.tagsHelp}><input value={tags} onChange={event => setTags(event.target.value)} /></Field>
    <Field label={text.notes}><textarea value={notes} maxLength={4000} onChange={event => setNotes(event.target.value)} /></Field>
    <div className={styles.actions}>
      <Button type="submit" disabled={!title.trim()}>{text.save}</Button>
      <Button variant="secondary" onClick={onCancel}>{text.cancel}</Button>
    </div>
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
  </form>;
}

const agreementOf = (map: ClubArchiveEntryView["maps"][number]): MapAgreement => ({ ownership: map.ownership, ownerKind: map.ownerKind,
  ownerName: map.ownerName, agreement: map.agreement, validUntil: map.validUntil, contact: map.contact, trainingOnly: map.trainingOnly,
  feePerPrint: map.feePerPrint, noPublicDisplay: map.noPublicDisplay });

/**
 * ADR-0194 beslut 3–4: träningen i arkivet (`/organizer/clubs/[clubId]/arkiv/[entryId]`). Banan på kartversionen den
 * gjordes med, banfilerna med deras karta, kartans rättigheter, originalen och "Använd igen". Administratörer ändrar
 * rubrik, datum, ledare, taggar och anteckning och väljer karta för hand.
 */
export function ArchiveEntryPage({ clubId, entryId }: { clubId: string; entryId: string }) {
  const [view, setView] = useState<ClubArchiveEntryView>();
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<Message>();
  const [fileId, setFileId] = useState<string>();
  const [courseId, setCourseId] = useState<string>();
  const [reuseOpen, setReuseOpen] = useState(false);

  const load = useCallback(async () => {
    const result = await clubRequest(`${clubBase(clubId)}/archive/${entryId}`);
    if (result.status !== 200) { setFailed(true); return; }
    setView(result.json as ClubArchiveEntryView);
  }, [clubId, entryId]);
  useEffect(() => { void load(); }, [load]);

  const file = view?.courseFiles.find(candidate => candidate.courseFileId === fileId) ?? view?.courseFiles.find(candidate => candidate.mapVersion)
    ?? view?.courseFiles[0];
  const ppen = usePpen(clubId, file);
  const folderVersion = useMemo(() => {
    if (!view) return null;
    for (const map of view.maps) for (const version of map.versions) if (view.folderVersionIds.includes(version.versionId)) return version;
    return null;
  }, [view]);
  const previewVersion = file?.mapVersion ? { versionId: file.mapVersion.versionId, fileName: file.mapVersion.fileName }
    : file ? null : folderVersion ? { versionId: folderVersion.versionId, fileName: folderVersion.fileName } : null;
  // ADR-0209 beslut C: kartfilen hör till kartbanken; utan den ritas ingen förhandsvisning (bilden i listan finns kvar).
  const rendered = useRenderedVersion(clubId, view?.viewer.access.mapBank === false ? null : previewVersion);
  const courses = ppen ? [...ppen.document.courses].sort((a, b) => a.order - b.order) : [];
  const selectedCourse = courses.find(course => course.id === courseId)?.id ?? courses[0]?.id;
  const courseDataCourse = file?.courseData ? file.courseData.find(course => course.name === courseId) ?? file.courseData[0] : undefined;

  async function setMap(courseFileId: string, mapVersionId: string) {
    const result = await clubRequest(`${clubBase(clubId)}/course-files/${courseFileId}`, "PUT", { formatVersion: 1, mapVersionId: mapVersionId || null });
    setMessage(result.status === 200 ? { tone: "ok", text: text.saved } : { tone: "error", text: clubFailure(result.status) });
    await load();
  }

  async function remove() {
    if (!window.confirm(text.removeConfirm)) return;
    const result = await clubRequest(`${clubBase(clubId)}/archive/${entryId}`, "DELETE");
    if (result.status === 200) window.location.assign(`/organizer/clubs/${clubId}`);
    else setMessage({ tone: "error", text: clubFailure(result.status) });
  }

  const back = <Link href={`/organizer/clubs/${clubId}`}>{clubArchiveSv.backToArchive}</Link>;
  if (failed) return <main className={styles.page}><p className={styles.kicker}>{back}</p><Notice tone="error" role="alert">{clubArchiveSv.loadFailed}</Notice></main>;
  if (!view) return <main className={styles.page}><p className={styles.kicker}>{back}</p><p role="status">{clubArchiveSv.loading}</p></main>;
  const entry = view.entry;
  const admin = view.viewer.role === "OWNER" || view.viewer.role === "ADMIN";
  const mapBank = view.viewer.access.mapBank;
  const allVersions = view.maps.flatMap(map => map.versions.map(version => ({ map, version })));
  const usedVersionIds = new Set([...view.folderVersionIds, ...view.courseFiles.flatMap(courseFile => courseFile.mapVersion ? [courseFile.mapVersion.versionId] : [])]);
  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>{back} · {view.clubName}</p>
        <h1>{entry.title}</h1>
        <p className={styles.muted}>{[entry.trainingDate ?? entry.year, entry.leader, clubArchiveSv.status[entry.status]].filter(Boolean).join(" · ")}</p>
      </div>
      <div className={styles.actions}>
        {mapBank && <Button onClick={() => setReuseOpen(true)} disabled={view.courseFiles.length === 0 && allVersions.length === 0}>{clubArchiveSv.reuse.open}</Button>}
        {admin && !editing && <Button variant="secondary" onClick={() => setEditing(true)}>{text.edit}</Button>}
        <HelpButton view={["ARCHIVE_ENTRY", "ARCHIVE_MAPS"]} />
      </div>
    </header>
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    {editing && <EditForm view={view} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); setMessage({ tone: "ok", text: text.saved }); await load(); }} />}
    <div className={styles.detail}>
      <section aria-labelledby="entry-preview">
        <h2 id="entry-preview">{text.preview}</h2>
        {courses.length > 1 && <div className={styles.coursePick} role="group" aria-label={text.courses}>
          {courses.map(course => <Button key={course.id} variant="secondary" aria-pressed={course.id === selectedCourse}
            onClick={() => setCourseId(course.id)}>{course.name}</Button>)}
        </div>}
        {file?.courseData && file.courseData.length > 1 && <div className={styles.coursePick} role="group" aria-label={text.courses}>
          {file.courseData.map(course => <Button key={course.name} variant="secondary" aria-pressed={course.name === courseDataCourse?.name}
            onClick={() => setCourseId(course.name)}>{course.name}</Button>)}
        </div>}
        <CoursePreview version={rendered} document={ppen?.document} courseId={selectedCourse} courseData={courseDataCourse}
          label={`${text.preview}: ${entry.title}`} />
        {/* Ägaren 2026-11-03 försökte flytta en start här: arkivet visar bara; ändringar görs i en kopia (Använd igen). */}
        <div className={styles.readOnlyHint} data-testid="archive-read-only">
          <p>{text.readOnlyHint}</p>
          {mapBank && <Button onClick={() => setReuseOpen(true)} disabled={view.courseFiles.length === 0 && allVersions.length === 0}>{clubArchiveSv.reuse.open}</Button>}
        </div>
        {entry.tags.length > 0 && <p className={styles.actions}>{entry.tags.map(tag => <span key={tag} className={styles.tag}>{tag}</span>)}</p>}
        {entry.notes && <p>{entry.notes}</p>}
        {!mapBank && <p className={styles.muted} data-testid="map-bank-closed">{text.mapBankClosed}</p>}
        <dl className={styles.facts}>
          {entry.sourcePath && <><dt>{text.source}</dt><dd>{entry.sourcePath}</dd></>}
          {view.sourceRace && <><dt>{text.fromRace}</dt><dd data-testid="entry-source-race">{view.sourceRace.publicPath
            ? <Link href={view.sourceRace.publicPath}>{view.sourceRace.name}</Link> : view.sourceRace.name} ({view.sourceRace.date})</dd></>}
        </dl>
      </section>
      <section aria-labelledby="entry-courses">
        <h2 id="entry-courses">{text.courses}</h2>
        {view.courseFiles.length === 0 && <p className={styles.muted}>{text.noCourses}</p>}
        {view.courseFiles.map(courseFile => <div key={courseFile.courseFileId} className={styles.fileCard} data-testid="course-file">
          <div className={styles.fileHead}>
            <h3>{courseFile.fileName}</h3>
            {view.courseFiles.length > 1 && <Button variant="secondary" className={styles.showOnMap}
              aria-pressed={courseFile.courseFileId === file?.courseFileId} aria-label={`${text.showOnMap}: ${courseFile.fileName}`}
              onClick={() => { setFileId(courseFile.courseFileId); setCourseId(undefined); }}>{text.showOnMap}</Button>}
          </div>
          <p className={styles.small}>{courseFile.courses.map(course => [course.name, text.controls(course.controls),
            course.lengthM ? text.length(course.lengthM) : ""].filter(Boolean).join(" ")).join(" · ") || "–"}</p>
          {courseFile.problem && <p className={styles.warning}>{text.problem} {courseFile.problem}</p>}
          <p className={styles.small}>{text.madeWith}: {courseFile.mapVersion
            ? `${courseFile.mapVersion.mapName} (${courseFile.mapVersion.versionDate ?? "–"}, ${courseFile.mapVersion.latest ? text.latest : text.olderVersion})`
            : "–"} · {text.resolution[courseFile.resolution]}</p>
          <div className={styles.actions}>
            <a href={`${clubBase(clubId)}/course-files/${courseFile.courseFileId}`} download>{text.download}</a>
            {admin && <select aria-label={`${text.chooseMap}: ${courseFile.fileName}`} value={courseFile.mapVersion?.versionId ?? ""}
              onChange={event => void setMap(courseFile.courseFileId, event.target.value)}>
              <option value="">{text.noMap}</option>
              {allVersions.map(({ map, version }) => <option key={version.versionId} value={version.versionId}>{map.name} – {version.versionDate ?? "–"} {version.fileName}</option>)}
            </select>}
          </div>
        </div>)}
        <h2 className={styles.nextHeading}>{text.rights}</h2>
        {view.maps.map(map => <div key={map.mapId}>
          <MapAgreementSummary agreement={agreementOf(map)} title={map.name} />
          {admin && <MapRightsEditor clubId={clubId} map={map} onSaved={load} />}
          <ul className={styles.versionList} aria-label={`${text.mapVersion}: ${map.name}`}>{map.versions.map(version => <li key={version.versionId}>
            <span className={styles.versionDate}>{version.versionDate ?? "–"}</span>
            <span className={styles.versionFile}>
              {mapBank ? <a href={`${clubBase(clubId)}/map-versions/${version.versionId}`} download>{version.fileName}</a> : <span>{version.fileName}</span>}
              {usedVersionIds.has(version.versionId) && <span className={styles.small}>{text.usedHere}</span>}
              <MapCheckChip check={version.check} />
            </span>
            {version.versionId === map.latestVersionId ? <span className={styles.latest}>{clubArchiveSv.maps.latest}</span> : <span />}
          </li>)}</ul>
        </div>)}
        {admin && <p><Button variant="quiet" onClick={() => void remove()}>{text.remove}</Button></p>}
      </section>
    </div>
    {reuseOpen && <ReuseDialog view={view} initialFileId={file?.courseFileId} onClose={() => setReuseOpen(false)} />}
  </main>;
}
