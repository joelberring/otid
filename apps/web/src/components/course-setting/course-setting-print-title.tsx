"use client";

import { fileTitleDiffers, printedTitle, type CourseSettingDocument } from "@o-tid/course-setting";
import { coursePrintEn } from "../../i18n/course-setting-print-en";
import { coursePrintSv } from "../../i18n/course-setting-print-sv";
import { useTexts } from "../language-provider";
import { Notice } from "../ui";
import styles from "./course-setting-print-page.module.css";

/**
 * Användartestet 2026-11-12: rubriken på kartorna är tävlingens namn i O-Tid, inte titeln i den inlästa .ppen-filen. När
 * filen har en annan titel säger utskriften det innan PDF:en skapas, och den som får ändra kan välja filens titel i stället
 * (sparas i banläggningen, `event.printFileTitle`). Samma rubrik i förhandsvisningen, webbläsarens utskrift och PDF:en.
 */
export function PrintTitleNotice({ document, raceTitle, canEdit, onChange }: { document: CourseSettingDocument; raceTitle: string | undefined;
  canEdit: boolean; onChange: (useFileTitle: boolean) => void }) {
  const text = useTexts(coursePrintSv, coursePrintEn).page;
  if (!raceTitle || !fileTitleDiffers(document, raceTitle)) return null;
  const file = document.event.title.replace(/\|/g, " ").trim();
  const shown = printedTitle(document, raceTitle).replace(/\|/g, " ").trim();
  const useFile = shown === file;
  return <div data-testid="print-title">
    <Notice tone="attention">
      <p><strong>{text.titleHeading(shown)}</strong> {useFile ? text.titleRace(raceTitle) : text.titleFile(file)}</p>
      <label className={styles.check}><input type="checkbox" checked={useFile} disabled={!canEdit} onChange={event => onChange(event.target.checked)} />
        {text.titleUseFile}</label>
    </Notice>
  </div>;
}
