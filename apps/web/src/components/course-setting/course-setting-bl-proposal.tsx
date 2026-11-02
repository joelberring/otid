"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColorDecision, CourseSettingEdit, PrintProfile, SheetFrame } from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { blProposalSv as text } from "../../i18n/course-setting-bl-proposal-sv";
import {
  approvalEdits, approvedProfile, cmykText, cssOfCmyk, decide, isolateAdjust, proposalState, sideOf, thumbnailView, type Action, type ProposalRow,
  type ProposalState
} from "../../lib/course-setting-bl-proposal";
import type { SymbolLookup } from "../../lib/course-setting-description-draw";
import { Button, Notice } from "../ui";
import { BlCompare, BlLayers, type RenderImage } from "./course-setting-bl-compare";
import styles from "./course-setting-bl-proposal.module.css";

/**
 * BL-profilerna (ADR-0183 beslut 7): förslaget som arrangören godkänner. Per kartfärg stora färgrutor före och efter
 * (skärmfärg via SWOP), kartfilens och BL:s namn, säkerheten i text och en liten kartbit med bara den färgen tänd; talen
 * står i en liten rad under. Överst hela kartan före och efter med ett reglage och ordningen som en enkel bild. Varje
 * beslut sparas genast i tävlingens kopia av profilen (kartfilen ändras inte).
 */
