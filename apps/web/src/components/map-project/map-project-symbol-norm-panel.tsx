"use client";

import { useState } from "react";
import type { MapProjectNormSymbols } from "@o-tid/contracts";
import { mapProjectSymbolNormEn } from "../../i18n/map-project-symbol-norm-en";
import { mapProjectSymbolNormSv } from "../../i18n/map-project-symbol-norm-sv";
import type { MapProjectSession, SymbolNormResult } from "../../lib/map-project-protocol";
import { SPRINT_BUILT_RANGE } from "@o-tid/map-revision";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { OutlineOutcome, useMapProjectBuildingOutlines } from "./use-map-project-building-outlines";
import type { useMapProjectSprintRepair } from "./use-map-project-sprint-repair";
import type { MultiItem } from "./use-map-project-multi";
import styles from "./map-project-editor.module.css";

/**
 * Ägaren 2026-11-23: «Rätta efter sprintnormen» i Granska, för en befintlig karta utan ny inläsning, i fyra steg med antal:
 * 1. symbolerna mot ISSprOM 2019-2 (`checkSymbolNorm` i Workern; ägaren rättar per symbol, alla, och lägger till saknade normsymboler,
 *    som sparas i projektet och skrivs i nästa kartversion, bara Mapper-kartor),
 * 2. kant runt husen (`buildingOutlines`), 3. förenkla trappor (`stairObjectsPlan`), 4. 520 kring flerbostadshus (`apartmentYardKeys`),
 * 5. kärr och bäckar i bebyggt, 6. stigar i vägar, 7. små kantringar (`sprint-clean.ts`, ägaren 2026-11-23).
 */
