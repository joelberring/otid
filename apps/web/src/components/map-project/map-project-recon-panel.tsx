"use client";

import { useRef, useState } from "react";
import { mapProjectReconEn } from "../../i18n/map-project-more-en";
import { useTexts } from "../language-provider";
import type { MapProjectView } from "@o-tid/contracts";
import { DEFAULT_RECON, pointInPolygon, RECON_GROUPS, type ReconSettings, type ReconStatus } from "@o-tid/map-revision";
import { mapProjectReconSv } from "../../i18n/map-project-recon-sv";
import { localPoints } from "../../lib/map-project-track-store";
import { trackLengthM } from "../../lib/map-project-tracks";
import { Button } from "../ui";
import type { ReconLayer, useMapProjectRecon } from "./use-map-project-recon";
import styles from "./map-project-editor.module.css";

const LAYERS: readonly ReconLayer[] = ["STATUS", "COVERAGE", "TRACKS"];
const STATUSES: readonly ReconStatus[] = ["UNSEEN", "PASSED", "CHECKED"];
const clock = () => new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" }) : "";

type Recon = ReturnType<typeof useMapProjectRecon>;

/**
 * ADR-0219 tillägget om rekningen (K3): rekningen i sidopanelen – lagren, förklaringen, spåren (spela in, GPX, byt namn, ta
 * bort det egna), delområdenas framsteg med "Godkänn passerade" och siktavstånden (ägarna).
 */
export function MapProjectReconPanel({ view, recon, hasGeoreference }: { view: MapProjectView; recon: Recon; hasGeoreference: boolean }) {
  const text = useTexts(mapProjectReconSv, mapProjectReconEn);
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const markers = recon.result?.markers;
  const counts = markers ? STATUSES.map(status => markers.filter(marker => marker.status === status).length) : undefined;
  const problem = recon.problem;
  const problemText = problem ? (problem in text.problems ? (text.problems as Record<string, unknown>)[problem] as string : text.problems.generic(problem)) : undefined;

  return <section className={styles.panel} aria-labelledby="map-project-recon" data-testid="map-project-recon">
    <h2 id="map-project-recon">{text.heading}</h2>
    <p className={styles.muted}>{text.help}</p>
    <fieldset className={styles.reconLayers}>
      <legend className={styles.srOnly}>{text.layers.label}</legend>
      {LAYERS.map(layer => <label key={layer} className={styles.check}><input type="checkbox" checked={recon.layers.has(layer)}
        onChange={() => recon.toggleLayer(layer)} data-testid={`recon-layer-${layer}`} />{text.layers[layer]}</label>)}
    </fieldset>
    {recon.layers.has("STATUS") && <p className={styles.legend} data-testid="recon-counts">
      {STATUSES.map(status => <span key={status} data-status={status}>{text.legend[status]}</span>)}
      {counts ? <><br />{text.counts(counts[0]!, counts[1]!, counts[2]!)}</> : <><br />{text.computing}</>}
    </p>}
    {problemText && <p role="alert" className={styles.problem}>{problemText}{" "}
      <Button variant="quiet" onClick={() => recon.setProblem(undefined)}>OK</Button></p>}
    {!hasGeoreference && <p className={styles.muted}>{text.noGeoreference}</p>}

    {hasGeoreference && recon.canRecord && <div className={styles.stack}>
      {recon.recording ? <>
        <p data-testid="recon-recording" role="status">{text.recording(trackLengthM(localPoints(recon.recording)), localPoints(recon.recording).length)}</p>
        <Button onClick={() => void recon.stopRecording()} data-testid="recon-stop">{text.stop}</Button>
      </> : <div className={styles.actions}>
        <label className={styles.srOnly} htmlFor="recon-name">{text.recordName}</label>
        <input id="recon-name" value={name} onChange={event => setName(event.target.value)} maxLength={80}
          placeholder={text.recordDefault(clock())} className={styles.grow} />
        <Button onClick={() => void recon.startRecording(name.trim() || text.recordDefault(clock()))} data-testid="recon-record">
          {text.record}</Button>
      </div>}
      <p className={styles.muted}>{text.recordingHelp}</p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => file.current?.click()}>{text.gpx}</Button>
        <input ref={file} type="file" accept=".gpx,application/gpx+xml" hidden data-testid="recon-gpx"
          onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ""; if (chosen) void recon.importGpx(chosen); }} />
      </div>
    </div>}

    {view.areas.length > 0 && recon.result && <ul className={styles.rows} aria-label={text.heading}>
      {view.areas.map(area => {
        const progress = recon.progress.get(area.areaId);
        const passed = recon.result!.markers.filter(marker => marker.status === "PASSED" && pointInPolygon(marker.at, area.polygon));
        return <li key={area.areaId} className={styles.areaRow} data-testid="recon-area">
          <span><strong>{area.name}</strong>{progress && <><br /><span className={styles.muted}>
            {text.areaProgress(progress.coveredShare, progress.seenShare, progress.checkedShare, progress.objects)}</span></>}</span>
          {recon.canRecord && passed.length > 0 && <Button variant="secondary" data-testid="recon-approve"
            onClick={() => void recon.setChecked(passed.map(marker => marker.key), true)}>{text.approveArea(passed.length)}</Button>}
        </li>;
      })}
    </ul>}

    <h3 className={styles.subheading}>{text.tracks}</h3>
    <p className={styles.muted}>{text.privacy}</p>
    <TrackList recon={recon} />
    {view.viewer.canDecide && <SettingsForm settings={recon.settings} onSave={recon.saveSettings} />}
  </section>;
}

