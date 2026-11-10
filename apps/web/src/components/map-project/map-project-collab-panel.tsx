"use client";

import { useState } from "react";
import { mapProjectEditorEn } from "../../i18n/map-project-en";
import { useTexts } from "../language-provider";
import type { MapProjectAreaStatus, MapProjectMode, MapProjectProposalView, MapProjectView } from "@o-tid/contracts";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import { Button, Notice } from "../ui";
import type { useMapProjectCollaboration } from "./use-map-project-collaboration";
import { STAGE_COLORS, type StageAge } from "../../lib/map-project-overlay";
import styles from "./map-project-editor.module.css";

const STAGE_AGES: readonly StageAge[] = ["YEAR", "THREE", "SIX", "OLDER", "NEVER"];

const MODES: readonly MapProjectMode[] = ["SHARED", "LEAD"];
const STATUSES: readonly MapProjectAreaStatus[] = ["BASE", "DRAFTED", "SURVEYED", "DONE"];
type Collaboration = ReturnType<typeof useMapProjectCollaboration>;

/**
 * ADR-0219 (K1): samarbetet i editorns sidopanel. Arbetssättet (ägarna byter), förslagen (Visa markerar förslagets objekt på
 * kartan; ägarna godkänner och avvisar, den som föreslog drar tillbaka) och delområdena (ägarna ritar, delar ut och tar bort;
 * den som fått området sätter läget).
 */
