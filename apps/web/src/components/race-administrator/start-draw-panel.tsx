"use client";

import { useEffect } from "react";
import type { StartDrawPreviewResponse } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import { startDrawSv as text } from "../../i18n/start-draw-sv";
import { formatClockTime } from "../../lib/clock-time";
import { Button, Notice, Section, Table } from "../ui";
import type { Workspace } from "./workspace-state";
import { courseVariantsSv as variantText } from "../../i18n/course-variants-sv";

/** Gafflad klass (ADR-0169 beslut 2): lottningen visar löparnas varianter. */
const forked = (raceClass: { slots: readonly { entry: { variantCode: string | null } | null }[] }) =>
  raceClass.slots.some(slot => slot.entry?.variantCode);

/**
 * Lottning under Start (PLAN.md steg 9): startsätt, intervall, vakanser och "Lotta" per klass,
 * första start och klubbseparering gemensamt. "Visa lottning" visar startlistan som den blir;
 * "Spara lottningen" sparar exakt den. Befintliga starttider ersätts bara efter en tydlig fråga.
 */
export function StartDrawPanel({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { authenticated, busy, data, disabled, drawAttempt, drawClubSeparation, drawError, drawFirst, drawPreview, drawRows,
    drawSaved, drawSetup, changeDrawRow, changeDrawSettings, loadDrawSetup, pending, previewDraw, raceId, unknown } = ws;
  const stale = !drawSetup || (data !== undefined && drawSetup.snapshotVersion < data.snapshotVersion);
  useEffect(() => {
    if (visible && authenticated && data && !busy && !pending.current && stale && !drawError) void loadDrawSetup();
  }, [visible, authenticated, data, busy, stale, drawError]);
  const locked = disabled || !!drawPreview;
  return <Section id={`start-draw-${raceId}`} title={text.title} help={text.help}>
    {drawSaved && <Notice tone="ok" role="status">{drawSaved}</Notice>}
    {drawError && <Notice tone="error" role="alert"><p>{drawError}</p>
      {!drawSetup && <div><Button variant="secondary" disabled={busy} onClick={() => void loadDrawSetup()}>{text.load}</Button></div>}</Notice>}
    {!drawSetup && !drawError && <p role="status" className={styles.workflowHelp}>{text.loading}</p>}
    {drawSetup && <form className={styles.drawForm} onSubmit={event => { event.preventDefault(); void previewDraw(); }}>
      <div className={styles.drawSettings}>
        <label>{text.first}<input value={drawFirst} inputMode="numeric" autoComplete="off" placeholder={text.firstExample} required
          disabled={locked} onChange={event => changeDrawSettings({ first: event.target.value })} /></label>
        <label className={styles.drawCheck}><input type="checkbox" checked={drawClubSeparation} disabled={locked}
          onChange={event => changeDrawSettings({ clubSeparation: event.target.checked })} />{text.clubSeparation}</label>
      </div>
      <Table className={styles.drawTable}>
        <thead><tr>
          <th scope="col">{text.draw}</th><th scope="col">{text.className}</th><th scope="col">{text.method}</th>
          <th scope="col">{text.interval}</th><th scope="col">{text.vacancies}</th>
        </tr></thead>
        <tbody>{drawSetup.classes.map(raceClass => {
          const row = drawRows[raceClass.id];
          if (!row) return null;
          const timed = row.method === "MINUTE";
          return <tr key={raceClass.id} data-selected={row.selected ? "true" : undefined}>
            <td className={styles.drawSelectCell}><input type="checkbox" aria-label={text.drawClass(raceClass.name)} checked={row.selected}
              disabled={locked} onChange={event => changeDrawRow(raceClass.id, { selected: event.target.checked })} /></td>
            <th scope="row" className={styles.drawClassCell}>{raceClass.name}
              <span className={styles.drawClassFacts}>{text.entries}: {raceClass.entryCount}{raceClass.hasStartTimes ? ` · ${text.hasTimes}` : ""}</span></th>
            <td data-label={text.method}><select aria-label={`${text.method} ${raceClass.name}`} value={row.method} disabled={locked}
              onChange={event => changeDrawRow(raceClass.id, { method: event.target.value as typeof row.method })}>
              {(["FREE", "MINUTE", "MASS"] as const).map(method => <option key={method} value={method}>{text.methods[method]}</option>)}
            </select></td>
            <td data-label={text.interval}><input aria-label={`${text.interval} ${raceClass.name}`} value={timed ? row.interval : ""}
              inputMode="numeric" disabled={locked || !timed} onChange={event => changeDrawRow(raceClass.id, { interval: event.target.value })} /></td>
            <td data-label={text.vacancies}><div className={styles.drawVacancies}>
              <input aria-label={`${text.vacancies} ${raceClass.name}`} value={timed ? row.vacancies : ""} inputMode="numeric"
                disabled={locked || !timed} onChange={event => changeDrawRow(raceClass.id, { vacancies: event.target.value })} />
              <select aria-label={`${text.vacancyKind} ${raceClass.name}`} value={row.vacancyKind} disabled={locked || !timed}
                onChange={event => changeDrawRow(raceClass.id, { vacancyKind: event.target.value as typeof row.vacancyKind })}>
                <option value="COUNT">{text.vacancyKinds.COUNT}</option><option value="PERCENT">{text.vacancyKinds.PERCENT}</option>
              </select>
            </div></td>
          </tr>;
        })}</tbody>
      </Table>
      {!drawPreview && <div className={styles.actions}><Button type="submit" disabled={disabled}>{text.preview}</Button></div>}
    </form>}
    {drawPreview && <DrawPreview ws={ws} preview={drawPreview} />}
    {drawAttempt && unknown && <Notice tone="attention" role="status">{text.unknown}</Notice>}
  </Section>;
}

function DrawPreview({ ws, preview }: { ws: Workspace; preview: StartDrawPreviewResponse }) {
  const { busy, cancelDrawPreview, drawAttempt, saveDraw, unknown } = ws;
  const time = (instant: string) => formatClockTime(instant, preview.timeZone);
  const replaced = preview.classes.filter(row => row.replacesStartTimes).map(row => row.className);
  const statusChanges = preview.becomesOkCount + preview.becomesMispunchedCount;
  const recalculated = preview.readOutCount - preview.notRecalculatedCount;
  return <section className={styles.drawPreview} aria-label={text.previewTitle}>
    <h3>{text.previewTitle}</h3>
    {preview.startGroups.map(group => <p key={group.firstControlCode} className={styles.drawNote}>
      {group.alternating ? text.alternating(group.classNames) : text.sameFirstControl(group.classNames, group.firstControlCode)}</p>)}
    {(replaced.length > 0 || statusChanges > 0) && <Notice tone="attention" role="alert">
      {replaced.length > 0 && <p>{text.replaces(replaced)}</p>}
      {recalculated > 0 && <p>{text.readOut(recalculated)}</p>}
      {statusChanges > 0 && <p>{text.statusChanges(statusChanges)}</p>}
    </Notice>}
    {replaced.length === 0 && statusChanges === 0 && recalculated > 0 && <p>{text.readOut(recalculated)}</p>}
    {preview.classes.map(raceClass => <section key={raceClass.classId} className={styles.drawPreviewClass}
      aria-label={raceClass.className}>
      <h4>{raceClass.className} · {text.methods[raceClass.method]}</h4>
      <p>{raceClass.method === "FREE" ? text.freeStart : raceClass.method === "MASS"
        ? text.massStart(time(raceClass.firstStartTime!))
        : text.minuteStart(time(raceClass.firstStartTime!), raceClass.intervalMinutes, raceClass.vacancyCount)}</p>
      {raceClass.method !== "FREE" && (raceClass.slots.length === 0 ? <p>{text.empty}</p>
        : <Table className={styles.drawPreviewTable}>
          <thead><tr><th scope="col">{text.time}</th><th scope="col">{text.name}</th><th scope="col">{text.club}</th><th scope="col">{text.card}</th>
            {forked(raceClass) && <th scope="col">{variantText.variantColumn}</th>}</tr></thead>
          <tbody>{raceClass.slots.map((slot, index) => <tr key={`${slot.startTime}-${index}`} data-vacant={slot.entry ? undefined : "true"}>
            <td><time dateTime={slot.startTime}>{time(slot.startTime)}</time></td>
            {slot.entry ? <><td>{slot.entry.name}</td><td>{slot.entry.club ?? text.none}</td><td>{slot.entry.card ?? text.none}</td>
              {forked(raceClass) && <td>{slot.entry.variantCode ?? text.none}</td>}</>
              : <td colSpan={forked(raceClass) ? 4 : 3}><strong>{text.vacant}</strong></td>}
          </tr>)}</tbody>
        </Table>)}
    </section>)}
    <div className={styles.actions}>
      <Button disabled={busy} onClick={() => void saveDraw()}>
        {unknown && drawAttempt ? text.save : preview.requiresConfirmation ? text.replaceAndSave : text.save}</Button>
      {!drawAttempt && <Button variant="secondary" disabled={busy} onClick={cancelDrawPreview}>{text.cancel}</Button>}
    </div>
  </section>;
}
