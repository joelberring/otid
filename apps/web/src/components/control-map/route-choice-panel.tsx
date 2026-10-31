"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminRouteChoice, ControlMapResponse, RouteChoiceSettingsDto } from "@o-tid/contracts";
import { wgs84ToMapPoint, type MapGeoreference } from "@o-tid/map-file";
import type { LegAnalysis, RouteChoiceSettings } from "@o-tid/route-choice";
import { routeChoiceSv as text } from "../../i18n/route-choice-sv";
import { RouteChoiceSession, type RouteChoiceModel } from "../../lib/route-choice-client";
import { fetchCalibrationRoutes, fetchMapSource, fetchRouteChoice, publishRouteChoice, saveRouteChoiceSettings } from "../../lib/route-choice-api";
import { calibrationSamples, courseTotal, courseWarnings, legName, legRows, plannedLegs, publishableLegs, routeChoiceOptions } from "../../lib/route-choice-view";
import type { CalibrationResult, SpeedFactors } from "../../lib/route-choice-worker-protocol";
import { Button, Notice } from "../ui";
import { RouteChoiceMap } from "./route-choice-map";
import { RouteChoiceCalibration, RouteChoiceSettingsForm } from "./route-choice-settings";
import styles from "./route-choice.module.css";

const createWorker = () => new Worker(new URL("../../lib/route-choice-worker.ts", import.meta.url), { type: "module" });
type Status = "loading" | "reading" | "analysing" | "done" | "failed" | "readFailed";
type Message = { tone: "ok" | "error" | "attention"; text: string } | undefined;

/**
 * Steg 60 (ADR-0179 beslut 7–13): kontrollkartans läge "Vägval". Kartfilen hämtas (bara admin) och räknas i en Worker;
 * vald bana eller variant räknas sträcka för sträcka med svar efter hand, och ett byte av bana avbryter den förra.
 * Tabellen per sträcka, summan för banan, varningar, inställningar, kalibrering och "Visa bästa vägval publikt".
 */
