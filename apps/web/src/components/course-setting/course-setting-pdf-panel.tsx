"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PrintJob, PrintJobKind, PrintJobs } from "@o-tid/contracts";
import type { PrintProfile } from "@o-tid/course-setting";
import type { MapColor } from "@o-tid/map-file";
import { printPdfSv as text } from "../../i18n/course-setting-print-pdf-sv";
import { printProfileSv } from "../../i18n/course-setting-print-profile-sv";
import {
  createPrintJob, deletePrintJob, fetchPrintJobs, pdfAllowed, pdfPreflight, printJobPdfUrl, printJobRequest, type PrintJobSelection
} from "../../lib/course-setting-print-jobs";
import { Button, Notice } from "../ui";
import styles from "./course-setting-print-page.module.css";

/**
 * Steg 65 (ADR-0184): "Skapa PDF för tryck" och "Skapa PDF för kontorsskrivare" i förhandsvisningen. Förhandskontrollen
 * (ColorPreflight mot det PDF:en kan) visas först: blockerande fel stoppar och varningar måste bekräftas. Jobben skrivs
 * på servern med låg prioritet; listan frågar varannan sekund medan något väntar eller skrivs.
 */
export function PdfPanel({ raceId, selection, profile, colors, disabled, blockedText }: {
  raceId: string; selection: PrintJobSelection; profile: PrintProfile; colors: readonly MapColor[]; disabled: boolean; blockedText?: string | undefined;
}) {
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [warningsConfirmed, setWarningsConfirmed] = useState(false);
  const [mapSpots, setMapSpots] = useState(true);
  const [jobs, setJobs] = useState<PrintJobs>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [busy, setBusy] = useState(false);
  const report = useMemo(() => colors.length > 0 ? pdfPreflight(profile, colors, confirmed) : undefined, [profile, colors, confirmed]);
  const hasSpots = colors.some(color => color.spot);
  useEffect(() => { setWarningsConfirmed(false); setConfirmed(new Set()); }, [profile.id]);

  const load = useCallback(async () => {
    try { setJobs(await fetchPrintJobs(raceId)); } catch (error) { console.error("PDF-jobben kunde inte läsas", error); }
  }, [raceId]);
  useEffect(() => { void load(); }, [load]);
  const pending = jobs?.jobs.some(job => job.status === "QUEUED" || job.status === "RUNNING") ?? false;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => { void load(); }, 2000);
    return () => window.clearInterval(timer);
  }, [pending, load]);

  async function create(kind: PrintJobKind) {
    setBusy(true);
    setMessage(undefined);
    try {
      const request = printJobRequest(selection, kind, kind === "OFFICE" ? "office" : profile.id,
        kind === "OFFICE" ? { warnings: true, rules: [] } : { warnings: warningsConfirmed, rules: [...confirmed] });
      const result = await createPrintJob(raceId, request);
      setMessage(result.kind === "ok" ? { tone: "ok", text: text.created } : { tone: "error", text: result.problem.message });
      await load();
    } catch (error) {
      console.error("PDF-jobbet kunde inte skapas", error);
      setMessage({ tone: "error", text: text.failed });
    } finally { setBusy(false); }
  }

  async function remove(job: PrintJob) {
    try { await deletePrintJob(raceId, job.id); await load(); } catch (error) { console.error("PDF-jobbet kunde inte tas bort", error); }
  }

  const allowed = pdfAllowed(report, warningsConfirmed);
  const warnings = report?.findings.some(finding => finding.severity === "WARNING") ?? false;
  return <section className={styles.panel} aria-labelledby="print-pdf" data-testid="print-pdf">
    <h2 id="print-pdf">{text.heading}</h2>
    <p className={styles.muted}>{text.help}</p>
    <Notice tone="attention"><p data-testid="print-pdf-honesty">{text.honesty}</p></Notice>
    {report ? <div className={styles.stack} data-testid="print-pdf-preflight" data-can-print={report.canPrint ? "yes" : "no"}>
      <h3>{text.preflight}: {report.canPrint ? text.preflightOk : text.preflightBlocked}</h3>
      {report.findings.length === 0 ? <p className={styles.muted}>{text.noFindings}</p>
        : <ul className={styles.findings}>{report.findings.map((finding, index) => <li key={index} data-severity={finding.severity}>
          <strong>{printProfileSv.severity[finding.severity]}</strong> {finding.text}
          {finding.severity === "BLOCKING" && finding.rule && report.results.find(result => result.rule === finding.rule)?.status === "NEEDS_CONFIRMATION" &&
            <Button variant="quiet" onClick={() => setConfirmed(current => new Set([...current, finding.rule!]))}>{text.confirm}</Button>}
        </li>)}</ul>}
      {warnings && <label className={styles.check}><input type="checkbox" checked={warningsConfirmed} onChange={event => setWarningsConfirmed(event.target.checked)}
        data-testid="print-pdf-confirm" />{text.confirmWarnings}</label>}
    </div> : <p className={styles.muted}>{text.noColors}</p>}
    {hasSpots && <div className={styles.row} role="radiogroup" aria-label={text.mapColors}>
      <span>{text.mapColors}:</span>
      <label className={styles.check}><input type="radio" name="pdf-map-colors" checked={mapSpots} onChange={() => setMapSpots(true)} />{text.mapSpots}</label>
      <label className={styles.check}><input type="radio" name="pdf-map-colors" checked={!mapSpots} onChange={() => setMapSpots(false)} />{text.mapProcess}</label>
    </div>}
    <div className={styles.row}>
      <Button onClick={() => void create(mapSpots ? "PRESS" : "PROCESS")} disabled={disabled || busy || !allowed} data-testid="print-pdf-press">{text.press}</Button>
      <Button variant="secondary" onClick={() => void create("OFFICE")} disabled={disabled || busy} data-testid="print-pdf-office">{text.office}</Button>
      {busy && <span role="status">{text.creating}</span>}
    </div>
    {blockedText && <p className={styles.muted}>{blockedText}</p>}
    {!allowed && report && <p className={styles.muted}>{text.blocked}</p>}
    {message && <Notice tone={message.tone === "ok" ? "ok" : "error"} role="status"><p>{message.text}</p></Notice>}
    <h3>{text.jobs}</h3>
    {jobs && <p className={styles.muted}>{text.keep(jobs.keepDays, Math.round(jobs.maxBytes / 1e6))}</p>}
    {!jobs || jobs.jobs.length === 0 ? <p className={styles.muted}>{text.noJobs}</p> : <ul className={styles.jobs}>
      {jobs.jobs.map(job => <li key={job.id} data-testid="print-job" data-status={job.status} data-kind={job.kind}>
        <div><strong>{job.label}</strong> <span className={styles.muted}>({text.version(job.documentVersion)})</span></div>
        <div role="status">{text.status[job.status](job.position)}{job.status === "DONE" ? ` – ${text.size(job.pages, job.byteLength)}` : ""}
          {job.status === "FAILED" && job.error ? `: ${job.error}` : ""}</div>
        {job.status === "DONE" && <div className={styles.muted}>{text.plates(job.plates, job.overprint)}</div>}
        {job.notes.length > 0 && <details><summary>{text.notes}</summary><ul className={styles.problems}>{job.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
        <div className={styles.row}>
          {job.status === "DONE" && <a href={printJobPdfUrl(raceId, job.id)} download data-testid="print-job-download">{text.download}</a>}
          <Button variant="quiet" onClick={() => void remove(job)}>{text.remove}</Button>
        </div>
      </li>)}
    </ul>}
  </section>;
}
