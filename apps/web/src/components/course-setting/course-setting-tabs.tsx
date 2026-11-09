"use client";

import type React from "react";
import { courseSettingTabsEn } from "../../i18n/course-setting-layout-en";
import { useTexts } from "../language-provider";
import Link from "next/link";
import { courseSettingTabsSv } from "../../i18n/course-setting-layout-sv";
import styles from "./course-setting-tabs.module.css";

export type CourseSettingTab = "SETTING" | "LAYOUT" | "PRINT";

/**
 * ADR-0217 beslut 1: flikarna i banläggningen. Banläggning (kartan och banorna), Layout (papperet) och Utskrift (vad, hur
 * många, vart). `onLeave` körs före bytet (editorn skickar det osparade först).
 */
export function CourseSettingTabs({ raceId, current, onLeave, className }: { raceId: string; current: CourseSettingTab;
  onLeave?: ((href: string) => void) | undefined; className?: string | undefined }) {
  const text = useTexts(courseSettingTabsSv, courseSettingTabsEn);
  const tabs: [CourseSettingTab, string, string][] = [["SETTING", text.setting, ""], ["LAYOUT", text.layout, "/layout"], ["PRINT", text.print, "/print"]];
  return <nav className={`${styles.tabs} ${className ?? ""}`} aria-label={text.label} data-testid="course-setting-tabs">
    {tabs.map(([id, label, path]) => {
      const href = `/admin/${raceId}/course-setting${path}`;
      return <Link key={id} href={href} className={styles.tab} aria-current={id === current ? "page" : undefined} data-testid={`course-setting-tab-${id.toLowerCase()}`}
        {...(onLeave && id !== current ? { onClick: (event: React.MouseEvent) => { event.preventDefault(); onLeave(href); } } : {})}>{label}</Link>;
    })}
  </nav>;
}
