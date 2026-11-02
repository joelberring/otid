"use client";

import { useState } from "react";
import Link from "next/link";
import {
  COURSE_SETTING_NOTE_PHOTO_MAX_BYTES, mapErrorTargetAllowed, type CourseSettingNote, type CourseSettingNoteKind, type CourseSettingNoteTarget
} from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import { collaborationSv as text } from "../../i18n/course-setting-collaboration-sv";
import { notesSv } from "../../i18n/course-setting-notes-sv";
import { offlineSv } from "../../i18n/course-setting-offline-sv";
import { courseSettingNotePhotoUrl } from "../../lib/course-setting-api";
import { filterNotes, PHOTO_QUALITIES, PHOTO_SIDES, scaledSize, type NoteFilter, type NoteKindFilter } from "../../lib/course-setting-note-marks";
import { controlLabel } from "../../lib/course-setting-text";
import { Button } from "../ui";
import styles from "./course-setting.module.css";
import own from "./course-setting-notes.module.css";

/** Fotot förminskat i webbläsaren (JPEG, högst 2 MB). */
export async function photoFromFile(file: File): Promise<{ mediaType: "image/jpeg"; base64: string } | { error: string }> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return { error: text.notes.photoFailed }; }
  try {
    for (const side of PHOTO_SIDES) {
      const size = scaledSize(bitmap.width, bitmap.height, side);
      const canvas = Object.assign(document.createElement("canvas"), size);
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size.width, size.height);
      for (const quality of PHOTO_QUALITIES) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!blob || blob.size > COURSE_SETTING_NOTE_PHOTO_MAX_BYTES) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        return { mediaType: "image/jpeg", base64: btoa(binary) };
      }
    }
    return { error: text.notes.photoTooLarge };
  } finally { bitmap.close(); }
}

export function targetText(target: CourseSettingNoteTarget, document: CourseSettingDocument): string {
  const label = (id: string) => document.controls[id] ? controlLabel(document, id) : "?";
  switch (target.kind) {
    case "POINT": return text.notes.target.POINT;
    case "CONTROL": return text.notes.target.CONTROL(label(target.control));
    case "LEG": return text.notes.target.LEG(label(target.from), label(target.to));
    case "COURSE": return text.notes.target.COURSE(document.courses.find(course => course.id === target.course)?.name ?? "?");
    case "SKETCH": return notesSv.sketchTarget;
  }
}

export type NotePhoto = { mediaType: "image/jpeg"; base64: string };

/**
 * Formuläret för en ny notis (text, slag och valfritt foto; på mobilen öppnar filväljaren kameran). Slaget kartfel går
 * bara på en punkt eller en ritning (ADR-0181 beslut 8).
 */
export function NoteForm({ target, document, kind: initialKind = "COURSE_SETTING", onSave, onCancel }: { target: CourseSettingNoteTarget;
  document: CourseSettingDocument; kind?: CourseSettingNoteKind | undefined;
  onSave: (input: { text: string; photo: NotePhoto | null; kind: CourseSettingNoteKind }) => Promise<boolean>; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const [photo, setPhoto] = useState<NotePhoto | null>(null);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const canBeMapError = mapErrorTargetAllowed(target);
  const [kind, setKind] = useState<CourseSettingNoteKind>(canBeMapError ? initialKind : "COURSE_SETTING");
  return <form className={styles.noteForm} aria-label={text.notes.newHeading} data-testid="course-setting-note-form" onSubmit={event => {
    event.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true); setMessage(undefined);
    void onSave({ text: value.trim(), photo, kind }).then(ok => { if (!ok) setMessage(text.notes.failed); }).finally(() => setBusy(false));
  }}>
    <strong>{text.notes.newHeading}: {targetText(target, document)}</strong>
    {canBeMapError && <div className={styles.segmented} role="group" aria-label={notesSv.kind.label}>
      {(["COURSE_SETTING", "MAP_ERROR"] as const).map(value => <Button key={value} variant="secondary" aria-pressed={kind === value}
        onClick={() => setKind(value)}>{notesSv.kind[value]}</Button>)}
    </div>}
    <label>{text.notes.text}<textarea value={value} onChange={event => setValue(event.target.value)} maxLength={2000} rows={3} required /></label>
    <label>{text.notes.photo}<input type="file" accept="image/*" capture="environment" onChange={event => {
      const file = event.target.files?.[0];
      setPhoto(null); setMessage(undefined);
      if (file) void photoFromFile(file).then(result => "error" in result ? setMessage(result.error) : setPhoto(result));
    }} /></label>
    <p className={styles.muted}>{text.notes.photoHelp}</p>
    {message && <p role="alert" className={styles.muted}>{message}</p>}
    <div className={styles.row}>
      <Button type="submit" disabled={busy || !value.trim()}>{busy ? text.notes.saving : text.notes.save}</Button>
      <Button variant="quiet" onClick={onCancel}>{text.notes.cancel}</Button>
    </div>
  </form>;
}

export interface NotesPanelProps {
  raceId: string; notes: readonly CourseSettingNote[]; document: CourseSettingDocument; show: boolean; onShow: (show: boolean) => void;
  selected: string | undefined; onSelect: (id: string | undefined) => void; onReveal: (note: CourseSettingNote) => void;
  onReply: (id: string, text: string) => Promise<boolean>; onStatus: (id: string, status: "OPEN" | "DONE") => Promise<boolean>;
  onCourseNote: () => void; view: string; draft?: React.ReactNode; readOnlyCourse?: boolean;
  /** Steg 67: notiser som väntar i telefonens kö (inget nät): inga svar eller klar än. */
  pending?: ReadonlySet<string> | undefined;
  /** ADR-0181 beslut 8: filtret (status och slag) delas med kartan. */
  filter: NoteFilter; onFilter: (filter: NoteFilter) => void; kind: NoteKindFilter; onKind: (kind: NoteKindFilter) => void;
  /** Får ta bort notisen eller svaret (den som skrev det eller den som får ändra). */
  canDelete: (createdBy: string) => boolean;
  onDelete: (note: CourseSettingNote) => void; onDeleteReply: (note: CourseSettingNote, replyId: string) => void;
  onSketch: (kind: CourseSettingNoteKind) => void;
}

