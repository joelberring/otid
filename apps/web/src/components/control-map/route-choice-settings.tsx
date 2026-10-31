"use client";

import React, { useEffect, useState } from "react";
import { ROUTE_CHOICE_SPEED_CLASSES, ROUTE_CHOICE_SPEED_FACTOR_CLASSES, type RouteChoiceSettingsDto } from "@o-tid/contracts";
import type { CostModel } from "@o-tid/route-choice";
import { routeChoiceSv as text } from "../../i18n/route-choice-sv";
import type { CalibrationResult, SpeedFactors } from "../../lib/route-choice-worker-protocol";
import { Button, Notice } from "../ui";
import styles from "./route-choice.module.css";

type SpeedClass = (typeof ROUTE_CHOICE_SPEED_CLASSES)[number];
type Message = { tone: "ok" | "error"; text: string } | undefined;

/** "6:00" ↔ 360 s/km. */
export function paceText(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
export function parsePace(value: string): number | undefined {
  const match = /^\s*(\d{1,2})(?:[:.,](\d{1,2}))?\s*$/.exec(value);
  if (!match) return undefined;
  const seconds = Number(match[1]) * 60 + Number(match[2] ?? 0);
  return Number(match[2] ?? 0) < 60 && seconds >= 120 && seconds <= 1800 ? seconds : undefined;
}
const parseNumber = (value: string) => { const number = Number(value.replace(",", ".")); return value.trim() !== "" && Number.isFinite(number) ? number : undefined; };

/**
 * Steg 60: inställningarna för vägvalen. Okända symboler ur kostnadsmodellen med val av klass, ekvidistans, stigningsfaktor
 * och referensfart. "Spara" sparar för tävlingen; analysen räknas om med de nya värdena.
 */
export function RouteChoiceSettingsForm({ settings, unknownSymbols, onSave }: {
  settings: RouteChoiceSettingsDto; unknownSymbols: CostModel["unknownSymbols"];
  onSave: (settings: RouteChoiceSettingsDto) => Promise<boolean>;
}) {
  const [contour, setContour] = useState(String(settings.contourIntervalMeters ?? 5).replace(".", ","));
  const [climb, setClimb] = useState(String(settings.climbFactor ?? 8).replace(".", ","));
  const [pace, setPace] = useState(paceText(settings.referencePaceSecondsPerKm ?? 360));
  const [classes, setClasses] = useState<Record<string, SpeedClass>>({ ...settings.classBySymbol });
  const [message, setMessage] = useState<Message>();
  const [saving, setSaving] = useState(false);
  useEffect(() => { setClasses({ ...settings.classBySymbol }); }, [settings]);
  // Okända enligt modellen plus de som tävlingen redan valt (så att ett val kan ändras igen).
  const rows = [...unknownSymbols.map(symbol => ({ code: symbol.code, name: symbol.name, objects: symbol.objects })),
    ...Object.keys(settings.classBySymbol ?? {}).filter(code => !unknownSymbols.some(symbol => symbol.code === code))
      .map(code => ({ code, name: "", objects: 0 }))];

  async function save() {
    const contourValue = parseNumber(contour), climbValue = parseNumber(climb), paceValue = parsePace(pace);
    if (contourValue === undefined || contourValue < 0.5 || contourValue > 50 || climbValue === undefined || climbValue < 0 || climbValue > 50 ||
      paceValue === undefined) { setMessage({ tone: "error", text: text.settings.invalid }); return; }
    setSaving(true); setMessage(undefined);
    const next: RouteChoiceSettingsDto = { ...settings, version: 1, contourIntervalMeters: contourValue, climbFactor: climbValue,
      referencePaceSecondsPerKm: paceValue, ...(Object.keys(classes).length > 0 ? { classBySymbol: classes } : {}) };
    if (Object.keys(classes).length === 0) delete (next as { classBySymbol?: unknown }).classBySymbol;
    const ok = await onSave(next);
    setSaving(false);
    setMessage(ok ? { tone: "ok", text: text.settings.saved } : { tone: "error", text: text.settings.failed });
  }

  return <details className={styles.details}>
    <summary>{text.settings.heading}</summary>
    <div className={styles.form}>
      <p className={styles.muted}>{text.settings.help}</p>
      <div className={styles.numbers}>
        <label>{text.settings.contour}<input inputMode="decimal" value={contour} onChange={event => setContour(event.target.value)} /></label>
        <label>{text.settings.climbFactor}<input inputMode="decimal" value={climb} onChange={event => setClimb(event.target.value)} /></label>
        <label>{text.settings.pace}<input inputMode="numeric" value={pace} onChange={event => setPace(event.target.value)} /></label>
      </div>
      <h4>{text.settings.unknownHeading}</h4>
      {rows.length === 0 ? <p className={styles.muted}>{text.settings.unknownNone}</p> : <>
        <p className={styles.muted}>{text.settings.unknownHelp}</p>
        <ul className={styles.symbols}>{rows.map(row => <li key={row.code}>
          <span>{text.settings.unknownRow(row.code, row.name, row.objects)}</span>
          <select aria-label={text.settings.classLabel(row.code)} value={classes[row.code] ?? ""}
            onChange={event => setClasses(current => {
              const next = { ...current };
              if (event.target.value) next[row.code] = event.target.value as SpeedClass; else delete next[row.code];
              return next;
            })}>
            <option value="">{text.classes.NORMAL}</option>
            {ROUTE_CHOICE_SPEED_CLASSES.map(value => <option key={value} value={value}>{text.classes[value]}</option>)}
          </select>
        </li>)}</ul>
      </>}
      <div className={styles.actions}><Button onClick={() => void save()} disabled={saving}>{text.settings.save}</Button></div>
      {message && <Notice tone={message.tone === "ok" ? "ok" : "error"} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    </div>
  </details>;
}

/** Steg 60: "Justera farterna efter de här rutterna" med före/efter och "Spara". */
export function RouteChoiceCalibration({ runners, onCalibrate, onSave }: {
  runners: number; onCalibrate: () => Promise<CalibrationResult | undefined>; onSave: (speeds: SpeedFactors) => Promise<boolean>;
}) {
  const [result, setResult] = useState<CalibrationResult>();
  const [state, setState] = useState<"idle" | "running" | "failed" | "saved" | "saveFailed">("idle");
  const format = (value: number | undefined) => value === undefined ? "–" : value.toFixed(2).replace(".", ",");
  async function calibrate() {
    setState("running"); setResult(undefined);
    const next = await onCalibrate();
    if (next) { setResult(next); setState("idle"); } else setState("failed");
  }
  async function save() {
    if (!result) return;
    setState(await onSave(result.after) ? "saved" : "saveFailed");
  }
  return <details className={styles.details}>
    <summary>{text.calibration.heading}</summary>
    <div className={styles.form}>
      {runners === 0 ? <p className={styles.muted}>{text.calibration.none}</p> : <>
        <p className={styles.muted}>{text.calibration.help(runners)}</p>
        <div className={styles.actions}><Button variant="secondary" onClick={() => void calibrate()} disabled={state === "running"}>
          {text.calibration.button}</Button></div>
        {state === "running" && <p role="status" className={styles.status}>{text.calibration.running}</p>}
        {state === "failed" && <Notice tone="error" role="alert">{text.calibration.failed}</Notice>}
        {result && <>
          <table className={styles.table}>
            <caption>{text.calibration.caption}</caption>
            <thead><tr><th scope="col">{text.calibration.kind}</th><th scope="col">{text.calibration.before}</th><th scope="col">{text.calibration.after}</th></tr></thead>
            <tbody>{ROUTE_CHOICE_SPEED_FACTOR_CLASSES.map(kind => <tr key={kind}><th scope="row">{text.shortClasses[kind]}</th>
              <td>{format(result.before[kind])}</td><td>{format(result.after[kind])}</td></tr>)}</tbody>
          </table>
          <p className={styles.muted}>{text.calibration.samples(result.samples)}</p>
          <div className={styles.actions}><Button onClick={() => void save()}>{text.calibration.save}</Button></div>
          {state === "saved" && <Notice tone="ok" role="status">{text.calibration.saved}</Notice>}
          {state === "saveFailed" && <Notice tone="error" role="alert">{text.settings.failed}</Notice>}
        </>}
      </>}
    </div>
  </details>;
}