export function RouteChoicePanel({ raceId, data, imageHref, onGoToMapFile }: {
  raceId: string; data: ControlMapResponse; imageHref: string | undefined; onGoToMapFile: () => void;
}) {
  const [state, setState] = useState<AdminRouteChoice>();
  const [model, setModel] = useState<RouteChoiceModel>();
  const [status, setStatus] = useState<Status>("loading");
  const [optionId, setOptionId] = useState("");
  const [analyses, setAnalyses] = useState<ReadonlyMap<string, LegAnalysis>>(new Map());
  const [selectedLeg, setSelectedLeg] = useState<string>();
  const [message, setMessage] = useState<Message>();
  const session = useRef<RouteChoiceSession | undefined>(undefined);
  const options = useMemo(() => routeChoiceOptions(data.courses), [data.courses]);
  const option = options.find(row => row.id === optionId) ?? options[0];
  const legs = useMemo(() => option && state ? plannedLegs(option, state) : [], [option, state]);

  // Läget och kartfilen; Workern lever så länge vyn är öppen.
  useEffect(() => {
    const controller = new AbortController();
    let closed = false;
    void (async () => {
      try {
        const next = await fetchRouteChoice(raceId, controller.signal);
        if (closed) return;
        setState(next);
        if (!next.mapFile) { setStatus("done"); return; }
        setStatus("reading");
        const file = await fetchMapSource(raceId, controller.signal);
        if (closed) return;
        const worker = new RouteChoiceSession(createWorker);
        session.current = worker;
        worker.load(file.bytes, file.fileName, next.settings as RouteChoiceSettings, setModel, () => { if (!closed) setStatus("readFailed"); });
      } catch { if (!closed) setStatus("failed"); }
    })();
    return () => { closed = true; controller.abort(); session.current?.close(); session.current = undefined; };
  }, [raceId]);

  // Ny bana, nya inställningar (ny modell) eller ny kartfil: räkna om. Förra körningen avbryts.
  useEffect(() => {
    const worker = session.current;
    if (!worker || !model || !state?.mapFile) return;
    const inputs = legs.flatMap(leg => leg.input ? [leg.input] : []);
    setAnalyses(new Map());
    setSelectedLeg(current => current && legs.some(leg => leg.key === current) ? current : legs.find(leg => leg.input)?.key);
    if (inputs.length === 0) { setStatus("done"); return; }
    setStatus("analysing");
    worker.analyse(inputs, (_index, analysis) => setAnalyses(current => new Map(current).set(analysis.key, analysis)),
      () => setStatus("done"), () => setStatus("failed"));
    return () => worker.cancel();
  }, [model, legs, state?.mapFile]);

  async function saveSettings(settings: RouteChoiceSettingsDto): Promise<boolean> {
    try {
      await saveRouteChoiceSettings(raceId, settings);
      setState(current => current ? { ...current, settings } : current);
      session.current?.settings(settings as RouteChoiceSettings);
      return true;
    } catch { return false; }
  }

  async function calibrate(): Promise<CalibrationResult | undefined> {
    const georeference = state?.mapFile?.georeference as MapGeoreference | null | undefined;
    if (!option || !georeference || !session.current) return undefined;
    try {
      const routes = await fetchCalibrationRoutes(raceId, option.courseId);
      const samples = calibrationSamples(routes, (latitude, longitude) => {
        const point = wgs84ToMapPoint(georeference, { latitude, longitude });
        return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined;
      });
      if (samples.length === 0) return undefined;
      return await session.current.calibrate(samples);
    } catch { return undefined; }
  }

  async function saveSpeeds(speeds: SpeedFactors): Promise<boolean> {
    if (!state) return false;
    return saveSettings({ ...state.settings, speedByClass: speeds });
  }

  const published = state?.published.find(row => option && row.courseId === option.courseId && row.variantCode === option.variantCode);
  const oldMap = !!state?.publishedMapSha256 && !!state.mapFile && state.publishedMapSha256 !== state.mapFile.sha256;
  async function publish(withdraw: boolean) {
    if (!option || !state?.mapFile) return;
    setMessage(undefined);
    if (!withdraw && status !== "done") { setMessage({ tone: "attention", text: text.publish.waitForAll }); return; }
    try {
      const result = await publishRouteChoice(raceId, withdraw
        ? { formatVersion: 1, kind: "WITHDRAW", courseId: option.courseId, variantCode: option.variantCode }
        : { formatVersion: 1, kind: "PUBLISH", mapSha256: state.mapFile.sha256, courseId: option.courseId, variantCode: option.variantCode,
          legs: publishableLegs(legs, analyses) });
      if (result !== "ok") { setMessage({ tone: "error", text: result === "MAP_FILE_CHANGED" ? text.publish.mapChanged : text.publish.failed }); return; }
      setState(await fetchRouteChoice(raceId));
      setMessage({ tone: "ok", text: withdraw ? text.publish.withdrawn : text.publish.published });
    } catch { setMessage({ tone: "error", text: text.publish.failed }); }
  }

  if (status === "loading") return <p role="status" className={styles.status}>{text.reading}</p>;
  if (status === "failed" && !state) return <Notice tone="error" role="alert">{text.failed}</Notice>;
  if (state && !state.mapFile) return <Notice tone="info"><p>{text.needsMapFile}</p>
    <div><Button variant="secondary" onClick={onGoToMapFile}>{text.goToMapFile}</Button></div></Notice>;
  if (!state || !option) return null;
  const rows = legRows(legs, analyses);
  const total = courseTotal(legs, analyses);
  const warnings = courseWarnings(legs, analyses);
  const selected = legs.find(leg => leg.key === selectedLeg);
  const done = analyses.size, count = legs.filter(leg => leg.input).length;
  const metersPerUnit = state.mapFile!.scale / 1000 / state.mapFile!.render.pxPerMm;
  const image = imageHref ? { href: imageHref, ...state.mapFile!.image } : undefined;
  const routeRunners = state.courses.find(course => course.courseId === option.courseId)?.routeRunners ?? 0;

  return <div className={styles.panel}>
    <label className={styles.form}>{text.course}
      <select value={option.id} onChange={event => { setOptionId(event.target.value); setMessage(undefined); }}>
        {options.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
      </select>
    </label>
    {state.mapFile!.mismatch && <Notice tone="attention">{text.mismatch}</Notice>}
    {count === 0 && <Notice tone="info">{text.noPlaces}</Notice>}
    <p role="status" className={styles.status}>{status === "reading" ? text.reading : status === "analysing" ? text.analysing(done, count)
      : status === "readFailed" ? text.readFailed : status === "failed" ? text.failed : text.done(count)}</p>
    {selected && <>
      <RouteChoiceMap render={state.mapFile!.render} image={image} leg={selected} analysis={analyses.get(selected.key)} metersPerUnit={metersPerUnit} />
      <p className={styles.muted}>{text.legend}</p>
    </>}
    <div className={styles.tableWrap} style={{ overflowX: "auto" }}>
      <table className={styles.table}>
        <caption>{text.table.caption}</caption>
        <thead><tr><th scope="col">{text.table.leg}</th><th scope="col">{text.table.straight}</th><th scope="col">{text.table.best}</th>
          <th scope="col">{text.table.climb}</th><th scope="col">{text.table.time}</th><th scope="col">{text.table.choices}</th>
          <th scope="col">{text.table.verdict}</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.key} data-leg={row.key} aria-selected={row.key === selectedLeg} onClick={() => setSelectedLeg(row.key)}>
          <th scope="row"><button type="button" className={styles.legButton} aria-label={text.showLeg(row.name)} onClick={() => setSelectedLeg(row.key)}>
            {row.name}</button></th>
          <td>{row.straight}</td><td>{row.best}</td><td>{row.climb}</td><td>{row.time}</td><td>{row.choices}</td>
          <td className={styles.verdict} data-kind={row.verdictKind}>{row.verdict}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className={styles.muted}>{total ?? text.totalIncomplete}</p>
    <p className={styles.muted}>{text.verdictHelp}</p>
    {warnings.length > 0 && <section aria-label={text.warnings.heading}>
      <h4>{text.warnings.heading}</h4>
      <ul className={styles.warnings}>{warnings.map(warning => <li key={`${warning.key}-${warning.text}`}>
        {text.legWarning(legName(warning.key))} {warning.text}</li>)}</ul>
    </section>}
    <div className={styles.actions}>
      <Button variant="secondary" onClick={() => void publish(false)} disabled={status !== "done"}>{text.publish.button}</Button>
      {published && !oldMap && <Button variant="quiet" onClick={() => void publish(true)}>{text.publish.withdraw}</Button>}
    </div>
    <p className={styles.muted}>{text.publish.help}</p>
    {published && !oldMap && <p className={styles.muted}>{text.publish.publishedAt(new Date(published.publishedAt).toLocaleString("sv-SE",
      { dateStyle: "short", timeStyle: "short" }))}</p>}
    {oldMap && <Notice tone="attention">{text.publish.oldMap}</Notice>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    <RouteChoiceSettingsForm settings={state.settings} unknownSymbols={model?.unknownSymbols ?? []} onSave={saveSettings} />
    <RouteChoiceCalibration runners={routeRunners} onCalibrate={calibrate} onSave={saveSpeeds} />
  </div>;
}
