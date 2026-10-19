"use client";

import styles from "../race-administrator-workspace.module.css";
import own from "./start-draw-advanced.module.css";
import { startDrawAdvancedSv as text } from "../../i18n/start-draw-advanced-sv";
import { Button, Field, Notice, Table } from "../ui";
import { advancedChanged, drawClassOrder, type LaterStartKind } from "./start-draw-advanced";
import type { Workspace } from "./workspace-state";

/**
 * "Avancerat" i Lottning (PLAN.md steg 26): vilka klasser som lottas, regler för hela starten, startordning och senare
 * start per klass, och seedning med ranking från fil. Det enkla läget ovanför är oförändrat.
 */
export function StartDrawAdvanced({ ws, locked }: { ws: Workspace; locked: boolean }) {
  const { raceId, drawSetup, drawAdvanced, drawAdvancedErrors: errors, drawAdvancedOpen, setDrawAdvancedOpen,
    changeDrawAdvanced, selectDrawClasses } = ws;
  if (!drawSetup) return null;
  const single = drawAdvanced.groupControls === "1";
  return <details className={styles.disclosure} id={`draw-advanced-${raceId}`} open={drawAdvancedOpen}
    onToggle={event => setDrawAdvancedOpen(event.currentTarget.open)}>
    <summary>{text.title}{advancedChanged(drawAdvanced) && <span className={own.summaryNote}>· {text.changed}</span>}</summary>
    <div className={styles.disclosureBody}>
      <p className={styles.workflowHelp}>{text.help}</p>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={locked} onClick={() => selectDrawClasses("ALL")}>{text.selectAll}</Button>
        <Button variant="secondary" disabled={locked} onClick={() => selectDrawClasses("UNDRAWN")}>{text.selectUndrawn}</Button>
      </div>
      <section className={own.block} aria-labelledby={`draw-rules-${raceId}`}>
        <h3 id={`draw-rules-${raceId}`}>{text.rulesHeading}</h3>
        <div className={own.rules}>
          <Field label={text.groupControls} help={text.groupControlsHelp}>
            <select value={drawAdvanced.groupControls} disabled={locked}
              onChange={event => changeDrawAdvanced({ groupControls: event.target.value as "1" | "2" | "3" })}>
              {(["1", "2", "3"] as const).map(value => <option key={value} value={value}>{text.groupControlsOptions[value]}</option>)}
            </select></Field>
          <Field label={text.maxPerMinute} help={text.limitHelp} error={errors.maxPerMinute}>
            <input value={drawAdvanced.maxPerMinute} inputMode="numeric" autoComplete="off" disabled={locked}
              onChange={event => changeDrawAdvanced({ maxPerMinute: event.target.value })} /></Field>
          <Field label={text.maxPerMinutePerPen} help={single ? text.penHelpSingle : text.penHelp} error={errors.maxPerMinutePerPen}>
            <input value={drawAdvanced.maxPerMinutePerPen} inputMode="numeric" autoComplete="off" disabled={locked || single}
              onChange={event => changeDrawAdvanced({ maxPerMinutePerPen: event.target.value })} /></Field>
          <Field label={text.lastStart} help={text.lastStartHelp} error={errors.lastStart}>
            <input value={drawAdvanced.lastStart} inputMode="numeric" autoComplete="off" placeholder="12:00" disabled={locked}
              onChange={event => changeDrawAdvanced({ lastStart: event.target.value })} /></Field>
        </div>
      </section>
      <ClassOrder ws={ws} locked={locked} />
      <Seeding ws={ws} locked={locked} />
    </div>
  </details>;
}

function ClassOrder({ ws, locked }: { ws: Workspace; locked: boolean }) {
  const { raceId, drawSetup, drawRows, drawAdvanced, drawAdvancedErrors: errors, changeLaterStart, moveDrawClass, resetDrawOrder } = ws;
  if (!drawSetup) return null;
  const order = drawClassOrder(drawSetup, drawRows, drawAdvanced);
  const byId = new Map(drawSetup.classes.map(row => [row.id, row]));
  return <section className={own.block} aria-labelledby={`draw-order-${raceId}`}>
    <h3 id={`draw-order-${raceId}`}>{text.orderHeading}</h3>
    <p className={styles.workflowHelp}>{text.orderHelp}</p>
    <div className={styles.actions}>
      <span>{drawAdvanced.classOrder ? text.orderCustom : text.orderAutomatic}</span>
      {drawAdvanced.classOrder && <Button variant="quiet" disabled={locked} onClick={resetDrawOrder}>{text.orderReset}</Button>}
    </div>
    <Table className={own.orderTable}>
      <thead><tr><th scope="col">{text.position}</th><th scope="col">{text.className}</th><th scope="col">{text.firstStart}</th></tr></thead>
      <tbody>{order.map((classId, index) => {
        const raceClass = byId.get(classId)!, row = drawRows[classId];
        const later = drawAdvanced.laterStarts[classId] ?? { kind: "NONE" as const, value: "" };
        const error = errors[`later:${classId}`];
        const timed = row?.method !== "FREE";
        return <tr key={classId}>
          <td className={own.orderCell}><span className={own.orderNumber}>{index + 1}.</span>
            <Button variant="quiet" aria-label={text.moveUp(raceClass.name)} disabled={locked || index === 0}
              onClick={() => moveDrawClass(classId, -1)}>↑</Button>
            <Button variant="quiet" aria-label={text.moveDown(raceClass.name)} disabled={locked || index === order.length - 1}
              onClick={() => moveDrawClass(classId, 1)}>↓</Button></td>
          <th scope="row">{raceClass.name}{!row?.selected && <span className={own.notDrawn}>{text.notDrawn}</span>}</th>
          <td><div className={own.later}>
            <select aria-label={text.laterKind(raceClass.name)} value={later.kind} disabled={locked || !timed}
              onChange={event => changeLaterStart(classId, { kind: event.target.value as LaterStartKind })}>
              {(["NONE", "CLOCK", "OFFSET"] as const).map(kind => <option key={kind} value={kind}>{text.laterKinds[kind]}</option>)}
            </select>
            {later.kind !== "NONE" && <Field label={<span className={styles.visuallyHidden}>{text.laterValue(raceClass.name)}</span>}
              error={error}>
              <input value={later.value} inputMode="numeric" autoComplete="off" placeholder={text.laterPlaceholder[later.kind]}
                disabled={locked || !timed} onChange={event => changeLaterStart(classId, { value: event.target.value })} /></Field>}
          </div></td>
        </tr>;
      })}</tbody>
    </Table>
  </section>;
}

