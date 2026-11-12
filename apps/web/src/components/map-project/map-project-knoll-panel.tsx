"use client";

import type { GeoJobList, MapProjectView } from "@o-tid/contracts";
import { useEffect, useRef, useState } from "react";
import { mapKnollsEn } from "../../i18n/map-knolls-en";
import { mapKnollsSv } from "../../i18n/map-knolls-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import { chooseKnolls, DEFAULT_KNOLL_LIMITS, knollFeatures, readKnollCandidates, type KnollCandidate, type KnollLimits } from "../../lib/map-project-knoll-choice";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import styles from "./map-project-editor.module.css";

const KNOLL_FILE = "kullar.geojson";

/**
 * Ägaren 2026-11-12: punkthöjderna väljs med reglage bland laserjobbets sparade möjliga kullar (`kullar.geojson`), utan att
 * laserdatan hämtas och körs om. Bara lagret för små kullar byts i det som visas; grundkartan i övrigt står kvar.
 */
export function MapProjectKnollPanel({ view, importer }: { view: MapProjectView; importer: ReturnType<typeof useMapProjectImport> }) {
  const text = useTexts(mapKnollsSv, mapKnollsEn);
  const base = mapProjectBase(view.projectId);
  const [jobs, setJobs] = useState<readonly { jobId: string; name: string }[]>();
  const [chosen, setChosen] = useState("");
  const [loaded, setLoaded] = useState<{ jobId: string; name: string; candidates: readonly KnollCandidate[] }>();
  const [limits, setLimits] = useState<KnollLimits>(DEFAULT_KNOLL_LIMITS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  async function open() {
    if (jobs) return;
    const result = await clubRequest(`${base}/geo-jobs`).catch(() => ({ status: 0, json: undefined }));
    const list = result.status === 200 ? (result.json as GeoJobList).jobs : [];
    setJobs(list.filter(job => job.status === "DONE" && job.outputs.some(output => output.name === KNOLL_FILE)).map(job => ({ jobId: job.jobId, name: job.name })));
  }
  const job = jobs?.find(row => row.jobId === chosen) ?? jobs?.[0];

  async function load() {
    if (!job) return;
    setBusy(true); setMessage(undefined);
    try {
      const response = await fetch(`${base}/geo-jobs/${job.jobId}/outputs/${KNOLL_FILE}`, { credentials: "same-origin" }).catch(() => undefined);
      const candidates = response?.ok ? readKnollCandidates(await response.json().catch(() => undefined)) : [];
      if (candidates.length === 0) { setMessage({ tone: "error", text: text.failed }); return; }
      setLoaded({ jobId: job.jobId, name: job.name, candidates });
    } finally { setBusy(false); }
  }

  const latest = useRef<() => void>(() => undefined);
  latest.current = () => {
    if (!loaded) return;
    const points = chooseKnolls(loaded.candidates, limits);
    if (points.length === 0) { setMessage({ tone: "error", text: text.nothing }); return; }
    importer.refine(text.name(loaded.name), { features: knollFeatures(points), skipped: 0, crs: 3006 }, /^dotknoll_laser$/);
    setMessage({ tone: "ok", text: text.done(points.length, loaded.candidates.length) });
  };
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => latest.current(), 200);
    return () => clearTimeout(timer);
  }, [loaded, limits]);

  if (!importer.canImport) return null;
  const slider = (key: keyof KnollLimits, label: string, min: number, max: number, step: number) => <label>{label}
    <input type="range" min={min} max={max} step={step} value={limits[key]} data-testid={`map-project-knolls-${key}`}
      onChange={event => setLimits(current => ({ ...current, [key]: Number(event.target.value) }))} /></label>;
  return <details className={styles.settings} data-testid="map-project-knolls" onToggle={event => { if (event.currentTarget.open) void open(); }}>
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {jobs && jobs.length === 0 && <p className={styles.muted}>{text.none}</p>}
    {job && <>
      <label>{text.job}<select value={job.jobId} onChange={event => { setChosen(event.target.value); setLoaded(undefined); setMessage(undefined); }}>
        {jobs!.map(row => <option key={row.jobId} value={row.jobId}>{row.name}</option>)}
      </select></label>
      {loaded?.jobId !== job.jobId ? <span className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={() => void load()} data-testid="map-project-knolls-load">{busy ? text.loading : text.load}</Button>
      </span> : <>
        {slider("minRise", text.minRise(limits.minRise.toLocaleString("sv-SE", { minimumFractionDigits: 1 })), 0.5, 3, 0.1)}
        {slider("lowerShare", text.lowerShare(Math.round(limits.lowerShare * 100)), 0.5, 1, 0.05)}
        {slider("maxFootM2", text.maxFoot(limits.maxFootM2), 20, 160, 10)}
        {slider("spacing", text.spacing(limits.spacing), 10, 60, 5)}
        <span className={styles.actions}><Button variant="quiet" onClick={() => setLimits(DEFAULT_KNOLL_LIMITS)}>{text.reset}</Button></span>
      </>}
    </>}
    {message && <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? styles.muted : styles.problem}
      data-testid="map-project-knolls-message">{message.text}</p>}
  </details>;
}
