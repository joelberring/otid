"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { printColorsEn } from "../../i18n/course-setting-print-more-en";
import { printPdfEn } from "../../i18n/course-setting-print-more-en";
import { useTexts } from "../language-provider";
import type { PrintJob, PrintJobKind, PrintJobs } from "@o-tid/contracts";
import { mapColorAdjust, officePrintProfile, UNCONFIRMED_RULE, type PrintProfile } from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { printPdfSv } from "../../i18n/course-setting-print-pdf-sv";
import { printColorsSv } from "../../i18n/course-setting-print-colors-sv";
import { colorModeOf } from "../../lib/course-setting-print-colors-mode";
import {
  createPrintJob, deletePrintJob, fetchPrintJobs, pdfAllowed, pdfPreflight, printJobPdfUrl, printJobRequest, type PrintJobSelection
} from "../../lib/course-setting-print-jobs";
import { Button, Notice } from "../ui";
import { racePrintFilesEn } from "../../i18n/race-print-files-en";
import { racePrintFilesSv } from "../../i18n/race-print-files-sv";
import { saveRacePrintJob } from "../../lib/race-print-files";
import styles from "./course-setting-print-page.module.css";

/**
 * Steg 65 (ADR-0184): "Skapa PDF för tryck" och "Skapa PDF för kontorsskrivare" i förhandsvisningen. Förhandskontrollen
 * (ColorPreflight mot det PDF:en kan) visas först: blockerande fel stoppar och varningar måste bekräftas. Jobben skrivs
 * på servern med låg prioritet; listan frågar varannan sekund medan något väntar eller skrivs.
 */
