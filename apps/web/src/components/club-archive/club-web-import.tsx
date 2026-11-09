"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { clubWebImportEn } from "../../i18n/club-archive-more-en";
import { clubArchiveEn } from "../../i18n/club-archive-en";
import { useTexts } from "../language-provider";
import { buildImportPlan, formatReport, LEADERS_BY_DEFAULT, uploadPlan, type ScanResult, type UploadEvent } from "@o-tid/club-archive";
import { openBrowserSources, scanBrowserSources, type BrowserRoot } from "@o-tid/club-archive/browser";
import { CLUB_ARCHIVE_MAP_MAX_BYTES, type ClubView } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { clubWebImportSv } from "../../i18n/club-import-web-sv";
import { rootSize, rootsFromDrop, rootsFromFileInput, rootsFromFolderInput } from "../../lib/club-import-files";
import { createWebImportClient, WebImportError } from "../../lib/club-web-import-client";
import { HelpLink } from "../help/help-panel";
import { Button, Notice } from "../ui";
import { ClubImportPreview, type ServerState } from "./club-import-preview";
import styles from "./club-archive.module.css";

/** Träningar per omgång i webbläsaren (kommandot tar 100): förloppet rör sig oftare. */
const ENTRIES_PER_BATCH = 25;

type Phase =
  | { kind: "choose" }
  | { kind: "reading"; done: number; total: number }
  | { kind: "checking" }
  | { kind: "preview" }
  | { kind: "uploading"; line: string; value: number; max: number }
  | { kind: "done"; line: string }
  | { kind: "stopped"; line: string; tone: "attention" | "error" };

interface Scanned { readonly labels: readonly string[]; readonly problems: readonly string[]; readonly scan: ScanResult }

const reason = (error: unknown) => error instanceof WebImportError ? error.message : error instanceof Error ? error.message : String(error);
const aborted = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/** `<input webkitdirectory>` finns inte i Reacts typer. */
const directoryInput = { webkitdirectory: "", directory: "" } as Record<string, string>;

/**
 * ADR-0204: importen i webbläsaren. Välj en mapp eller filer (eller dra hit), förhandsgranska (samma läsning och plan som
 * kommandot, i webbläsaren, så att filer som inte används aldrig lämnar datorn), importera med förlopp. Avbryt går när som
 * helst; importen är idempotent, så "Importera" igen fortsätter där den slutade, också efter en stängd flik.
 */