function Seeding({ ws, locked }: { ws: Workspace; locked: boolean }) {
  const { raceId, drawSetup, drawRows, drawAdvanced, drawAdvancedErrors: errors, drawSeedClass, setDrawSeedClass, drawSeedImport,
    changeDrawAdvanced, changeSeed, clearClassSeeds, importSeedRanking } = ws;
  if (!drawSetup) return null;
  const shown = drawSetup.classes.find(row => row.id === drawSeedClass) ??
    drawSetup.classes.find(row => drawRows[row.id]?.selected) ?? drawSetup.classes[0];
  const entries = shown ? drawSetup.entries.filter(entry => entry.classId === shown.id)
    .sort((a, b) => a.name.localeCompare(b.name, "sv-SE")) : [];
  const seeded = entries.filter(entry => (drawAdvanced.seeds[entry.id] ?? "").trim() !== "").length;
  return <section className={own.block} aria-labelledby={`draw-seeding-${raceId}`}>
    <h3 id={`draw-seeding-${raceId}`}>{text.seedingHeading}</h3>
    <p className={styles.workflowHelp}>{text.seedingHelp}</p>
    <div className={own.seedTools}>
      <Field label={text.seeding}><select value={drawAdvanced.seeding} disabled={locked}
        onChange={event => changeDrawAdvanced({ seeding: event.target.value as "LAST" | "SPREAD" })}>
        <option value="LAST">{text.seedingOptions.LAST}</option><option value="SPREAD">{text.seedingOptions.SPREAD}</option>
      </select></Field>
      <Field label={text.importLabel} help={text.importHelp}>
        <input type="file" accept=".csv,.txt,text/csv,text/plain" disabled={locked}
          onChange={event => { void importSeedRanking(event.target.files?.[0]); event.target.value = ""; }} /></Field>
    </div>
    {drawSeedImport === "error" && <Notice tone="error" role="alert">{text.importError}</Notice>}
    {drawSeedImport && drawSeedImport !== "error" && <Notice tone={drawSeedImport.unmatched.length > 0 ? "attention" : "ok"} role="status">
      <div className={own.importResult}><p>{text.imported(drawSeedImport.matched)}</p>
        {drawSeedImport.unmatched.length > 0 && <><p>{text.importUnmatched(drawSeedImport.unmatched.length)}</p>
          <ul>{drawSeedImport.unmatched.slice(0, 10).map(row => <li key={row.line}>{text.importLine(row.line, row.text)}</li>)}</ul></>}
      </div></Notice>}
    {shown && <>
      <div className={styles.actions}>
        <Field label={text.seedClass} help={text.seededCount(seeded)} className={styles.narrowField}>
          <select value={shown.id} onChange={event => setDrawSeedClass(event.target.value)}>
            {drawSetup.classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></Field>
        {seeded > 0 && <Button variant="quiet" disabled={locked} onClick={() => clearClassSeeds(shown.id)}>{text.clearSeeds}</Button>}
      </div>
      {entries.length === 0 ? <p className={styles.workflowHelp}>{text.noEntries}</p>
        : <Table className={own.seedTable} aria-label={`${text.seedingHeading} ${shown.name}`}>
          <thead><tr><th scope="col">{text.name}</th><th scope="col">{text.club}</th><th scope="col">{text.card}</th>
            <th scope="col">{text.seedRank}</th></tr></thead>
          <tbody>{entries.map(entry => <tr key={entry.id}>
            <th scope="row">{entry.name}</th><td>{entry.club ?? text.none}</td><td>{entry.card ?? text.none}</td>
            <td><Field label={<span className={styles.visuallyHidden}>{text.seedLabel(entry.name)}</span>} error={errors[`seed:${entry.id}`]}>
              <input value={drawAdvanced.seeds[entry.id] ?? ""} inputMode="numeric" autoComplete="off" disabled={locked}
                onChange={event => changeSeed(entry.id, event.target.value)} /></Field></td>
          </tr>)}</tbody>
        </Table>}
    </>}
  </section>;
}