export function MapProjectSymbolNormPanel({ session, canDecide, ocad, saved, onSave, outlines, repair, onMark }: {
  session: MapProjectSession | undefined; canDecide: boolean; ocad: boolean; saved: MapProjectNormSymbols;
  onSave: (setting: MapProjectNormSymbols) => Promise<boolean>; outlines: ReturnType<typeof useMapProjectBuildingOutlines>;
  repair: ReturnType<typeof useMapProjectSprintRepair>; onMark: (items: readonly MultiItem[]) => void;
}) {
  const text = useTexts(mapProjectSymbolNormSv, mapProjectSymbolNormEn);
  const [result, setResult] = useState<SymbolNormResult>();
  const [outlinePlan, setOutlinePlan] = useState<OutlineOutcome | null>();
  const [busy, setBusy] = useState(false);
  const [told, setTold] = useState<string>();
  const check = () => new Promise<void>(resolve => { if (!session) { resolve(); return; } session.symbolNorm(next => { setResult(next); resolve(); }); });
  const survey = async () => {
    setBusy(true); setTold(undefined);
    await check();
    setOutlinePlan((await outlines.plan())?.outcome ?? null);
    await repair.search();
    setBusy(false);
  };
  const canFix = canDecide && !ocad;
  const save = async (setting: MapProjectNormSymbols, message: string) => {
    setTold(undefined);
    const ok = await onSave({ replace: [...new Set(setting.replace)], add: [...new Set(setting.add)] });
    setTold(ok ? message : text.failed);
    if (ok) setTimeout(() => void check(), 400);
  };
  const fixable = result?.issues.filter(issue => issue.fixable) ?? [];
  const found = repair.found;
  return <section className={styles.panel} aria-labelledby="map-project-symbol-norm" data-testid="map-project-symbol-norm">
    <h2 id="map-project-symbol-norm">{text.repairHeading}</h2>
    <p className={styles.muted}>{text.repairHelp}</p>
    <Button onClick={() => void survey()} disabled={!session || busy} data-testid="map-project-symbol-norm-check">{busy ? text.surveying : text.survey}</Button>
    {result && !result.sprint && <p className={styles.muted}>{text.forest}</p>}

    <p><strong>{text.step(1, text.stepSymbols)}{result?.sprint ? ` (${result.issues.length + result.missing.length})` : ""}</strong></p>
    <p className={styles.muted}>{text.help}</p>
    {result?.sprint && <>
      <p role="status" data-testid="map-project-symbol-norm-count">{result.issues.length === 0 ? text.none : text.count(result.issues.length)}</p>
      <ul className={styles.rows}>
        {result.issues.map(issue => <li key={issue.symbolId} className={styles.areaRow} data-testid="map-project-symbol-norm-issue" data-code={issue.code}>
          <span>
            <strong>{issue.code} {issue.name}</strong>: {issue.problems.map(problem => text.problem(problem as Parameters<typeof text.problem>[0])).join("; ")}.{" "}
            <a className={styles.muted} href={issue.spec.source.split(" ")[0]} target="_blank" rel="noreferrer">{text.source}</a>
            {issue.outlines && <span className={styles.muted}> {text.outlinesHint}</span>}
            {!issue.fixable && !issue.outlines && <span className={styles.muted}> {text.cannotFix}</span>}
          </span>
          {canFix && issue.fixable && <Button variant="quiet" onClick={() => void save({ ...saved, replace: [...saved.replace, issue.code] }, text.fixed)}>{text.fix}</Button>}
        </li>)}
      </ul>
      {canFix && fixable.length > 0 && <Button onClick={() => void save({ ...saved, replace: [...saved.replace, ...fixable.map(issue => issue.code)] }, text.fixed)}
        data-testid="map-project-symbol-norm-fix-all">{text.fixAll(fixable.length)}</Button>}
      {result.missing.length > 0 && <>
        <p className={styles.muted}>{text.missing(result.missing.length)} {result.missing.map(row => `${row.code} ${row.name}`).join(", ")}.</p>
        {canFix && <Button variant="quiet" onClick={() => void save({ ...saved, add: [...saved.add, ...result.missing.map(row => row.code)] }, text.added)}
          data-testid="map-project-symbol-norm-add">{text.addMissing(result.missing.length)}</Button>}
      </>}
      {!canDecide && (result.issues.length > 0 || result.missing.length > 0) && <p className={styles.muted}>{text.onlyOwner}</p>}
      {canDecide && ocad && <p className={styles.muted}>{text.ocad}</p>}
    </>}
    {canDecide && saved.replace.length > 0 && <Button variant="quiet" onClick={() => void save({ replace: [], add: saved.add }, text.fixed)}>{text.undone}</Button>}

    <p><strong>{text.step(2, text.stepOutlines)}{outlinePlan ? ` (${outlinePlan.added + outlinePlan.removed})` : ""}</strong></p>
    {outlines.available ? <>
      <p className={styles.muted}>{text.outlinesHelp}</p>
      {outlinePlan && <p role="status">{text.outlinesCount(outlinePlan.added, outlinePlan.removed)}</p>}
      <Button variant="quiet" onClick={() => { outlines.run(); setOutlinePlan(undefined); }} disabled={outlines.busy} data-testid="map-project-building-outlines">
        {outlines.busy ? text.outlinesBusy : text.outlines}</Button>
      {outlines.outcome && <p role="status" className={styles.muted}>{text.outlinesDone(outlines.outcome.added, outlines.outcome.removed, outlines.outcome.houses)}</p>}
    </> : <p className={styles.muted}>{text.outlinesNone}</p>}

    <p><strong>{text.step(3, text.stepStairs)}{found ? ` (${found.stairs.stairs})` : ""}</strong></p>
    {found && <p role="status">{text.stairsCount(found.stairs.stairs, found.stairs.steps)}</p>}
    {repair.canEdit && found && found.stairs.stairs > 0 && <Button variant="quiet" data-testid="map-project-simplify-stairs"
      onClick={() => void repair.simplifyStairs().then(count => setTold(text.stairsDone(count)))}>{text.stairsRun(found.stairs.stairs)}</Button>}

    <p><strong>{text.step(4, text.stepYards)}{found ? ` (${found.yards.length})` : ""}</strong></p>
    {found && <p role="status">{text.yardsCount(found.yards.length)}</p>}
    {found && found.yards.length > 0 && <>
      <Button variant="quiet" onClick={() => onMark(found.yards)} data-testid="map-project-yards-mark">{text.yardsMark}</Button>
      {repair.canEdit && <Button variant="quiet" onClick={() => setTold(text.yardsDone(repair.removeYards()))} data-testid="map-project-yards-remove">
        {text.yardsRemove(found.yards.length)}</Button>}
    </>}
    {([["water", 5, text.stepWater, text.waterHelp, text.waterCount, text.waterRemove], ["paths", 6, text.stepPaths, text.pathsHelp, text.pathsCount, text.pathsRemove],
      ["rings", 7, text.stepRings, text.ringsHelp, text.ringsCount, text.ringsRemove]] as const).map(([which, index, title, help, counted, remove]) => {
      const step = found?.[which];
      return <div key={which} data-testid={`map-project-clean-${which}`}>
        <p><strong>{text.step(index, title)}{step ? ` (${step.objects.length})` : ""}</strong></p>
        <p className={styles.muted}>{help}</p>
        {which === "water" && <label className={styles.muted}>{text.waterMetres}{" "}
          <input type="range" min={SPRINT_BUILT_RANGE.min} max={SPRINT_BUILT_RANGE.max} step={5} value={repair.metres}
            onChange={event => repair.setMetres(Number(event.target.value))} onPointerUp={() => void repair.search()} onKeyUp={() => void repair.search()}
            data-testid="map-project-clean-metres" /> {repair.metres} m</label>}
        {step && <p role="status">{counted(step.objects.length)}</p>}
        {step && step.objects.length > 0 && <>
          <Button variant="quiet" onClick={() => onMark(step.objects)} data-testid={`map-project-clean-${which}-mark`}>{text.yardsMark}</Button>
          {repair.canEdit && <Button variant="quiet" onClick={() => setTold(text.cleanDone(repair.clean(which)))} data-testid={`map-project-clean-${which}-remove`}>
            {remove(step.objects.length)}</Button>}
        </>}
      </div>;
    })}
    {told && <p role="status" className={styles.muted}>{told}</p>}
  </section>;
}
