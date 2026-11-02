"use client";

import { useMemo, useState } from "react";
import type { CourseSettingDocument, CourseSummary, CourseVariant } from "@o-tid/course-setting";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { courseSettingUxSv as ux } from "../../i18n/course-setting-ux-sv";
import { courseTree, type TreeBranch, type TreeRow } from "../../lib/course-setting-forks";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { controlLabel } from "../../lib/course-setting-text";
import { Button } from "../ui";
import styles from "./course-setting-ux.module.css";

/**
 * ADR-0180 beslut 14: kontrollistan i fliken Banor. I en bana: kontrollerna som ett träd där gafflingens grenar står
 * bredvid varandra (som Purple Pens topologi), med bokstav överst; ett klick på grenen arbetar i den, ett klick på en
 * kontroll väljer den. Under trädet varianterna med kod, antal kontroller, längd och en liten bild. I Alla kontroller:
 * alla kontroller, filtret "Bara oanvända" och "Ta bort alla oanvända".
 */
export function ControlList({ document, summaries, view, variant, branch, selected, unused, readOnly, onSelect, onBranch, onVariant, onRemoveUnused }: {
  document: CourseSettingDocument; summaries: readonly CourseSummary[]; view: string; variant: string | undefined; branch: string | undefined;
  /** Vald banans kontroll (i en bana) eller kontroll (Alla kontroller). */
  selected: string | undefined;
  unused: readonly string[]; readOnly: boolean;
  onSelect: (target: { control: string; courseControl?: string | undefined }) => void;
  onBranch: (branch: TreeBranch) => void; onVariant: (code: string | undefined) => void; onRemoveUnused: () => void;
}) {
  if (view === ALL_CONTROLS) return <AllControls document={document} selected={selected} unused={unused} readOnly={readOnly} onSelect={onSelect}
    onRemoveUnused={onRemoveUnused} />;
  const course = document.courses.find(row => row.id === view);
  if (!course) return null;
  return <CourseControls document={document} summary={summaries.find(row => row.course === view)} name={course.name} view={view} variant={variant}
    branch={branch} selected={selected} onSelect={onSelect} onBranch={onBranch} onVariant={onVariant} />;
}

function CourseControls({ document, summary, name, view, variant, branch, selected, onSelect, onBranch, onVariant }: {
  document: CourseSettingDocument; summary: CourseSummary | undefined; name: string; view: string; variant: string | undefined;
  branch: string | undefined; selected: string | undefined;
  onSelect: (target: { control: string; courseControl?: string | undefined }) => void; onBranch: (branch: TreeBranch) => void;
  onVariant: (code: string | undefined) => void;
}) {
  const tree = useMemo(() => { try { return courseTree(document, view); } catch (error) { console.error("Banans träd", error); return []; } },
    [document, view]);
  const variants = summary?.variants ?? [];
  let ordinal = 0;
  const renderRows = (rows: readonly TreeRow[]): React.ReactNode => rows.map(row => {
    if (row.kind === "control") {
      const kind = document.controls[row.control]?.kind;
      const number = kind === "NORMAL" ? String(++ordinal) : "";
      return <li key={row.courseControl}><button type="button" className={styles.row} aria-current={selected === row.courseControl}
        data-testid="course-setting-tree-control" onClick={() => onSelect({ control: row.control, courseControl: row.courseControl })}>
        <span className={styles.ordinal}>{number}</span><span>{row.label}</span></button></li>;
    }
    const start = ordinal;
    return <li key={`fork-${row.at}`}>
      <div className={styles.fork} role="group" aria-label={row.split === "LOOP" ? ux.forks.loop : text.tools.fork}>
        {row.branches.map(item => {
          ordinal = start;
          return <div key={item.start} className={styles.branch} data-active={branch === item.start || undefined} data-testid="course-setting-branch">
            <button type="button" className={styles.branchHead} aria-pressed={branch === item.start} title={ux.forks.work(item.letter)}
              aria-label={ux.forks.work(item.letter)} onClick={() => onBranch(item)}>{item.letter}</button>
            {item.rows.length === 0 ? <p className={styles.empty}>{ux.forks.emptyBranch}</p> : <ul className={styles.tree}>{renderRows(item.rows)}</ul>}
          </div>;
        })}
      </div>
      <p className={styles.join}>{row.split === "LOOP" ? ux.forks.loopJoin(row.joinLabel) : ux.forks.join(row.joinLabel)}</p>
    </li>;
  });
  return <section className={styles.group} aria-labelledby="course-setting-control-list" data-testid="course-setting-control-list">
    <h2 id="course-setting-control-list" className={styles.listHeading}>{ux.controls.courseHeading(name)}</h2>
    {tree.length === 0 ? <p className={styles.hint}>{ux.controls.empty}</p> : <ul className={styles.tree}>{renderRows(tree)}</ul>}
    {variants.length > 1 && <>
      <h3 className={styles.listHeading}>{ux.forks.variants}</h3>
      <ul className={styles.variants}>
        <li><button type="button" className={styles.variant} aria-pressed={!variant} onClick={() => onVariant(undefined)}>
          <span /><span><strong>{ux.forks.allVariants}</strong></span></button></li>
        {variants.map(row => <li key={row.code}><button type="button" className={styles.variant} aria-pressed={variant === row.code}
          data-testid="course-setting-variant" onClick={() => onVariant(row.code)}>
          <VariantPreview document={document} variant={row} />
          <span><strong>{row.code}</strong><span>{ux.forks.variant(row.controlCodes.length, text.courses.length(row.lengthMeters, row.lengthMeters))}</span>
            <span>{row.controlCodes.join("–")}</span></span>
        </button></li>)}
      </ul>
    </>}
  </section>;
}

