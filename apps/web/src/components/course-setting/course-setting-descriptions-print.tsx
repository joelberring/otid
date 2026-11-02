"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  courseVariants, descriptionSymbols, layoutDescription, type CourseSettingDocument, type DescriptionKind, type DescriptionLayout,
  type DescriptionSymbol
} from "@o-tid/course-setting";
import { courseSettingDescriptionSv as text } from "../../i18n/course-setting-description-sv";
import { downloadText, fetchCourseSetting } from "../../lib/course-setting-api";
import {
  browserStorage, DESCRIPTION_KINDS, DESCRIPTION_LANGUAGES, readDescriptionSettings, type DescriptionSettings
} from "../../lib/course-setting-description";
import { descriptionNodes, descriptionSvg, symbolLookup } from "../../lib/course-setting-description-draw";
import { A4, BOX_SIZES_MM, copiesOf, CUT_MARK, layoutPages, MAX_COPIES, svgFileName } from "../../lib/course-setting-description-print";
import { Button, Notice } from "../ui";
import { DescriptionShapes } from "./description-svg";
import styles from "./course-setting-descriptions-print.module.css";

/** Vald bana: varianterna att skriva ut ("" = alla grenar i en beskrivning, som Purple Pen). */
type Chosen = Readonly<Record<string, readonly string[]>>;

interface Entry {
  readonly key: string;
  readonly course: string;
  readonly name: string;
  readonly variant: string;
  readonly layout: DescriptionLayout | undefined;
}

/**
 * Steg 63 (ADR-0180): `/admin/[raceId]/course-setting/descriptions`. Banor och varianter, symboler/text/båda, rutstorlek
 * och kopior väljs; beskrivningarna läggs tätt på A4 (`layoutPages`) med skärmarker och skrivs ut med webbläsaren.
 * Varje bana kan också laddas ned som SVG. Bara svart. Läser det sparade dokumentet (bara admin).
 */