/** Notiserna: filter, lista (klick visar på kartan), tråden med svar, klar/öppen, foto och borttagning. */
export function NotesPanel({ raceId, notes, document, show, onShow, selected, onSelect, onReveal, onReply, onStatus, onCourseNote, view, draft,
  readOnlyCourse, pending, filter, onFilter, kind, onKind, canDelete, onDelete, onDeleteReply, onSketch }: NotesPanelProps) {
  const [reply, setReply] = useState("");
  const visible = filterNotes(notes, filter, kind);
  const course = document.courses.find(row => row.id === view);
  return <section className={styles.panel} aria-labelledby="course-setting-notes" data-testid="course-setting-notes">
    <h2 id="course-setting-notes">{text.notes.heading}</h2>
    <label className={styles.check}><input type="checkbox" checked={show} onChange={event => onShow(event.target.checked)} />{text.notes.show}</label>
    <div className={styles.segmented} role="group" aria-label={text.notes.filter}>
      {(["OPEN", "DONE", "ALL"] as const).map(value => <Button key={value} variant="secondary" aria-pressed={filter === value}
        onClick={() => onFilter(value)}>{text.notes.filters[value]}</Button>)}
    </div>
    <div className={styles.segmented} role="group" aria-label={notesSv.kindFilter.label}>
      {(["ALL", "COURSE_SETTING", "MAP_ERROR"] as const).map(value => <Button key={value} variant="secondary" aria-pressed={kind === value}
        onClick={() => onKind(value)}>{notesSv.kindFilter[value]}</Button>)}
    </div>
    {draft}
    {!draft && <p className={styles.muted}>{text.notes.newHelp}</p>}
    {!draft && <div className={styles.row}>
      <Button variant="secondary" onClick={() => onSketch("MAP_ERROR")}>{notesSv.sketch.drawMapError}</Button>
      <Button variant="secondary" onClick={() => onSketch("COURSE_SETTING")}>{notesSv.sketch.draw}</Button>
      {course && !readOnlyCourse && <Button variant="secondary" onClick={onCourseNote}>{text.notes.aboutCourse(course.name)}</Button>}
    </div>}
    <p className={styles.muted}><Link href={`/admin/${raceId}/course-setting/map-errors`}>{notesSv.exportLink}</Link></p>
    {visible.length === 0 ? <p className={styles.muted}>{text.notes.none}</p> : <ul className={styles.noteList}>
      {visible.map(note => <li key={note.id} data-status={note.status} data-kind={note.kind} data-selected={note.id === selected || undefined}
        data-testid="course-setting-note">
        <button type="button" className={styles.noteHead} onClick={() => { onSelect(note.id === selected ? undefined : note.id); onReveal(note); }}
          aria-expanded={note.id === selected}>
          <span className={styles.noteStatus}>{pending?.has(note.id) ? offlineSv.inspection.pending : text.notes.status[note.status]}
            {note.kind === "MAP_ERROR" && <span className={own.kind}>{notesSv.kind.MAP_ERROR}</span>}</span>
          <strong>{targetText(note.target, document)}</strong>
          <span className={styles.noteText}>{note.text}</span>
          <span className={styles.muted}>{text.notes.by(note.createdBy.displayName, note.createdAt)}
            {note.replies.length > 0 ? ` · ${text.notes.replies(note.replies.length)}` : ""}</span>
        </button>
        {note.id === selected && <div className={styles.thread}>
          {!pending?.has(note.id) && <>
            {note.photo && <a href={courseSettingNotePhotoUrl(raceId, note.id)} target="_blank" rel="noreferrer">
              <img src={courseSettingNotePhotoUrl(raceId, note.id)} alt={text.notes.photoAlt} className={styles.notePhoto} loading="lazy" /></a>}
            <ul className={styles.replies}>{note.replies.map(row => <li key={row.id}><p>{row.text}</p>
              <span className={styles.muted}>{text.notes.by(row.createdBy.displayName, row.createdAt)}</span>
              {canDelete(row.createdBy.accountId) && <Button variant="quiet" className={own.small} onClick={() => onDeleteReply(note, row.id)}>
                {notesSv.deleteReply}</Button>}</li>)}</ul>
            <form className={styles.row} onSubmit={event => {
              event.preventDefault();
              if (!reply.trim()) return;
              void onReply(note.id, reply.trim()).then(ok => { if (ok) setReply(""); });
            }}>
              <label>{text.notes.replyLabel}<input type="text" value={reply} maxLength={2000} onChange={event => setReply(event.target.value)} /></label>
              <Button type="submit" variant="secondary" disabled={!reply.trim()}>{text.notes.sendReply}</Button>
            </form>
          </>}
          <div className={styles.row}>
            {!pending?.has(note.id) && <Button variant="secondary" onClick={() => void onStatus(note.id, note.status === "OPEN" ? "DONE" : "OPEN")}>
              {note.status === "OPEN" ? text.notes.done : text.notes.reopen}</Button>}
            {canDelete(note.createdBy.accountId) && <Button variant="quiet" onClick={() => onDelete(note)}>{notesSv.delete}</Button>}
          </div>
        </div>}
      </li>)}
    </ul>}
  </section>;
}