export function PdfPanel({ raceId, selection, profile, colors, usage, disabled, blockedText, heading, help, onSaved }: {
  raceId: string; selection: PrintJobSelection; profile: PrintProfile; colors: readonly MapColor[]; usage?: ReadonlyMap<number, ColorUsage> | undefined;
  disabled: boolean; blockedText?: string | undefined;
  /** Rubriken och raden under (ADR-0211 beslut 7: "Skapa PDF för tryckeriet" bredvid "Skriv ut på skrivare"). */
  heading?: string | undefined; help?: string | undefined;
  /** Ägaren 2026-11-10: ett klart jobb sparat i träningen (Sparade utskrifter). */
  onSaved?: (() => void) | undefined;
}) {
  const savedText = useTexts(racePrintFilesSv, racePrintFilesEn);
  const colorsText = useTexts(printColorsSv, printColorsEn);
  const text = useTexts(printPdfSv, printPdfEn);
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [warningsConfirmed, setWarningsConfirmed] = useState(false);
  const [mapSpots, setMapSpots] = useState(true);
  const [lightenForOffice, setLightenForOffice] = useState(false);
  const [jobs, setJobs] = useState<PrintJobs>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [busy, setBusy] = useState(false);
  const report = useMemo(() => colors.length > 0 ? pdfPreflight(profile, colors, confirmed, usage) : undefined, [profile, colors, confirmed, usage]);
  const adjust = useMemo(() => mapColorAdjust(profile, colors), [profile, colors]);
  // BL-profilerna vill ha CMYK: då finns inget val för kartans dekorfärger. Inkludera egna `mapColors[].spot` (och respektera `spot: null`).
  const hasSpots = !profile.processColors && (
    colors.some(color => {
      const setting = adjust[color.id];
      if (setting?.hidden) return false;
      if (setting?.spot !== undefined) return setting.spot !== null;
      return Boolean(color.spot);
    }) || profile.mapColors.some(row => Boolean(row.spot))
  );
  const profileSignature = useMemo(() => JSON.stringify(profile), [profile]);
  useEffect(() => { setWarningsConfirmed(false); setConfirmed(new Set()); }, [profileSignature]);

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
      // Kontorsskrivaren: behåller tävlingsprofilens valda färger/BL-beslut/banfärg och lägger bara till ljusning när användaren väljer det.
      const officeProfile = kind === "OFFICE" ? officePrintProfile(profile, { lighten: lightenForOffice }) : undefined;
      const request = kind === "OFFICE"
        ? printJobRequest(selection, kind, officeProfile!.id, { warnings: true, rules: [] }, undefined, officeProfile)
        : printJobRequest(selection, kind, profile.id, { warnings: warningsConfirmed, rules: [...confirmed] });
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

  const proposalHref = colorModeOf(profile) === "BL" ? "#bl-doubtful" : "#bl-proposal";
  function goToProposal(event: MouseEvent<HTMLAnchorElement>) {
    const proposal = window.document.getElementById("bl-proposal");
    if (proposal) { event.preventDefault(); proposal.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const doubtfulEl = window.document.getElementById("bl-doubtful");
    if (doubtfulEl) { event.preventDefault(); doubtfulEl.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const details = window.document.querySelector<HTMLDetailsElement>('[data-testid="print-colors-advanced"]');
    if (details) {
      event.preventDefault();
      if (!details.open) details.querySelector("summary")?.click();
      window.setTimeout(() => window.document.getElementById("bl-proposal")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
  }

  const allowed = pdfAllowed(report, warningsConfirmed);
  const warnings = report?.findings.some(finding => finding.severity === "WARNING") ?? false;
  // Varningen om obekräftade färger står redan på raden ovanför listan (med färgernas namn): visa den inte två gånger.
  const listed = report?.findings.filter(finding => finding.rule !== UNCONFIRMED_RULE) ?? [];
  return <section className={styles.panel} aria-labelledby="print-pdf" data-testid="print-pdf">
    <h3 id="print-pdf">{heading ?? text.heading}</h3>
    <p className={styles.muted}>{help ?? text.help}</p>
    <Notice tone="attention"><p data-testid="print-pdf-honesty">{text.honesty}</p></Notice>
    {profile.processColors && <p className={styles.muted} data-testid="print-pdf-process">{text.processOnly(profile.name)}</p>}
    {report ? <div className={styles.stack} data-testid="print-pdf-preflight" data-can-print={report.canPrint ? "yes" : "no"}
      data-unconfirmed={report.unconfirmed?.length ?? ""}>
      <h3>{text.preflight}: {report.canPrint ? text.preflightOk : text.preflightBlocked}</h3>
      {report.unconfirmed !== undefined && <p data-testid="print-pdf-unconfirmed"><strong>{report.unconfirmed.length === 0 ? text.allConfirmed
        : text.unconfirmed(report.unconfirmed.length, report.unconfirmed)}</strong>{report.unconfirmed.length > 0 && <> <a href={proposalHref} onClick={goToProposal} data-testid="print-pdf-to-proposal">{text.toProposal}</a></>}</p>}
      {report.findings.length === 0 ? <p className={styles.muted}>{text.noFindings}</p>
        : listed.length > 0 && <ul className={styles.findings}>{listed.map((finding, index) => <li key={index} data-severity={finding.severity}>
          <strong>{colorsText.severity[finding.severity]}</strong> {finding.text}
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
    <label className={styles.check}>
      <input type="checkbox" checked={lightenForOffice} onChange={event => setLightenForOffice(event.target.checked)} data-testid="print-pdf-office-lighten" />
      {text.officeLighten}
    </label>
    <div className={styles.row}>
      <Button onClick={() => void create(mapSpots ? "PRESS" : "PROCESS")} disabled={disabled || busy || !allowed} data-testid="print-pdf-press">{text.press}</Button>
      <Button variant="secondary" onClick={() => void create("OFFICE")} disabled={disabled || busy} data-testid="print-pdf-office">{text.office}</Button>
      {busy && <span role="status">{text.creating}</span>}
    </div>
    <p className={styles.muted} data-testid="print-pdf-overprint-viewer">{text.overprintViewer}</p>
    {blockedText && <p className={styles.muted}>{blockedText}</p>}
    {!allowed && report && <p className={styles.muted}>{text.blocked}</p>}
    {message && <Notice tone={message.tone === "ok" ? "ok" : "error"} role="status"><p>{message.text}</p></Notice>}
    <h3 title={jobs ? text.keep(jobs.keepDays, Math.round(jobs.maxBytes / 1e6)) : undefined}>{text.jobs}</h3>
    {!jobs || jobs.jobs.length === 0 ? <p className={styles.muted}>{text.noJobs}</p> : <ul className={styles.jobs}>
      {jobs.jobs.map(job => <li key={job.id} data-testid="print-job" data-status={job.status} data-kind={job.kind}>
        <div><strong>{job.label}</strong> <span className={styles.muted}>({text.version(job.documentVersion)})</span></div>
        <div role="status">{text.status[job.status](job.position)}{job.status === "DONE" ? ` – ${text.size(job.pages, job.byteLength)}` : ""}
          {job.status === "FAILED" && job.error ? `: ${job.error}` : ""}</div>
        {job.status === "DONE" && <div className={styles.muted}>{text.plates(job.plates, job.overprint)}</div>}
        {job.notes.length > 0 && <details><summary>{text.notes}</summary><ul className={styles.problems}>{job.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
        <div className={styles.row}>
          {job.status === "DONE" && <a href={printJobPdfUrl(raceId, job.id)} download data-testid="print-job-download">{text.download}</a>}
          {job.status === "DONE" && <Button variant="secondary" data-testid="print-job-save" onClick={() => void saveRacePrintJob(raceId, job.id,
            `${job.label.replace(/[:/\\]/g, " ").slice(0, 100)}.pdf`).then(() => { setMessage({ tone: "ok", text: savedText.savedJob }); onSaved?.(); },
            () => setMessage({ tone: "error", text: savedText.failed }))}>{savedText.saveJob}</Button>}
          <Button variant="quiet" onClick={() => void remove(job)}>{text.remove}</Button>
        </div>
      </li>)}
    </ul>}
  </section>;
}