export function BlProposalPanel({ profile, builtIn, colors, usage, readOnly, frame, symbols, render, onSave }: {
  profile: PrintProfile; builtIn: readonly PrintProfile[]; colors: readonly MapColor[]; usage: ReadonlyMap<number, ColorUsage>; readOnly: boolean;
  frame: SheetFrame | undefined; symbols: SymbolLookup; render: RenderImage; onSave: (edits: CourseSettingEdit[]) => Promise<boolean>;
}) {
  const [decisions, setDecisions] = useState<readonly ColorDecision[]>(profile.colorDecisions ?? []);
  const [layer, setLayer] = useState(profile.courseLayer ?? "TOP");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDecisions(profile.colorDecisions ?? []); setLayer(profile.courseLayer ?? "TOP"); }, [profile]);
  const working = useMemo<PrintProfile>(() => ({ ...profile, colorDecisions: decisions, courseLayer: layer }), [profile, decisions, layer]);
  const state = useMemo(() => colors.length > 0 ? proposalState(working, colors, usage) : undefined, [working, colors, usage]);

  async function save(next: readonly ColorDecision[], nextLayer = layer) {
    const previous = decisions, previousLayer = layer;
    setDecisions(next); setLayer(nextLayer); setBusy(true); setMessage(undefined);
    const copy = { ...approvedProfile(profile, next, builtIn), courseLayer: nextLayer };
    const ok = await onSave(approvalEdits(copy));
    setBusy(false);
    if (ok) setMessage({ tone: "ok", text: text.saved });
    else { setDecisions(previous); setLayer(previousLayer); setMessage({ tone: "error", text: text.saveFailed }); }
  }
  const act = (action: Action) => { if (state && !readOnly) void save(decide(state, decisions, action)); };

  const table = profile.reference;
  if (!table) return null;
  const safeLeft = state?.rows.filter(row => row.status === "PENDING" && row.proposal.confidence === "SAFE").length ?? 0;
  return <section className={styles.panel} aria-labelledby="bl-proposal" data-testid="bl-proposal" data-pending={state?.counts.pending ?? ""}>
    <div className={styles.head}>
      <h2 id="bl-proposal">{text.heading(baseName(profile, builtIn))}</h2>
      <p className={styles.muted}>{text.source(table.sourceDate, table.effectiveFrom)} · <a href={table.sourceUrl} target="_blank" rel="noreferrer">{text.sourceLink}</a></p>
      <p>{text.intro}</p>
    </div>
    {!state ? <p role="status" className={styles.muted}>{text.noColors}</p> : <>
      <div className={styles.bar}>
        <span className={styles.progress} data-testid="bl-progress">{text.progress(state.counts.decided, state.rows.length)}</span>
        <span className={styles.tally}><span>{text.counts(state.counts.SAFE, state.counts.CONFIRM, state.counts.AMBIGUOUS)}</span></span>
        {!readOnly && <Button onClick={() => act({ kind: "ACCEPT_SAFE" })} disabled={busy || safeLeft === 0} data-testid="bl-accept-safe">
          {safeLeft === 0 ? text.acceptSafeNone : `${text.acceptSafe} (${safeLeft})`}</Button>}
        {busy && <span role="status">{text.saving}</span>}
      </div>
      {readOnly && <p className={styles.muted}>{text.readOnly}</p>}
      {message && <Notice tone={message.tone === "ok" ? "ok" : "error"} role="status"><p>{message.text}</p></Notice>}
      {frame && <BlCompare frame={frame} profile={working} state={state} colors={colors} symbols={symbols} render={render} />}
      <BlLayers profile={working} state={state} />
      {!readOnly && <label className={styles.bar}><input type="checkbox" checked={layer === "REFERENCE"} disabled={busy}
        onChange={event => void save(decisions, event.target.checked ? "REFERENCE" : "TOP")} data-testid="bl-course-layer" />{text.courseLayerToggle}</label>}
      <ol className={styles.rows} aria-label={text.heading(baseName(profile, builtIn))}>
        {state.rows.map(row => <ProposalItem key={row.proposal.color.ocadId} row={row} state={state} colors={colors} render={render} readOnly={readOnly || busy}
          act={act} />)}
      </ol>
      {state.unused.length > 0 && <details>
        <summary className={styles.muted}>{text.unused(state.unused.length)}</summary>
        <ul className={styles.notes}>{state.unused.map(row => <li key={row.proposal.color.ocadId}>{row.proposal.color.name}{row.row ? ` → ${row.row.name}` : ""}</li>)}</ul>
      </details>}
    </>}
    <details>
      <summary>{text.notes}</summary>
      <ul className={styles.notes}>{table.notes.map((note, index) => <li key={index}>{note.interpretation ? <strong>{text.interpretation}: </strong> : null}{note.text}{" "}
        <a href={note.url} target="_blank" rel="noreferrer">{new URL(note.url).pathname.replace(/\//g, "")}</a></li>)}</ul>
    </details>
  </section>;
}

const baseName = (profile: PrintProfile, builtIn: readonly PrintProfile[]) => builtIn.find(item => item.id === profile.basedOn)?.name ?? profile.name;

function ProposalItem({ row, state, colors, render, readOnly, act }: {
  row: ProposalRow; state: ProposalState; colors: readonly MapColor[]; render: RenderImage; readOnly: boolean; act: (action: Action) => void;
}) {
  const { proposal } = row;
  const color = proposal.color;
  const [choosing, setChoosing] = useState(false);
  const [thumb, setThumb] = useState<string>();
  const sample = color.usage?.sample;
  useEffect(() => {
    if (!sample) return;
    let live = true;
    void render({ ...thumbnailView(sample), colorAdjust: isolateAdjust(colors, color.ocadId) }, 2)
      .then(url => { if (live) setThumb(url); }, error => console.error("Kartbiten kunde inte ritas", error));
    return () => { live = false; };
  }, [sample, colors, color.ocadId, render]);
  const target = row.row;
  const side = target ? sideOf(state.table, target) : undefined;
  const choices = useMemo(() => {
    const rest = state.table.rows.filter(item => item.cmyk && item.role !== "REGISTRATION" && !proposal.candidates.includes(item.id));
    return [...proposal.candidates.map(id => state.table.rows.find(item => item.id === id)!).filter(item => item.cmyk), ...rest];
  }, [state.table, proposal.candidates]);
  const name = color.name;
  return <li className={styles.row} data-testid="bl-row" data-color={color.ocadId} data-confidence={proposal.confidence} data-status={row.status}
    data-row={target?.id ?? ""}>
    {thumb ? <img className={styles.thumb} src={thumb} alt={text.thumbAlt(name)} /> : <span className={styles.thumbEmpty} aria-hidden="true" />}
    <div>
      <div className={styles.pair}>
        <span className={styles.big} style={{ background: row.before }} title={text.before} data-testid="bl-before" />
        <span className={styles.arrow} aria-hidden="true">→</span>
        <span className={styles.big} style={{ background: row.after }} title={text.after} data-testid="bl-after" />
      </div>
      <div className={styles.pairLabels}><span>{text.before}</span><span>{text.after}</span></div>
    </div>
    <div className={styles.body}>
      <div className={styles.names}>
        <strong>{name}</strong><span aria-hidden="true">→</span><strong>{target ? target.name : text.keepFile}</strong>
        <span className={styles.chip} data-confidence={proposal.confidence} title={text.confidenceHelp[proposal.confidence]}>{text.confidence[proposal.confidence]}</span>
        <span className={styles.state} data-testid="bl-status">{text.status[row.status]}</span>
      </div>
      <ul className={styles.reasons}>{proposal.reasons.slice(0, 3).map(reason => <li key={reason}>{reason}</li>)}</ul>
      <div className={styles.numbers}>{text.numbers(cmykText(color.cmyk), target?.cmyk ? cmykText(target.cmyk) : undefined, color.ocadId)}
        {color.usage ? ` · ${text.used(color.usage.codes.slice(0, 5).join(", ") + (color.usage.codes.length > 5 ? " …" : ""))}` : ""}
        {target?.emptyCells ? ` · ${text.emptyCells(target.emptyCells.join(", ").toUpperCase())}` : ""}
        {side ? ` · ${side === "OVER" ? text.sideOver : side === "UNDER" ? text.sideUnder : text.sideCourse}` : ""}</div>
    </div>
    {!readOnly && <div className={styles.actions}>
      {proposal.row !== null && <Button variant={row.status === "ACCEPTED" && !row.chosen ? "secondary" : "primary"} onClick={() => act({ kind: "ACCEPT", ocadId: color.ocadId })}
        data-testid="bl-accept">{text.accept}</Button>}
      <Button variant="secondary" onClick={() => act({ kind: "KEEP", ocadId: color.ocadId })} data-testid="bl-keep">{text.keep}</Button>
      <Button variant="quiet" onClick={() => setChoosing(open => !open)} aria-expanded={choosing} data-testid="bl-choose">{choosing ? text.chooseCancel : text.choose}</Button>
    </div>}
    {choosing && !readOnly && <ul className={styles.choices} aria-label={text.chooseLabel(name)} data-testid="bl-choices">
      {choices.map(item => <li key={item.id}><button type="button" className={styles.choice} aria-pressed={target?.id === item.id} data-row={item.id}
        onClick={() => { setChoosing(false); act({ kind: "CHOOSE", ocadId: color.ocadId, row: item.id }); }}>
        <span className={styles.choiceSwatch} style={{ background: cssOfCmyk(item.cmyk!) }} aria-hidden="true" />
        <span><strong>{item.name}</strong> <span className={styles.numbers}>{cmykText(item.cmyk!)}{item.comment ? ` · ${item.comment}` : ""}</span></span>
      </button></li>)}
    </ul>}
  </li>;
}
