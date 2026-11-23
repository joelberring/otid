"use client";

import { useState } from "react";
import type { MapProjectNormSymbols } from "@o-tid/contracts";
import { mapProjectSymbolNormEn } from "../../i18n/map-project-symbol-norm-en";
import { mapProjectSymbolNormSv } from "../../i18n/map-project-symbol-norm-sv";
import type { MapProjectSession, SymbolNormResult } from "../../lib/map-project-protocol";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectBuildingOutlines } from "./use-map-project-building-outlines";
import styles from "./map-project-editor.module.css";

/**
 * Ägaren 2026-11-23: «Symbolerna mot ISSprOM 2019-2» i Granska. Kontrollen körs i Workern (`checkSymbolNorm`) och listar de
 * använda symbolerna som avviker och normens symboler som saknas. Projektets ägare rättar dem (per symbol, alla, lägg till de
 * saknade): inställningen sparas i projektet och skrivs i nästa kartversion (bara Mapper-kartor). «Lägg kant runt husen» för alla.
 */
export function MapProjectSymbolNormPanel({ session, canDecide, ocad, saved, onSave, outlines }: {
  session: MapProjectSession | undefined; canDecide: boolean; ocad: boolean; saved: MapProjectNormSymbols;
  onSave: (setting: MapProjectNormSymbols) => Promise<boolean>; outlines: ReturnType<typeof useMapProjectBuildingOutlines>;
}) {
  const text = useTexts(mapProjectSymbolNormSv, mapProjectSymbolNormEn);
  const [result, setResult] = useState<SymbolNormResult>();
  const [checking, setChecking] = useState(false);
  const [told, setTold] = useState<string>();
  const check = () => { if (!session) return; setChecking(true); session.symbolNorm(next => { setChecking(false); setResult(next); }); };
  const canFix = canDecide && !ocad;
  const save = async (setting: MapProjectNormSymbols, message: string) => {
    setTold(undefined);
    const ok = await onSave({ replace: [...new Set(setting.replace)], add: [...new Set(setting.add)] });
    setTold(ok ? message : text.failed);
    if (ok) setTimeout(check, 400);
  };
  const fixable = result?.issues.filter(issue => issue.fixable) ?? [];
  return <section className={styles.panel} aria-labelledby="map-project-symbol-norm" data-testid="map-project-symbol-norm">
    <h2 id="map-project-symbol-norm">{text.heading}</h2>
    <p className={styles.muted}>{text.help}</p>
    <Button variant="quiet" onClick={check} disabled={!session || checking} data-testid="map-project-symbol-norm-check">{checking ? text.checking : text.check}</Button>
    {result && !result.sprint && <p className={styles.muted}>{text.forest}</p>}
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
      {canFix && fixable.length > 1 && <Button onClick={() => void save({ ...saved, replace: [...saved.replace, ...fixable.map(issue => issue.code)] }, text.fixed)}
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
    {told && <p role="status" className={styles.muted}>{told}</p>}
    {outlines.available && <>
      <p className={styles.muted}>{text.outlinesHelp}</p>
      <Button variant="quiet" onClick={() => outlines.run()} disabled={outlines.busy} data-testid="map-project-building-outlines">{outlines.busy ? text.outlinesBusy : text.outlines}</Button>
      {outlines.outcome && <p role="status" className={styles.muted}>{text.outlinesDone(outlines.outcome.added, outlines.outcome.removed, outlines.outcome.houses)}</p>}
    </>}
  </section>;
}
