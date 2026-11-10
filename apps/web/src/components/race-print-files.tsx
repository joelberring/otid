"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { racePrintFilesEn } from "../i18n/race-print-files-en";
import { racePrintFilesSv } from "../i18n/race-print-files-sv";
import { HttpError } from "../lib/course-setting-api";
import { fetchRacePrintFiles, racePrintFileUrl, removeRacePrintFile, uploadRacePrintFile, type RacePrintFile } from "../lib/race-print-files";
import { useLocale, useTexts } from "./language-provider";
import { Button } from "./ui";

/**
 * Ägaren 2026-11-10: träningens sparade utskrifter (PDF). I banläggningens utskrift och på veckan i terminsplanen. Den som
 * får ändra laddar upp och tar bort; alla som ser banläggningen laddar ner. `reloadKey` läser om listan (t.ex. efter
 * "Spara i träningen" på ett tryckjobb).
 */
export function RacePrintFiles({ raceId, canEdit, reloadKey = 0, compact = false, onCount }: {
  raceId: string; canEdit: boolean; reloadKey?: number; compact?: boolean; onCount?: (count: number) => void;
}) {
  const text = useTexts(racePrintFilesSv, racePrintFilesEn);
  const locale = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<readonly RacePrintFile[]>();
  const [maxBytes, setMaxBytes] = useState(40_000_000);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const load = useCallback(async () => {
    try { const result = await fetchRacePrintFiles(raceId); setFiles(result.files); setMaxBytes(result.maxBytes); onCount?.(result.files.length); }
    catch (error) { console.error("De sparade utskrifterna kunde inte läsas", error); setFiles([]); }
  }, [raceId, onCount]);
  useEffect(() => { void load(); }, [load, reloadKey]);
  const megabytes = (bytes: number) => (bytes / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 });

  async function upload(file: File) {
    setProblem(undefined);
    if (file.size > maxBytes) { setProblem(text.tooLarge(Math.round(maxBytes / 1e6))); return; }
    setBusy(true);
    try { await uploadRacePrintFile(raceId, file); await load(); }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 0;
      setProblem(status === 400 ? text.notPdf : status === 413 ? text.tooLarge(Math.round(maxBytes / 1e6)) : status === 409 ? text.tooMany : text.failed);
    } finally { setBusy(false); }
  }

  async function remove(file: RacePrintFile) {
    if (!window.confirm(text.removeConfirm(file.fileName))) return;
    try { await removeRacePrintFile(raceId, file.fileId); await load(); } catch { setProblem(text.failed); }
  }

  return <section data-testid="race-print-files" aria-label={text.heading}>
    {!compact && <><h3>{text.heading}</h3><p className="muted">{text.help}</p></>}
    {files && files.length === 0 && <p className="muted">{text.none}</p>}
    {files && files.length > 0 && <ul data-testid="race-print-file-list">
      {files.map(file => <li key={file.fileId} data-testid="race-print-file">
        <a href={racePrintFileUrl(raceId, file.fileId)} download={file.fileName}>{file.label || file.fileName}</a>{" "}
        <small className="muted">{[file.label ? file.fileName : "", text.size(megabytes(file.byteLength)), file.source === "PRINT_JOB" ? text.fromJob : "",
          file.createdBy ? text.by(file.createdBy) : ""].filter(Boolean).join(" · ")}</small>
        {canEdit && <>{" "}<Button variant="quiet" onClick={() => void remove(file)}>{text.remove}</Button></>}
      </li>)}
    </ul>}
    {canEdit && <span>
      <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? text.uploading : text.upload}</Button>
      <input ref={input} type="file" hidden accept="application/pdf,.pdf" data-testid="race-print-file-input"
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    </span>}
    {problem && <p role="alert">{problem}</p>}
  </section>;
}