function TrackList({ recon }: { recon: Recon }) {
  const text = useTexts(mapProjectReconSv, mapProjectReconEn);
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const pending = recon.local.filter(track => !recon.serverTracks.some(row => row.trackId === track.trackId && row.endedAt)
    && track.trackId !== recon.recording?.trackId);
  if (recon.serverTracks.length === 0 && pending.length === 0) return <p className={styles.muted}>{text.noTracks}</p>;
  return <ul className={styles.rows} data-testid="recon-tracks">
    {pending.map(track => <li key={track.trackId} data-testid="recon-track" data-pending="">
      <span>{text.track(track.name, null, day(track.startedAt), trackLengthM(localPoints(track)))} ·{" "}
        <em>{track.problem ? text.failed(track.problem) : text.waiting}</em></span>
      <Button variant="quiet" onClick={() => { if (window.confirm(text.removeConfirm)) void recon.removeTrack(track.trackId); }}>{text.remove}</Button>
    </li>)}
    {recon.serverTracks.map(track => <li key={track.trackId} data-testid="recon-track" data-own={track.own ? "" : undefined}>
      {renaming?.id === track.trackId ? <form className={styles.actions} onSubmit={event => { event.preventDefault();
        void recon.renameTrack(track.trackId, renaming.name.trim() || track.name).then(() => setRenaming(undefined)); }}>
        <input value={renaming.name} maxLength={80} onChange={event => setRenaming({ id: track.trackId, name: event.target.value })} aria-label={text.rename} />
        <Button type="submit">{text.save}</Button>
      </form> : <span>{text.track(track.name, track.own ? null : track.account.name, day(track.startedAt ?? track.createdAt), track.lengthM)}</span>}
      {track.own && renaming?.id !== track.trackId && <span className={styles.actions}>
        <Button variant="quiet" onClick={() => setRenaming({ id: track.trackId, name: track.name })}>{text.rename}</Button>
        <Button variant="quiet" onClick={() => { if (window.confirm(text.removeConfirm)) void recon.removeTrack(track.trackId); }}>{text.remove}</Button>
      </span>}
    </li>)}
  </ul>;
}

function SettingsForm({ settings, onSave }: { settings: ReconSettings; onSave: (settings: ReconSettings | null) => Promise<boolean> }) {
  const text = useTexts(mapProjectReconSv, mapProjectReconEn);
  const [draft, setDraft] = useState(settings);
  const number = (value: string, fallback: number) => { const parsed = Number(value.replace(",", ".")); return Number.isFinite(parsed) ? parsed : fallback; };
  return <details className={styles.settings}>
    <summary>{text.settings}</summary>
    <p className={styles.muted}>{text.settingsHelp}</p>
    <form className={styles.areaForm} onSubmit={event => { event.preventDefault(); void onSave(draft); }}>
      {RECON_GROUPS.map(group => <label key={group}>{text.groups[group]}<input type="number" min={2} max={200} step={1} value={draft.sightM[group]}
        onChange={event => setDraft({ ...draft, sightM: { ...draft.sightM, [group]: number(event.target.value, draft.sightM[group]) } })} /></label>)}
      <label>{text.lineShare}<input type="number" min={10} max={100} value={Math.round(draft.lineShare * 100)}
        onChange={event => setDraft({ ...draft, lineShare: number(event.target.value, draft.lineShare * 100) / 100 })} /></label>
      <label>{text.areaShare}<input type="number" min={10} max={100} value={Math.round(draft.areaShare * 100)}
        onChange={event => setDraft({ ...draft, areaShare: number(event.target.value, draft.areaShare * 100) / 100 })} /></label>
      <label>{text.coverM}<input type="number" min={2} max={200} value={draft.coverM}
        onChange={event => setDraft({ ...draft, coverM: number(event.target.value, draft.coverM) })} /></label>
      <span className={styles.actions}>
        <Button type="submit">{text.save}</Button>
        <Button variant="quiet" onClick={() => { setDraft(DEFAULT_RECON); void onSave(null); }}>{text.reset}</Button>
      </span>
    </form>
  </details>;
}