export function DescriptionPrintPage({ raceId }: { raceId: string }) {
  const [document, setDocument] = useState<CourseSettingDocument | null>();
  const [failed, setFailed] = useState(false);
  const [settings, setSettings] = useState<DescriptionSettings>({ language: "sv", kind: "SYMBOLS" });
  const [chosen, setChosen] = useState<Chosen>({});
  const [boxMm, setBoxMm] = useState(6);
  const [copies, setCopies] = useState(1);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const state = await fetchCourseSetting(raceId);
      const next = (state.setting?.document ?? null) as unknown as CourseSettingDocument | null;
      setDocument(next);
      if (next) {
        setSettings(readDescriptionSettings(browserStorage(), raceId, next));
        setChosen(Object.fromEntries(next.courses.map(course => [course.id, [""]])));
      }
    } catch { setFailed(true); }
  }, [raceId]);
  useEffect(() => { void load(); }, [load]);

  const standard = document?.event.descriptionStandard ?? "2018";
  const symbols = useMemo(() => {
    try { return symbolLookup(descriptionSymbols(standard)); } catch (error) { console.error("Symbolerna misslyckades", error); return symbolLookup([] as DescriptionSymbol[]); }
  }, [standard]);
  const courses = useMemo(() => [...(document?.courses ?? [])].sort((left, right) => left.order - right.order), [document]);
  // Översynen 2026-11-02: en bana vars varianter eller beskrivning inte går att räkna fram sägs ovanför utskriften.
  const { variants, variantFailures } = useMemo(() => {
    const failures: string[] = [];
    const found = Object.fromEntries(courses.map(course => {
      try { return [course.id, document ? courseVariants(document, course.id).map(row => row.code).filter(Boolean) : []]; }
      catch (error) { console.error("Varianterna misslyckades", error); failures.push(course.name); return [course.id, []]; }
    }));
    return { variants: found, variantFailures: failures };
  }, [courses, document]);
  const entries = useMemo((): Entry[] => !document ? [] : courses.flatMap(course => (chosen[course.id] ?? []).map(variant => {
    let layout: DescriptionLayout | undefined;
    try {
      layout = layoutDescription(document, { course: course.id, ...(variant ? { variant } : {}), kind: settings.kind, language: settings.language, boxMm });
    } catch (error) { console.error("Kontrollbeskrivningen misslyckades", error); }
    return { key: `${course.id}|${variant}`, course: course.id, name: course.name, variant, layout };
  })), [document, courses, chosen, settings.kind, settings.language, boxMm]);
  const nodes = useMemo(() => new Map(entries.map(entry => [entry.key, entry.layout ? descriptionNodes(entry.layout, symbols) : []])), [entries, symbols]);
  const pages = useMemo(() => layoutPages(entries.flatMap(entry => entry.layout
    ? Array.from({ length: copies }, (_, copy) => ({ key: `${entry.key}|${copy}`, widthMm: entry.layout!.widthMm, heightMm: entry.layout!.heightMm }))
    : [])), [entries, copies]);
  const itemCount = pages.reduce((sum, page) => sum + page.items.length, 0);
  const missing = [...new Set([...variantFailures, ...entries.filter(entry => !entry.layout)
    .map(entry => `${entry.name}${entry.variant ? ` ${entry.variant}` : ""}`)])];
  const scaled = pages.some(page => page.items.some(item => item.scale < 1));

  const toggleCourse = (course: string, on: boolean) => setChosen(current => {
    const next = { ...current };
    if (on) next[course] = [""]; else delete next[course];
    return next;
  });
  const toggleVariant = (course: string, variant: string, on: boolean) => setChosen(current => {
    const rows = new Set(current[course] ?? []);
    if (on) rows.add(variant); else rows.delete(variant);
    const order = ["", ...(variants[course] ?? [])];
    const next = { ...current, [course]: order.filter(code => rows.has(code)) };
    if (next[course]!.length === 0) delete next[course];
    return next;
  });
  const allOn = courses.length > 0 && courses.every(course => chosen[course.id]);

  const back = <Link className={styles.back} href={`/admin/${raceId}/course-setting`}>{text.page.back}</Link>;
  if (failed) return <main className={styles.page}><div className={styles.controls}>{back}<Notice tone="error" role="alert"><p>{text.page.failed}</p>
    <div><Button variant="secondary" onClick={() => void load()}>{text.page.retry}</Button></div></Notice></div></main>;
  if (document === undefined) return <main className={styles.page}><div className={styles.controls}>{back}<p role="status">{text.page.loading}</p></div></main>;
  if (document === null) return <main className={styles.page}><div className={styles.controls}>{back}<p>{text.page.noSetting}</p></div></main>;
  return <main className={styles.page}>
    <div className={styles.controls}>
      {back}
      <h1>{text.page.title}</h1>
      <p>{text.page.help}</p>
      <fieldset className={styles.courses}>
        <legend>{text.page.courses}</legend>
        <label><input type="checkbox" checked={allOn} onChange={event => setChosen(event.target.checked
          ? Object.fromEntries(courses.map(course => [course.id, chosen[course.id] ?? [""]])) : {})} />{text.page.all}</label>
        {courses.map(course => <div key={course.id} className={styles.course}>
          <label><input type="checkbox" checked={Boolean(chosen[course.id])} onChange={event => toggleCourse(course.id, event.target.checked)} />{course.name}</label>
          {(variants[course.id]?.length ?? 0) > 1 && chosen[course.id] && <div className={styles.variants} role="group" aria-label={`${text.page.variants}: ${course.name}`}>
            {["", ...variants[course.id]!].map(code => <label key={code}><input type="checkbox" checked={chosen[course.id]!.includes(code)}
              onChange={event => toggleVariant(course.id, code, event.target.checked)} />{code || text.page.allBranches}</label>)}
          </div>}
        </div>)}
      </fieldset>
      <div className={styles.row}>
        <label>{text.page.kind}<select value={settings.kind} onChange={event => setSettings({ ...settings, kind: event.target.value as DescriptionKind })}>
          {DESCRIPTION_KINDS.map(value => <option key={value} value={value}>{text.settings.kinds[value]}</option>)}</select></label>
        <label>{text.page.language}<select value={settings.language} onChange={event => setSettings({ ...settings, language: event.target.value })}>
          {DESCRIPTION_LANGUAGES.map(language => <option key={language.id} value={language.id}>{text.settings.languages[language.id] ?? language.name}</option>)}</select></label>
        <label>{text.page.box}<select value={boxMm} onChange={event => setBoxMm(Number(event.target.value))}>
          {BOX_SIZES_MM.map(value => <option key={value} value={value}>{text.page.boxSize(value)}</option>)}</select></label>
        <label>{text.page.copies}<input type="number" min={1} max={MAX_COPIES} value={copies} onChange={event => setCopies(copiesOf(event.target.value))} /></label>
      </div>
      {missing.length > 0 && <Notice tone="error" role="alert">{text.page.missing(missing)}</Notice>}
      <div className={styles.row}>
        <Button onClick={() => window.print()} disabled={itemCount === 0}>{text.page.printButton}</Button>
        <span role="status">{itemCount === 0 ? text.page.none : text.page.pages(pages.length, itemCount)}</span>
      </div>
      {scaled && <Notice tone="attention">{text.page.scaled}</Notice>}
      <div className={styles.row}>
        {entries.map(entry => entry.layout ? <Button key={entry.key} variant="secondary" onClick={() => downloadText(svgFileName(entry.name, entry.variant),
          descriptionSvg(entry.layout!, symbols, `${entry.name}${entry.variant ? ` ${entry.variant}` : ""}`), "image/svg+xml;charset=utf-8")}>
          {text.page.download(`${entry.name}${entry.variant ? ` ${entry.variant}` : ""}`)}</Button>
          : <Notice key={entry.key} tone="error">{text.page.failedCourse(entry.name)}</Notice>)}
      </div>
    </div>
    <div className={styles.sheets}>
      {pages.map((page, index) => <svg key={index} className={styles.sheet} role="img" aria-label={text.page.sheet(index + 1, pages.length)}
        data-testid="description-sheet" width={`${A4.widthMm}mm`} height={`${A4.heightMm}mm`} viewBox={`0 0 ${A4.widthMm} ${A4.heightMm}`}
        fontFamily="Arial, Helvetica, sans-serif">
        <rect width={A4.widthMm} height={A4.heightMm} fill="#fff" />
        {page.items.map(item => {
          const entry = item.key.split("|").slice(0, 2).join("|");
          return <g key={item.key} data-description={entry} transform={`translate(${item.x} ${item.y})${item.scale < 1 ? ` scale(${item.scale})` : ""}`}>
            <DescriptionShapes nodes={nodes.get(entry) ?? []} />
          </g>;
        })}
        {page.cutMarks.map((mark, mi) => <line key={mi} x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} stroke="#000" strokeWidth={CUT_MARK.widthMm} />)}
      </svg>)}
    </div>
  </main>;
}
