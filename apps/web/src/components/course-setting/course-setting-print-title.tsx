"use client";

import { useState } from "react";
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
  canEdit: boolean; onChange: (useFileTitle: boolean) => Promise<unknown> }) {
  const text = useTexts(coursePrintSv, coursePrintEn).page;
  // Valet syns direkt medan det sparas; sedan gäller det sparade dokumentet (som också ritar arken).
  const [choice, setChoice] = useState<boolean>();
  if (!raceTitle || !fileTitleDiffers(document, raceTitle)) return null;
  const file = document.event.title.replace(/\|/g, " ").trim();
  const chosen = choice === undefined ? document : { ...document, event: { ...document.event, printFileTitle: choice } };
  const shown = printedTitle(chosen, raceTitle).replace(/\|/g, " ").trim();
  const useFile = shown === file;
  const change = (value: boolean) => { setChoice(value); void onChange(value).finally(() => setChoice(undefined)); };
  return <div data-testid="print-title">
    <Notice tone="attention">
      <p><strong>{text.titleHeading(shown)}</strong> {useFile ? text.titleRace(raceTitle) : text.titleFile(file)}</p>
      <label className={styles.check}><input type="checkbox" checked={useFile} disabled={!canEdit} onChange={event => change(event.target.checked)} />
        {text.titleUseFile}</label>
    </Notice>
  </div>;
}