export function MapProjectCollabPanel({ view, collab, shownProposal, onShowProposal, shownArea, onShowArea, onNewArea, newArea, onSaveArea, onCancelArea,
  stages, onStages }: {
  view: MapProjectView;
  /** Etapperna: delområdena färgade efter revideringsdatumet. */
  stages: boolean; onStages: (shown: boolean) => void;
  collab: Collaboration;
  shownProposal: string | undefined; onShowProposal: (proposalId: string | undefined) => void;
  shownArea: string | undefined; onShowArea: (areaId: string | undefined) => void;
  /** Starta verktyget Delområde (bara ägarna). */
  onNewArea: () => void;
  /** Delområdet som just ritats och väntar på namn och kartritare. */
  newArea: boolean;
  onSaveArea: (name: string, assigneeAccountId: string | null) => void;
  onCancelArea: () => void;
}) {
  const text = useTexts(mapProjectEditorSv.collab, mapProjectEditorEn.collab);
  const viewer = view.viewer;
  const open = collab.proposals.filter(proposal => proposal.status === "OPEN");
  const decided = collab.proposals.filter(proposal => proposal.status !== "OPEN").slice(0, 5);
  const editors = view.members.filter(member => member.role !== "READ");

  return <>
    {collab.problem && <Notice tone="error" role="alert">{collab.problem}</Notice>}
    {viewer.canPropose && !viewer.canEdit && <p className={styles.muted}>{text.suggestHint}</p>}

    <section aria-labelledby="map-project-mode" className={styles.panel}>
      <h2 id="map-project-mode">{text.mode}</h2>
      {viewer.canDecide ? <div className={styles.actions} role="group" aria-labelledby="map-project-mode">
        {MODES.map(mode => <Button key={mode} variant={collab.mode === mode ? "primary" : "secondary"} aria-pressed={collab.mode === mode}
          disabled={collab.busy} onClick={() => { if (collab.mode !== mode) void collab.setMode(mode); }}>{text.modes[mode]}</Button>)}
      </div> : <p>{text.modes[collab.mode]}</p>}
      <p className={styles.muted}>{text.modeHelp[collab.mode]}</p>
    </section>

    <section aria-labelledby="map-project-proposals" className={styles.panel} data-testid="map-project-proposals">
      <h2 id="map-project-proposals">{text.proposals(open.length)}</h2>
      {open.length === 0 && <p className={styles.muted}>{text.noProposals}</p>}
      {viewer.canDecide && open.length > 1 && <DecideAll collab={collab} count={open.length} />}
      <ul className={styles.rows}>
        {[...open, ...decided].map(proposal => <ProposalRow key={proposal.proposalId} proposal={proposal} collab={collab}
          canDecide={viewer.canDecide} mine={proposal.author.accountId === viewer.accountId}
          shown={shownProposal === proposal.proposalId}
          onShow={() => onShowProposal(shownProposal === proposal.proposalId ? undefined : proposal.proposalId)} />)}
      </ul>
    </section>

    <section aria-labelledby="map-project-areas" className={styles.panel} data-testid="map-project-areas">
      <h2 id="map-project-areas">{text.areas}</h2>
      {newArea && <NewAreaForm defaultName={text.areaNameDefault(collab.areas.length + 1)} editors={editors} busy={collab.busy}
        onSave={onSaveArea} onCancel={onCancelArea} />}
      {collab.areas.length === 0 && !newArea && <p className={styles.muted}>{text.noAreas}</p>}
      <ul className={styles.rows}>
        {collab.areas.map(area => {
          const mine = area.assignee?.accountId === viewer.accountId;
          return <li key={area.areaId} className={styles.areaRow} data-shown={shownArea === area.areaId}>
            <button type="button" className={styles.linkButton} aria-pressed={shownArea === area.areaId}
              onClick={() => onShowArea(shownArea === area.areaId ? undefined : area.areaId)}>
              {area.name}{mine ? ` (${text.mine})` : ""}
            </button>
            <span className={styles.actions}>
              {viewer.canDecide && <label><span className={styles.srOnly}>{text.assignee}</span>
                <select value={area.assignee?.accountId ?? ""} disabled={collab.busy} aria-label={`${text.assignee}: ${area.name}`}
                  onChange={event => void collab.updateArea(area.areaId, { assigneeAccountId: event.target.value || null })}>
                  <option value="">{text.nobody}</option>
                  {editors.map(member => <option key={member.accountId} value={member.accountId}>{member.name}</option>)}
                  {area.assignee && !editors.some(member => member.accountId === area.assignee?.accountId) &&
                    <option value={area.assignee.accountId}>{area.assignee.name ?? "?"}</option>}
                </select></label>}
              {!viewer.canDecide && <span className={styles.muted}>{area.assignee?.name ?? text.nobody}</span>}
              {(viewer.canDecide || mine) ? <label><span className={styles.srOnly}>{text.areaStatus}</span>
                <select value={area.status} disabled={collab.busy} aria-label={`${text.areaStatus}: ${area.name}`}
                  onChange={event => void collab.updateArea(area.areaId, { status: event.target.value as MapProjectAreaStatus })}>
                  {STATUSES.map(status => <option key={status} value={status}>{text.areaStatuses[status]}</option>)}
                </select></label> : <span className={styles.muted}>{text.areaStatuses[area.status]}</span>}
              {(viewer.canDecide || mine) ? <label className={styles.revised}>{text.revisedOn}
                <input type="date" value={area.revisedOn ?? ""} disabled={collab.busy} aria-label={`${text.revisedOn}: ${area.name}`}
                  onChange={event => void collab.updateArea(area.areaId, { revisedOn: event.target.value || null })} /></label>
                : area.revisedOn && <span className={styles.muted}>{text.revisedOn} {area.revisedOn}</span>}
              {viewer.canDecide && <Button variant="quiet" disabled={collab.busy} onClick={() => void collab.removeArea(area.areaId)}>
                {text.removeArea}</Button>}
            </span>
          </li>;
        })}
      </ul>
      {viewer.canDecide && !newArea && <Button variant="secondary" onClick={onNewArea}>{text.newArea}</Button>}
      {collab.areas.length > 0 && <>
        <label className={styles.check}><input type="checkbox" checked={stages} onChange={() => onStages(!stages)} data-testid="map-project-stages" />
          {text.stages}</label>
        {stages && <p className={styles.legend} data-testid="map-project-stage-legend">{text.stagesHelp}<br />
          {STAGE_AGES.map(age => <span key={age} className={styles.stageKey}><i style={{ background: STAGE_COLORS[age] }} />{text.stageAges[age]}</span>)}</p>}
      </>}
    </section>
  </>;
}

