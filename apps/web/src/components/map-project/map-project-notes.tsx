"use client";

import { useState } from "react";
import { mapProjectNotesEn } from "../../i18n/map-project-tools-en";
import { useTexts } from "../language-provider";
import { mapProjectNotesSv } from "../../i18n/map-project-notes-sv";
import { photoFromFile } from "../course-setting/course-setting-notes";
import { Button } from "../ui";
import type { ShownNote } from "./use-map-project-notes";
import styles from "./map-project-editor.module.css";

const when = (iso: string) => new Date(iso).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
type Photo = { mediaType: "image/jpeg"; base64: string };

/**
 * ADR-0219 (K3): notisens formulär (text och foto från kameran), en notis i detalj (foto, vem och när, klar, ta bort) och
 * listan i panelen. Formuläret och detaljen ligger nertill över kartan, som fältlägets ark i banläggningen.
 */
export function NoteForm({ onSave, onCancel }: { onSave: (value: string, photo: Photo | undefined) => Promise<void>; onCancel: () => void }) {
  const text = useTexts(mapProjectNotesSv, mapProjectNotesEn);
  const [value, setValue] = useState("");
  const [photo, setPhoto] = useState<Photo>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  return <form className={styles.sheet} data-testid="map-project-note-form" aria-label={text.new} onSubmit={event => {
    event.preventDefault();
    if (!value.trim() && !photo) { setProblem(text.empty); return; }
    setBusy(true);
    void onSave(value, photo).finally(() => setBusy(false));
  }}>
    <label className={styles.stack}>{text.text}
      <textarea value={value} maxLength={1000} rows={3} placeholder={text.placeholder} onChange={event => setValue(event.target.value)} autoFocus />
    </label>
    <div className={styles.actions}>
      {photo ? <><span>{text.photoAdded}</span><Button variant="quiet" onClick={() => setPhoto(undefined)}>{text.removePhoto}</Button></>
        : <label className={styles.fileButton}>{text.photo}<input type="file" accept="image/*" capture="environment" data-testid="map-project-note-photo"
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void photoFromFile(file).then(result => { if ("error" in result) setProblem(result.error); else { setPhoto(result); setProblem(undefined); } });
          }} /></label>}
    </div>
    {problem && <p role="alert" className={styles.problem}>{problem}</p>}
    <div className={styles.actions}>
      <Button type="submit" disabled={busy} data-testid="map-project-note-save">{text.save}</Button>
      <Button variant="secondary" onClick={onCancel}>{text.cancel}</Button>
    </div>
  </form>;
}

export function NoteDetail({ note, canManage, onStatus, onRemove, onClose }: { note: ShownNote; canManage: boolean;
  onStatus: (status: "OPEN" | "DONE") => void; onRemove: () => void; onClose: () => void }) {
  const text = useTexts(mapProjectNotesSv, mapProjectNotesEn);
  return <section className={styles.sheet} data-testid="map-project-note" data-status={note.status} aria-label={text.heading}>
    {note.text && <p className={styles.noteText}>{note.text}</p>}
    {note.photoUrl && <img className={styles.notePhoto} src={note.photoUrl} alt={text.photo} />}
    <p className={styles.muted}>{note.pending ? (note.problem ? text.failed(note.problem) : text.waiting)
      : text.by(note.server?.account.name ?? null, when(note.server?.createdAt ?? new Date().toISOString()))}</p>
    <div className={styles.actions}>
      {canManage && !note.pending && <Button variant="secondary" data-testid="map-project-note-status"
        onClick={() => onStatus(note.status === "OPEN" ? "DONE" : "OPEN")}>{note.status === "OPEN" ? text.done : text.reopen}</Button>}
      {canManage && <Button variant="quiet" onClick={() => { if (window.confirm(text.removeConfirm)) onRemove(); }}>{text.remove}</Button>}
      <Button variant="quiet" onClick={onClose}>{text.close}</Button>
    </div>
  </section>;
}

export function NotesPanel({ notes, onShow, problem }: { notes: readonly ShownNote[]; onShow: (note: ShownNote) => void; problem?: number | undefined }) {
  const text = useTexts(mapProjectNotesSv, mapProjectNotesEn);
  const [showDone, setShowDone] = useState(false);
  const open = notes.filter(note => note.status === "OPEN");
  const shown = showDone ? notes : open;
  return <section className={styles.panel} aria-labelledby="map-project-notes" data-testid="map-project-notes">
    <h2 id="map-project-notes">{text.heading}</h2>
    <p className={styles.muted}>{text.open(open.length)}</p>
    {problem !== undefined && <p role="alert" className={styles.problem}>{text.problem(problem)}</p>}
    {notes.length > open.length && <label className={styles.check}><input type="checkbox" checked={showDone} onChange={event => setShowDone(event.target.checked)} />
      {text.showDone}</label>}
    <ul className={styles.rows}>{shown.map(note => <li key={note.noteId} data-testid="map-project-note-row" data-status={note.status}>
      <span className={styles.noteRow}>{note.text || text.photo}{note.pending ? ` · ${text.waiting}` : ""}</span>
      <Button variant="quiet" onClick={() => onShow(note)}>{text.show}</Button>
    </li>)}</ul>
  </section>;
}
