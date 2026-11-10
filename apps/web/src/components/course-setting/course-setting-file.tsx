"use client";

import { useRef, useState } from "react";
import { coursePropertiesEn } from "../../i18n/course-setting-course-en";
import { courseSettingEn, type CourseSettingTexts } from "../../i18n/course-setting-en";
import { useTexts, useLocale } from "../language-provider";
import { COURSE_SETTING_PPEN_MAX_BYTES, type CourseSettingRevisions } from "@o-tid/contracts";
import {
  CourseSettingEditError, layoutCoursePage, paperImageHashes, ppenWithPaperLayout, readPpen, writePpen, type CourseSettingDocument, type PpenReadWarning
} from "@o-tid/course-setting";
import type { MapGeoreference } from "@o-tid/map-file";
import { courseSettingSv } from "../../i18n/course-setting-sv";
import { coursePropertiesSv } from "../../i18n/course-setting-properties-sv";
import { iofCourseFile } from "../../lib/course-setting-iof";
import { courseSettingBase, downloadText, fetchCourseSettingRevisions } from "../../lib/course-setting-api";
import { paperImageBase64 } from "../../lib/course-setting-paper-api";
import { Button, Notice } from "../ui";
import styles from "./course-setting.module.css";

export interface ReadFile { readonly document: CourseSettingDocument; readonly warnings: readonly PpenReadWarning[]; readonly fileName: string;
  readonly ppen: string }

/** Läser en vald .ppen i webbläsaren (ADR-0177). Ger dokumentet eller ett begripligt fel. */
export async function readChosenPpen(file: File, text: CourseSettingTexts): Promise<ReadFile | { error: string }> {
  if (file.size > COURSE_SETTING_PPEN_MAX_BYTES) return { error: text.file.tooLarge };
  const ppen = await file.text();
  try {
    const { document, warnings } = readPpen(ppen);
    return { document, warnings, fileName: file.name.slice(0, 200) || "banlaggning.ppen", ppen };
  } catch (error) {
    if (error instanceof CourseSettingEditError) return { error: text.file.invalid };
    throw error;
  }
}

/** Filväljaren för .ppen (inläsning ersätter dokumentet; `onRead` frågar och sparar). */
export function PpenImport({ onRead, busy, label: chosenLabel }: { onRead: (file: ReadFile) => Promise<void>; busy: boolean; label?: string }) {
  const text = useTexts(courseSettingSv, courseSettingEn), label = chosenLabel ?? text.file.import;
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>();
  const [reading, setReading] = useState(false);
  async function read() {
    const file = input.current?.files?.[0];
    if (!file) return;
    setMessage(undefined); setReading(true);
    try {
      const result = await readChosenPpen(file, text);
      if ("error" in result) { setMessage(result.error); return; }
      await onRead(result);
      if (input.current) input.current.value = "";
    } catch (error) {
      console.error("Filen kunde inte läsas", error);
      setMessage(text.file.invalid);
    } finally { setReading(false); }
  }
  return <form className={styles.row} onSubmit={event => { event.preventDefault(); void read(); }}>
    <label>{text.file.importLabel}<input ref={input} className={styles.fileInput} type="file" accept=".ppen,application/xml,text/xml"
      disabled={busy || reading} data-testid="course-setting-ppen" /></label>
    <Button type="submit" variant="secondary" disabled={busy || reading}>{label}</Button>
    {reading && <p role="status" className={styles.muted}>{text.file.reading}</p>}
    {message && <p role="alert" className={styles.muted}>{message}</p>}
  </form>;
}

