"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReadoutPackage } from "@o-tid/contracts";
import { WebSerialTransport, type WebSerialPortLike } from "@o-tid/device-transport";
import type { StationReport } from "@o-tid/sportident";
import { stationsSv as text } from "../i18n/stations-sv";
import { fetchReadoutPackage } from "../readout/api";
import { readStation, StationReadError, type StationReadProblem, type TrafficEntry } from "../lib/station-read-runner";
import { Button, Notice, Section } from "./ui";
import styles from "./account-pages.module.css";

type SerialNavigator = Navigator & { serial?: { requestPort(): Promise<WebSerialPortLike> } };
const clock12 = (seconds: number | null) => seconds === null ? "–"
  : [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(part => String(part).padStart(2, "0")).join(":");

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Ägaren 2026-11-08: läsa ut en enhet utan Config+ (bara läsning, provas). Huvudstationen ansluts med Web Serial; enheten som
 * ligger mot den läses i fjärrläge. Brickorna i backupminnet visas med löparen om brickan finns i tävlingen.
 */
export function StationsPage({ raceId }: { raceId: string }) {
  const [transport, setTransport] = useState<WebSerialTransport>();
  const [remote, setRemote] = useState(true);
  const [busy, setBusy] = useState<{ done: number; total: number }>();
  const [problem, setProblem] = useState<StationReadProblem | "open" | "serial">();
  const [result, setResult] = useState<{ report: StationReport; readAt: number }>();
  const [pkg, setPkg] = useState<ReadoutPackage | null>();
  const traffic = useRef<TrafficEntry[]>([]);

  useEffect(() => {
    void fetchReadoutPackage(raceId).then(outcome => setPkg(outcome.kind === "ok" ? outcome.value : null), () => setPkg(null));
  }, [raceId]);
  useEffect(() => () => { void transport?.close(); }, [transport]);

  const names = new Map<number, string>();
  if (pkg) {
    const entries = new Map(pkg.raceSnapshot.entries.map(entry => [entry.id, entry]));
    for (const assignment of pkg.raceSnapshot.cardAssignments) {
      const entry = entries.get(assignment.entryId);
      if (entry && /^\d+$/.test(assignment.cardNumber)) names.set(Number(assignment.cardNumber),
        [`${entry.givenName} ${entry.familyName}`.trim(), entry.organisationName].filter(Boolean).join(", "));
    }
  }
  const codesInRace = new Set(pkg?.raceSnapshot.courses.flatMap(course => course.versions.flatMap(version =>
    version.controls.map(control => control.controlCode))) ?? []);

  async function connect() {
    const serial = (navigator as SerialNavigator).serial;
    if (!serial) { setProblem("serial"); return; }
    let port: WebSerialPortLike;
    try { port = await serial.requestPort(); } catch { return; }
    const next = new WebSerialTransport(port, { baudRate: 38_400 });
    try { await next.open(); setTransport(next); setProblem(undefined); }
    catch { setProblem("open"); }
  }

  async function read() {
    if (!transport) return;
    setProblem(undefined); setResult(undefined); setBusy({ done: 0, total: 0 });
    try {
      const { report } = await readStation(transport, { remote, traffic: traffic.current, onProgress: (done, total) => setBusy({ done, total }) });
      setResult({ report, readAt: Date.now() });
    } catch (error) {
      setProblem(error instanceof StationReadError ? error.problem : "transport");
    } finally { setBusy(undefined); }
  }

  function csv(report: StationReport) {
    const rows = [["serienummer", "kod", "bricka", "tid_12h", "lopare", "ra"].join(";"),
      ...report.punches.map(punch => [report.system.serialNumber, report.system.code, punch.cardNumber, clock12(punch.secondsIn12h),
        (names.get(punch.cardNumber) ?? "").replaceAll(";", ","), punch.rawHex].join(";"))];
    download(`enhet-${report.system.serialNumber}-kod-${report.system.code}.csv`, "text/csv;charset=utf-8", `\uFEFF${rows.join("\r\n")}\r\n`);
  }

  const report = result?.report;
  const clockDiff = report?.clock && result ? (() => {
    const now = new Date(result.readAt);
    const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    return report.clock.secondsOfDay + report.clock.milliseconds / 1000 - nowSeconds;
  })() : undefined;

  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}>
      <div><h1>{text.title}</h1></div>
      <nav className={styles.headerNav} aria-label={text.title}><Link href={`/admin/${raceId}/manage`}>{text.back}</Link></nav>
    </header>
    <Notice tone="info">{text.trial}</Notice>
    <Section id="enheter-anslut" title={text.connect} help={text.howTo}>
      {!transport ? <Button onClick={() => void connect()}>{text.connect}</Button> : <>
        <p role="status">{text.connected} <Button variant="quiet" onClick={() => { void transport.close(); setTransport(undefined); }}>{text.disconnect}</Button></p>
        <fieldset className={styles.form}>
          <label><input type="radio" checked={remote} onChange={() => setRemote(true)} /> {text.remote}</label>
          <label><input type="radio" checked={!remote} onChange={() => setRemote(false)} /> {text.direct}</label>
        </fieldset>
        <Button disabled={!!busy} onClick={() => void read()} data-testid="station-read">{text.read}</Button>
      </>}
      {busy && <p role="status">{text.reading(busy.done, busy.total)}</p>}
      {problem && <Notice tone="error" role="alert">{problem === "serial" ? text.serialUnsupported : text.problems[problem]}</Notice>}
      {traffic.current.length > 0 && !busy && <p><Button variant="quiet" onClick={() => download(`ra-logg-enheter-${Date.now()}.json`, "application/json",
        JSON.stringify({ formatVersion: 1, kind: "o-tid-station-read", traffic: traffic.current }, null, 1))}>{text.rawLog}</Button></p>}
    </Section>
    {report && <Section id="enheter-resultat" title={`${report.system.model ?? "Enhet"} ${report.system.serialNumber}`}>
      <dl className={styles.facts} data-testid="station-facts">
        <dt>{text.facts.serial}</dt><dd>{report.system.serialNumber}</dd>
        <dt>{text.facts.model}</dt><dd>{report.system.model ?? `0x${report.system.modelId.toString(16)}`}</dd>
        <dt>{text.facts.firmware}</dt><dd>{report.system.firmware}</dd>
        <dt>{text.facts.code}</dt><dd>{report.system.code}</dd>
        <dt>{text.facts.mode}</dt><dd>{(report.system.modeName && text.modes[report.system.modeName]) ?? report.system.mode}</dd>
        <dt>{text.facts.battery}</dt><dd>{report.system.batteryDate ?? "–"}</dd>
        <dt>{text.facts.capacity}</dt><dd>{report.system.batteryCapacityRaw} ({report.system.batteryStateHex})</dd>
        <dt>{text.facts.memory}</dt><dd>{text.facts.memoryValue(report.system.memoryKb, report.punches.length, report.system.memoryOverflow)}</dd>
        {clockDiff !== undefined && <><dt>{text.facts.clock}</dt><dd>{text.facts.clockDiff(clockDiff)}</dd></>}
      </dl>
      {pkg && <p>{text.controlInRace(report.system.code, codesInRace.has(report.system.code))}</p>}
      {pkg === null && <p className={styles.muted}>{text.noPackage}</p>}
      <h3>{text.punches}</h3>
      {report.truncated && <p className={styles.muted}>{text.truncated}</p>}
      {report.punches.length === 0 ? <p>{text.none}</p> : <>
        <p><Button variant="secondary" onClick={() => csv(report)}>{text.csv}</Button></p>
        <table data-testid="station-punches"><thead><tr><th>{text.card}</th><th>{text.time}</th><th>{text.runner}</th></tr></thead>
          <tbody>{[...report.punches].reverse().map((punch, index) => <tr key={`${punch.rawHex}-${index}`}>
            <td>{punch.cardNumber}</td><td>{clock12(punch.secondsIn12h)}</td><td>{names.get(punch.cardNumber) ?? (pkg ? text.unknownCard : "")}</td>
          </tr>)}</tbody></table>
      </>}
    </Section>}
  </main>;
}