export function ClubWebImport({ club, onChanged }: { club: ClubView; onChanged: () => Promise<void> }) {
  const text = useTexts(clubWebImportSv, clubWebImportEn);
  const clubArchiveText = useTexts(clubArchiveSv, clubArchiveEn);
  const [roots, setRoots] = useState<BrowserRoot[]>([]);
  const [withoutLeaders, setWithoutLeaders] = useState(!LEADERS_BY_DEFAULT);
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const [scanned, setScanned] = useState<Scanned>();
  const [server, setServer] = useState<ServerState>();
  const [dragging, setDragging] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const plan = useMemo(() => scanned ? buildImportPlan(scanned.scan.scanned, { withLeaders: !withoutLeaders }) : undefined, [scanned, withoutLeaders]);
  const busy = phase.kind === "reading" || phase.kind === "checking" || phase.kind === "uploading";

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = text.leaveWarning; return text.leaveWarning; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  useEffect(() => () => controller.current?.abort(), []);

  function add(next: BrowserRoot[]) {
    if (next.length === 0) return;
    setRoots(current => [...current, ...next]);
    setScanned(undefined); setServer(undefined); setPhase({ kind: "choose" });
  }

  function picked(event: ChangeEvent<HTMLInputElement>, folder: boolean) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    add(folder ? rootsFromFolderInput(files) : rootsFromFileInput(files));
  }

  async function dropped(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    add(await rootsFromDrop(event.dataTransfer));
  }

  function clear() {
    setRoots([]); setScanned(undefined); setServer(undefined); setPhase({ kind: "choose" });
  }

  function newController() {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current;
  }

  async function refreshServer(result: Scanned, signal: AbortSignal) {
    setPhase({ kind: "checking" });
    const preview = buildImportPlan(result.scan.scanned, { withLeaders: !withoutLeaders });
    const status = await createWebImportClient(club.clubId, signal, text.errors).status(preview.maps.flatMap(map => map.versions.map(version => version.sha256)),
      preview.trainings.map(training => training.key));
    setServer(status);
  }

  async function preview() {
    const { signal } = newController();
    try {
      setPhase({ kind: "reading", done: 0, total: 0 });
      const sources = await openBrowserSources(roots);
      let shown = 0;
      const scan = await scanBrowserSources(sources.files, { signal, maxMapBytes: CLUB_ARCHIVE_MAP_MAX_BYTES,
        describeTooLarge: (file, limit) => text.mapTooLarge(file.path, file.size, limit),
        onProgress: (done, total) => {
          if (done === total || Date.now() - shown > 120) { shown = Date.now(); setPhase({ kind: "reading", done, total }); }
        } });
      const result = { labels: sources.labels, problems: [...sources.problems, ...scan.problems], scan };
      setScanned(result);
      await refreshServer(result, signal);
      setPhase({ kind: "preview" });
    } catch (error) {
      if (aborted(error) || signal.aborted) { setPhase({ kind: "choose" }); return; }
      setPhase({ kind: "stopped", tone: "error", line: text.readFailed(reason(error)) });
    }
  }

  async function start() {
    if (!scanned || !plan) return;
    const { signal } = newController();
    let value = 0, max = 1;
    const step = (line: string) => { value++; setPhase({ kind: "uploading", line, value: Math.min(value, max), max }); };
    setPhase({ kind: "uploading", line: text.checkingServer, value: 0, max });
    const onEvent = (event: UploadEvent) => {
      if (event.kind === "checked") {
        max = (event.total - event.known) + plan.maps.length + Math.max(1, Math.ceil(plan.trainings.length / ENTRIES_PER_BATCH));
        setPhase({ kind: "uploading", line: text.checkingServer, value, max });
      } else if (event.kind === "map") step(text.progressMap(event.index, event.uploads, event.fileName, event.size));
      else if (event.kind === "mapVersions") step(text.progressVersions(event.index, event.total));
      else step(text.progressTrainings(event.done + event.size, event.total));
    };
    try {
      const result = await uploadPlan({ plan, scan: scanned.scan, client: createWebImportClient(club.clubId, signal, text.errors), onEvent, signal,
        maxEntriesPerBatch: ENTRIES_PER_BATCH });
      const line = text.done(result.uploaded, result.skippedUploads, result.created, result.existing, result.courseFiles);
      await onChanged();
      // Förhandsgranskningen visar efteråt det som nu finns (en omkörning skickar inget nytt).
      await refreshServer(scanned, signal).catch((error: unknown) => console.warn("Förhandsgranskningen kunde inte uppdateras", error));
      setPhase({ kind: "done", line });
    } catch (error) {
      if (aborted(error) || signal.aborted) setPhase({ kind: "stopped", tone: "attention", line: text.cancelled });
      else setPhase({ kind: "stopped", tone: "error", line: text.failed(reason(error)) });
      await onChanged();
    }
  }

  function downloadReport() {
    if (!scanned || !plan) return;
    const report = formatReport(plan, { sources: scanned.labels, dryRun: true, withLeaders: !withoutLeaders, when: new Date() })
      + (scanned.problems.length > 0 ? `\nProblem:\n${scanned.problems.map(line => `  ${line}`).join("\n")}\n` : "");
    const url = URL.createObjectURL(new Blob([report], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `arkivimport-rapport-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const fileCount = roots.reduce((sum, root) => sum + (root.kind === "folder" ? root.files.length : 1), 0);
  return <div className={styles.webImport}>
    <p>{text.intro} <HelpLink article="arkiv-import" /></p>
    <p className={styles.small}>{text.privacy}</p>
    <div className={styles.phoneNote}><Notice tone="info">{text.phoneNote}</Notice></div>
    <div className={styles.dropZone} data-active={dragging} data-testid="import-drop"
      onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => void dropped(event)}>
      <div className={styles.actions}>
        <label className={styles.pick} aria-disabled={busy}>
          {text.chooseFolder}
          <input type="file" multiple disabled={busy} onChange={event => picked(event, true)} {...directoryInput} />
        </label>
        <label className={styles.pick} aria-disabled={busy}>
          {text.chooseFiles}
          <input type="file" multiple disabled={busy} accept=".zip,.ocd,.omap,.xmap,.ppen,.xml" onChange={event => picked(event, false)} />
        </label>
      </div>
      <p className={styles.small}>{dragging ? text.dropActive : text.drop} {text.folderHint}</p>
    </div>
    {roots.length > 0 && <div>
      <h3>{text.chosenTitle}</h3>
      <ul className={styles.plainList} data-testid="import-chosen">
        {roots.map((root, index) => <li key={`${root.name}-${index}`}>
          {root.kind === "folder" ? text.chosenFolder(root.name, root.files.length) : text.chosenFile(root.name, rootSize(root))}
        </li>)}
      </ul>
      <label className={styles.check}>
        <input type="checkbox" checked={withoutLeaders} disabled={phase.kind === "uploading"} onChange={event => setWithoutLeaders(event.target.checked)} />
        {text.leaders}
      </label>
      <p className={styles.small}>{text.leadersHint} <code>{clubArchiveText.importer.leadersFlag}</code>.</p>
      <div className={styles.actions}>
        {(phase.kind === "choose" || (phase.kind === "stopped" && !scanned)) &&
          <Button disabled={fileCount === 0} onClick={() => void preview()}>{text.preview}</Button>}
        {!busy && <Button variant="secondary" onClick={clear}>{scanned ? text.chooseOther : text.clear}</Button>}
      </div>
    </div>}
    {phase.kind === "reading" && <div className={styles.actions}>
      <p role="status">{phase.total === 0 ? text.opening : text.scanning(phase.done, phase.total)}</p>
      <Button variant="secondary" onClick={() => controller.current?.abort()}>{text.cancel}</Button>
    </div>}
    {phase.kind === "checking" && <p role="status">{text.checking}</p>}
    {phase.kind === "uploading" && <div className={styles.progressBox}>
      <h3>{text.progressTitle}</h3>
      <progress max={phase.max} value={phase.value} aria-label={text.progressTitle} />
      <p role="status" data-testid="import-progress">{phase.line}</p>
      <div className={styles.actions}><Button variant="secondary" onClick={() => controller.current?.abort()}>{text.cancel}</Button></div>
    </div>}
    {phase.kind === "done" && <Notice tone="ok" role="status">{phase.line}</Notice>}
    {phase.kind === "stopped" && <Notice tone={phase.tone} role="alert">{phase.line}</Notice>}
    {plan && scanned && server && phase.kind !== "reading" && <>
      <ClubImportPreview plan={plan} scanned={scanned.scan.scanned} problems={scanned.problems} server={server}
        quota={{ used: club.quota.accountUsedBytes, limit: club.quota.accountLimitBytes }} />
      <div className={styles.actions}>
        {phase.kind !== "uploading" && phase.kind !== "checking" && (plan.trainings.length > 0 || plan.maps.length > 0) &&
          <Button onClick={() => void start()}>{phase.kind === "done" ? text.startAgain : text.start}</Button>}
        <Button variant="secondary" onClick={downloadReport}>{text.report}</Button>
      </div>
    </>}
  </div>;
}