function ProposalRow({ proposal, collab, canDecide, mine, shown, onShow }: {
  proposal: MapProjectProposalView; collab: Collaboration; canDecide: boolean; mine: boolean; shown: boolean; onShow: () => void;
}) {
  const text = useTexts(mapProjectEditorSv.collab, mapProjectEditorEn.collab);
  const author = proposal.source === "AI" ? text.ai : proposal.author.name ?? text.unknownAuthor;
  const conflicts = proposal.edits.filter(edit => edit.outcome === "CONFLICT").length;
  const isOpen = proposal.status === "OPEN";
  return <li className={styles.proposalRow} data-status={proposal.status}>
    <span>
      <strong>{text.proposalBy(author, proposal.edits.length)}</strong>
      {!isOpen && <small className={styles.muted}> · {text.status[proposal.status]}</small>}
      {proposal.note && <small className={styles.muted}> · {proposal.note}</small>}
      {conflicts > 0 && <small className={styles.muted}> · {text.conflicts(conflicts)}</small>}
    </span>
    <span className={styles.actions}>
      {isOpen && <Button variant={shown ? "primary" : "quiet"} aria-pressed={shown} onClick={onShow}>{text.show}</Button>}
      {isOpen && canDecide && <>
        <Button variant="secondary" disabled={collab.busy} onClick={() => void collab.decide(proposal.proposalId, "ACCEPT")}>{text.accept}</Button>
        <Button variant="secondary" disabled={collab.busy} onClick={() => void collab.decide(proposal.proposalId, "REJECT")}>{text.reject}</Button>
      </>}
      {isOpen && mine && !canDecide && <Button variant="secondary" disabled={collab.busy}
        onClick={() => void collab.decide(proposal.proposalId, "WITHDRAW")}>{text.withdraw}</Button>}
    </span>
  </li>;
}

/** Ägaren 2026-11-10: "Godkänn alla" och "Avvisa alla" när det finns flera öppna förslag (t.ex. en generalisering i många delar). */
function DecideAll({ collab, count }: { collab: Collaboration; count: number }) {
  const text = useTexts(mapProjectEditorSv.collab, mapProjectEditorEn.collab);
  const [status, setStatus] = useState<string>();
  const run = async (action: "ACCEPT" | "REJECT") => {
    if (!window.confirm(action === "ACCEPT" ? text.acceptAllConfirm(count) : text.rejectAllConfirm(count))) return;
    const result = await collab.decideAll(action, (done, left) => setStatus(text.decidingAll(done, left)));
    setStatus(result ? text.decidedAll(result.done, result.conflicts) : undefined);
  };
  return <div data-testid="map-project-decide-all">
    <span className={styles.actions}>
      <Button disabled={collab.busy} onClick={() => void run("ACCEPT")}>{text.acceptAll(count)}</Button>
      <Button variant="secondary" disabled={collab.busy} onClick={() => void run("REJECT")}>{text.rejectAll}</Button>
    </span>
    {status && <p className={styles.muted} role="status">{status}</p>}
  </div>;
}

function NewAreaForm({ defaultName, editors, busy, onSave, onCancel }: {
  defaultName: string; editors: readonly { accountId: string; name: string }[]; busy: boolean;
  onSave: (name: string, assigneeAccountId: string | null) => void; onCancel: () => void;
}) {
  const mapProjectEditorText = useTexts(mapProjectEditorSv, mapProjectEditorEn);
  const text = useTexts(mapProjectEditorSv.collab, mapProjectEditorEn.collab);
  const [name, setName] = useState(defaultName);
  const [assignee, setAssignee] = useState("");
  return <form className={styles.areaForm} onSubmit={event => { event.preventDefault(); if (name.trim()) onSave(name.trim(), assignee || null); }}>
    <label>{text.areaName}<input value={name} maxLength={100} required onChange={event => setName(event.target.value)} /></label>
    <label>{text.assignee}<select value={assignee} onChange={event => setAssignee(event.target.value)}>
      <option value="">{text.nobody}</option>
      {editors.map(member => <option key={member.accountId} value={member.accountId}>{member.name}</option>)}
    </select></label>
    <span className={styles.actions}>
      <Button type="submit" disabled={busy}>{text.saveArea}</Button>
      <Button variant="secondary" onClick={onCancel}>{mapProjectEditorText.tools.cancel}</Button>
    </span>
  </form>;
}
