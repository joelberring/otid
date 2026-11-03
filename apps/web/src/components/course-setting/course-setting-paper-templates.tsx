"use client";

import { useEffect, useState } from "react";
import type { PaperLibrary } from "@o-tid/contracts";
import {
  applyPaperTemplate, paperLayoutOf, paperTemplateFromCourse, validatePaperTemplate, type CourseSettingDocument, type CourseSettingEdit, type PaperTemplate
} from "@o-tid/course-setting";
import { paperSpaceSv as text } from "../../i18n/course-setting-paper-sv";
import { paperLayoutEdit } from "../../lib/course-setting-paper";
import { deletePaperLibrary, fetchPaperLibrary, savePaperLibrary } from "../../lib/course-setting-paper-api";
import { Button } from "../ui";
import styles from "./course-setting-print-page.module.css";

const newTemplateId = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/**
 * ADR-0197: mallarna för papperet. Banans mall (banan ärver mallens element), spara banans papper som ny mall, använd mallen
 * på alla valda banor, uppdatera eller ta bort den, och kontots bibliotek för andra tävlingar.
 */
export function PaperTemplatesSection({ raceId, document, course, courses, readOnly, onSave }: {
  raceId: string; document: CourseSettingDocument; course: string; courses: readonly { id: string; name: string }[]; readOnly: boolean;
  onSave: (edits: CourseSettingEdit[], done?: string) => Promise<boolean>;
}) {
  const templates = document.event.paperTemplates ?? [];
  const current = templates.find(row => row.id === paperLayoutOf(document, course).template);
  const [name, setName] = useState(text.templates.defaultName);
  const [library, setLibrary] = useState<PaperLibrary>();
  const [libraryState, setLibraryState] = useState<"none" | "reading" | "ready" | "failed">("none");
  useEffect(() => {
    if (readOnly || libraryState !== "none") return;
    setLibraryState("reading");
    fetchPaperLibrary(raceId).then(value => { setLibrary(value); setLibraryState("ready"); }, error => { console.error("Biblioteket", error); setLibraryState("failed"); });
  }, [raceId, readOnly, libraryState]);
  const users = (id: string) => Object.values(document.event.paperLayouts ?? {}).filter(layout => layout.template === id).length;
  const use = (id: string, template: PaperTemplate | undefined) => paperLayoutEdit(id, applyPaperTemplate(document, id, template));

  async function saveAs() {
    const template = paperTemplateFromCourse(document, course, newTemplateId(), name.trim() || text.templates.defaultName);
    await onSave([{ type: "PUT_PAPER_TEMPLATE", template }, use(course, template)]);
  }
  const [note, setNote] = useState<string>();
  async function toLibrary(template: PaperTemplate) {
    try { setLibrary(await savePaperLibrary(raceId, template)); setNote(text.templates.librarySaved); }
    catch (error) { console.error("Biblioteket", error); setLibraryState("failed"); }
  }
  async function fromLibrary(row: PaperLibrary["templates"][number]) {
    let template: PaperTemplate;
    try { template = validatePaperTemplate({ ...row.template, name: row.name }); } catch (error) { console.error("Mallen i biblioteket", error); setLibraryState("failed"); return; }
    // Samma id med annat innehåll i den här tävlingen: ny kopia.
    const clash = templates.find(item => item.id === template.id);
    const copy = clash && JSON.stringify(clash) !== JSON.stringify(template) ? { ...template, id: newTemplateId() } : template;
    await onSave([{ type: "PUT_PAPER_TEMPLATE", template: copy }, use(course, copy)]);
  }
  return <fieldset className={styles.stack} disabled={readOnly} data-testid="paper-templates">
    <legend><strong>{text.templates.heading}</strong></legend>
    <p className={styles.muted}>{text.templates.help}</p>
    <div className={styles.row}>
      <label className={styles.field}>{text.templates.use}<select value={current?.id ?? ""} data-testid="paper-template"
        onChange={event => void onSave([use(course, templates.find(row => row.id === event.target.value))])}>
        <option value="">{text.templates.noTemplate}</option>
        {templates.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      {current && <span className={styles.muted} data-testid="paper-template-users">{text.templates.users(users(current.id))}</span>}
    </div>
    {current && <div className={styles.row}>
      <Button variant="secondary" data-testid="paper-template-apply-all"
        onClick={() => void onSave(courses.filter(row => row.id !== course).map(row => use(row.id, current)))}>{text.templates.applyAll}</Button>
      <Button variant="quiet" data-testid="paper-template-update" onClick={() => {
        const template = paperTemplateFromCourse(document, course, current.id, current.name);
        void onSave([{ type: "PUT_PAPER_TEMPLATE", template }, use(course, template)]);
      }}>{text.templates.update}</Button>
      <Button variant="quiet" onClick={() => { if (window.confirm(text.templates.removeConfirm(current.name, users(current.id)))) void onSave([{ type: "DELETE_PAPER_TEMPLATE", id: current.id }]); }}>
        {text.templates.remove}</Button>
      {!readOnly && <Button variant="quiet" data-testid="paper-template-to-library" onClick={() => void toLibrary(current)}>{text.templates.toLibrary}</Button>}
    </div>}
    <div className={styles.row}>
      <label className={styles.field}>{text.templates.name}<input className={styles.medium} value={name} maxLength={80} onChange={event => setName(event.target.value)}
        data-testid="paper-template-name" /></label>
      <Button variant="secondary" onClick={() => void saveAs()} data-testid="paper-template-save">{text.templates.saveAs}</Button>
    </div>
    {!readOnly && <div className={styles.stack} data-testid="paper-library">
      <strong>{text.templates.library}</strong>
      {note && <p role="status" className={styles.muted} data-testid="paper-library-note">{note}</p>}
      {libraryState === "failed" && <p className={styles.paperWarning}>{text.templates.libraryFailed}</p>}
      {library && library.templates.length === 0 && <p className={styles.muted}>{text.templates.libraryEmpty}</p>}
      {library && library.templates.length > 0 && <ul className={styles.paperRows}>{library.templates.map(row => <li key={row.id} data-testid="paper-library-row">
        <strong>{row.name}</strong>
        <Button variant="secondary" onClick={() => void fromLibrary(row)}>{text.templates.fromLibrary}</Button>
        <Button variant="quiet" onClick={() => void deletePaperLibrary(raceId, row.id).then(setLibrary, error => { console.error("Biblioteket", error); setLibraryState("failed"); })}>
          {text.templates.deleteFromLibrary}</Button>
      </li>)}</ul>}
    </div>}
  </fieldset>;
}