/** En liten bild av variantens väg (kontrollernas lägen, normerade). */
function VariantPreview({ document, variant }: { document: CourseSettingDocument; variant: CourseVariant }) {
  const points = variant.courseControls.flatMap(id => {
    const control = document.courseControls[id] ? document.controls[document.courseControls[id].control] : undefined;
    return control ? [control.at] : [];
  });
  if (points.length < 2) return <svg className={styles.preview} aria-hidden="true" />;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(50 / Math.max(1e-6, maxX - minX), 34 / Math.max(1e-6, maxY - minY));
  const at = (p: { x: number; y: number }) => `${(3 + (p.x - minX) * scale + (50 - (maxX - minX) * scale) / 2).toFixed(1)},${(3 + (maxY - p.y) * scale + (34 - (maxY - minY) * scale) / 2).toFixed(1)}`;
  return <svg className={styles.preview} viewBox="0 0 56 40" aria-hidden="true">
    <polyline points={points.map(at).join(" ")} fill="none" stroke="rgb(170, 0, 170)" strokeWidth="1.5" strokeLinejoin="round" />
    {points.map((p, index) => <circle key={index} cx={at(p).split(",")[0]} cy={at(p).split(",")[1]} r="1.8" fill="white" stroke="rgb(170, 0, 170)" strokeWidth="1" />)}
  </svg>;
}

function AllControls({ document, selected, unused, readOnly, onSelect, onRemoveUnused }: {
  document: CourseSettingDocument; selected: string | undefined; unused: readonly string[]; readOnly: boolean;
  onSelect: (target: { control: string }) => void; onRemoveUnused: () => void;
}) {
  const [onlyUnused, setOnlyUnused] = useState(false);
  const unusedSet = new Set(unused);
  const rows = useMemo(() => Object.values(document.controls).sort((a, b) => kindRank(a.kind) - kindRank(b.kind)
    || (Number(a.code) - Number(b.code)) || (a.code ?? "").localeCompare(b.code ?? "") || Number(a.id) - Number(b.id)), [document]);
  const shown = onlyUnused ? rows.filter(row => unusedSet.has(row.id)) : rows;
  return <section className={styles.group} aria-labelledby="course-setting-control-list" data-testid="course-setting-control-list">
    <h2 id="course-setting-control-list" className={styles.listHeading}>{ux.controls.heading}</h2>
    <div className={styles.dialogActions}>
      <label className={styles.check}><input type="checkbox" checked={onlyUnused} onChange={event => setOnlyUnused(event.target.checked)} />
        {ux.controls.onlyUnused}</label>
      <strong data-testid="course-setting-unused-count">{ux.controls.unusedCount(unused.length)}</strong>
      {!readOnly && unused.length > 0 && <Button variant="secondary" onClick={onRemoveUnused}>{ux.controls.removeUnused}</Button>}
    </div>
    {onlyUnused && unused.length === 0 ? <p className={styles.hint}>{ux.controls.noUnused}</p> : <ul className={styles.controlList}>
      {shown.map(row => <li key={row.id}><button type="button" className={styles.row} aria-current={selected === row.id}
        onClick={() => onSelect({ control: row.id })}>
        <span>{controlLabel(document, row.id)}</span>{unusedSet.has(row.id) && <span className={styles.tag}>{ux.controls.unused}</span>}
      </button></li>)}
    </ul>}
  </section>;
}

const KIND_RANK: Record<string, number> = { START: 0, MAP_ISSUE: 1, NORMAL: 2, CROSSING_POINT: 3, MAP_EXCHANGE: 4, FINISH: 5 };
const kindRank = (kind: string) => KIND_RANK[kind] ?? 9;
