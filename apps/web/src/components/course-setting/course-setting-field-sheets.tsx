"use client";

import { useState } from "react";
import { courseSettingFieldEn } from "../../i18n/course-setting-notes-en";
import { offlineEn } from "../../i18n/course-setting-collab-en";
import { useTexts } from "../language-provider";
import { createPortal } from "react-dom";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import { courseSettingFieldSv } from "../../i18n/course-setting-field-sv";
import { offlineSv } from "../../i18n/course-setting-offline-sv";
import { F_QUICK, G_CHOICES, gChoiceOf, gSymbolId } from "../../lib/course-setting-field";
import css from "./course-setting-field.module.css";

export type Photo = { mediaType: "image/jpeg"; base64: string };

/** Bladet "Uppgifter": kolumn F (höjd) och G (läge) med stora knappar. */
export function DetailsSheet({ label, boxes, standard, onSave, onClose }: {
  label: string; boxes: CourseSettingDocument["controls"][string]["descriptions"]; standard: CourseSettingDocument["event"]["descriptionStandard"];
  onSave: (f: string, g: string | null) => void; onClose: () => void;
}) {
  const text = useTexts(courseSettingFieldSv, courseSettingFieldEn);
  const [f, setF] = useState(boxes.find(box => box.box === "F")?.text ?? "");
  const currentG = boxes.find(box => box.box === "G")?.ref;
  const [g, setG] = useState<string | null>(currentG ?? null);
  const unknownG = currentG && !gChoiceOf(currentG) && g === currentG;
  // Över arbetsytan (och bladet nertill), därför direkt i body.
  return createPortal(<div className={css.sheet} role="dialog" aria-modal="true" aria-label={text.detailsTitle(label)}>
    <h2>{text.detailsTitle(label)}</h2>
    <label className={css.field}>{text.f}
      <input type="text" inputMode="decimal" value={f} onChange={event => setF(event.target.value)} />
    </label>
    <div className={css.grid} role="group" aria-label={text.fQuick}>
      {F_QUICK.map(value => <button key={value} type="button" className={css.big} aria-pressed={f === value} onClick={() => setF(value)}>{value}</button>)}
    </div>
    <fieldset className={css.fieldset}>
      <legend>{text.g}{unknownG ? ` (${currentG})` : ""}</legend>
      <div className={css.grid}>
        {G_CHOICES.map(row => {
          const ref = gSymbolId(row.choice, standard);
          return <button key={row.choice} type="button" className={css.big} disabled={!ref} aria-pressed={g === ref}
            onClick={() => setG(ref ?? null)}>{row.label}</button>;
        })}
        <button type="button" className={css.big} aria-pressed={g === null} onClick={() => setG(null)}>{text.gNone}</button>
      </div>
    </fieldset>
    <div className={css.barRow}>
      <button type="button" className={css.big} data-primary="true" onClick={() => onSave(f, g)}>{text.save}</button>
      <button type="button" className={css.big} onClick={onClose}>{text.close}</button>
    </div>
  </div>, document.body);
}

/**
 * Steg 67: "Notis här" med en hand. Kameran öppnas direkt av knappen (filväljaren finns i raden, se `useFieldMode`);
 * bladet visar fotot, en valfri text och stora knappar längst ned. Med foto men utan text blir texten "Foto".
 */
export function NoteHereSheet({ target, photo, photoMessage, busy, onPhoto, onSave, onClose }: {
  target: string; photo: Photo | null; photoMessage: string | undefined; busy: boolean; onPhoto: () => void;
  onSave: (text: string) => void; onClose: () => void;
}) {
  const copy = useTexts(offlineSv, offlineEn);
  const [value, setValue] = useState("");
  const ready = Boolean(value.trim() || photo);
  return createPortal(<div className={css.sheet} role="dialog" aria-modal="true" aria-label={copy.noteHere.heading(target)}
    data-testid="course-setting-note-here">
    <h2>{copy.noteHere.heading(target)}</h2>
    {photo ? <div className={css.photoRow}>
      <img className={css.photo} src={`data:${photo.mediaType};base64,${photo.base64}`} alt={copy.noteHere.photoReady} />
      <span>{copy.noteHere.photoReady}</span>
    </div> : null}
    {photoMessage && <p className={css.line} data-problem="true" role="alert">{photoMessage}</p>}
    <label className={css.field}>{copy.noteHere.text}
      <textarea className={css.textarea} value={value} maxLength={2000} rows={2} onChange={event => setValue(event.target.value)} />
    </label>
    <div className={css.barRow}>
      <button type="button" className={css.big} onClick={onPhoto}>{photo ? copy.noteHere.retake : copy.noteHere.takePhoto}</button>
      <button type="button" className={css.big} onClick={onClose}>{copy.noteHere.cancel}</button>
    </div>
    <button type="button" className={css.big} data-primary="true" disabled={!ready || busy}
      onClick={() => onSave(value.trim() || copy.noteHere.photoOnly)}>{copy.noteHere.save}</button>
  </div>, document.body);
}