/** Fil: läs in, ladda ned som .ppen (writePpen), den inlästa filen orörd och tidigare versioner. */
export function FilePanel({ raceId, document, original, busy, onImport, onRestore, mapBounds, georeference }: {
  raceId: string; document: CourseSettingDocument; original: { fileName: string } | null; busy: boolean;
  onImport: (file: ReadFile) => Promise<void>; onRestore: (version: number) => Promise<boolean>;
  /** ADR-0190: kartfilens yta och georeferens för IOF-exporten. */
  mapBounds?: { minX: number; minY: number; maxX: number; maxY: number } | undefined; georeference?: MapGeoreference | null | undefined;
}) {
  const locale = useLocale();
  const propsText = useTexts(coursePropertiesSv, coursePropertiesEn);
  const text = useTexts(courseSettingSv, courseSettingEn);
  const [revisions, setRevisions] = useState<CourseSettingRevisions["revisions"]>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  async function showRevisions() {
    try { setRevisions((await fetchCourseSettingRevisions(raceId)).revisions); } catch { setMessage({ tone: "error", text: text.loadFailed }); }
  }
  async function download() {
    const title = document.event.title.trim().replace(/[^\p{L}\p{N} ._-]/gu, "_") || "banlaggning";
    // Papperet (ADR-0197): beskrivningen (utplacerad eller automatisk), texterna och bilderna skrivs som Purple Pens
    // specialobjekt på motsvarande ställe i kartan. Bilderna hämtas ur bildlagret; en som inte går att hämta utelämnas.
    const images = new Map<string, string>();
    for (const sha of paperImageHashes(document)) {
      try { images.set(sha, await paperImageBase64(raceId, sha)); } catch (error) { console.error("Bilden kunde inte hämtas till .ppen", error); }
    }
    const withPaper = ppenWithPaperLayout(document, course => {
      try {
        const page = layoutCoursePage(document, { course, mapBounds })[0];
        return page ? { ...page, page: { x: 0, y: 0, width: page.paper.widthMm, height: page.paper.heightMm } } : undefined;
      } catch (error) { console.error("Banans sida kunde inte läggas ut", error); return undefined; }
    }, { images });
    downloadText(`${title}.ppen`, writePpen(withPaper));
  }
  function downloadIof() {
    try {
      const file = iofCourseFile(document, { mapBounds, georeference });
      downloadText(file.fileName, file.xml);
    } catch (error) {
      console.error("IOF XML kunde inte skrivas", error);
      setMessage({ tone: "error", text: text.file.failed });
    }
  }
  return <section className={styles.panel} aria-labelledby="course-setting-file">
    <h2 id="course-setting-file">{text.file.heading}</h2>
    <PpenImport onRead={onImport} busy={busy} />
    <p className={styles.muted}>{text.file.importHelp}</p>
    <div className={styles.row}>
      <Button variant="secondary" onClick={() => void download()}>{text.file.download}</Button>
      {original && <a href={`${courseSettingBase(raceId)}/course-setting/original`} download>{text.file.downloadOriginal(original.fileName)}</a>}
    </div>
    <div className={styles.row}>
      <Button variant="secondary" onClick={downloadIof} data-testid="course-setting-iof">{propsText.iof.download}</Button>
    </div>
    <p className={styles.muted}>{propsText.iof.help}</p>
    <p className={styles.muted}>{propsText.iof.ocad}</p>
    {!revisions && <div className={styles.row}><Button variant="quiet" onClick={() => void showRevisions()}>{text.revisions.show}</Button></div>}
    {revisions && <>
      <h3 className={styles.muted}>{text.revisions.heading}</h3>
      {revisions.length === 0 ? <p className={styles.muted}>{text.revisions.none}</p> : <ul className={styles.revisions}>
        {revisions.map(revision => <li key={revision.version}>
          <span>{text.revisions.kind[revision.kind]}: {text.revisions.row(revision.version, new Date(revision.createdAt).toLocaleString(locale,
            { dateStyle: "short", timeStyle: "short" }), revision.createdBy.displayName, revision.courses, revision.controls)}</span>
          <Button variant="quiet" disabled={busy} onClick={() => void (async () => {
            if (!window.confirm(text.revisions.restoreConfirm(revision.version))) return;
            const ok = await onRestore(revision.version);
            setMessage(ok ? { tone: "ok", text: text.revisions.restored(revision.version) } : { tone: "error", text: text.revisions.failed });
            if (ok) await showRevisions();
          })()}>{text.revisions.restore}</Button>
        </li>)}
      </ul>}
    </>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </section>;
}
