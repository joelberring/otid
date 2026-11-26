"use client";

import { useEffect, useRef, useState } from "react";
import { mapProjectPrintEn } from "../../i18n/map-project-print-en";
import { mapProjectPrintSv } from "../../i18n/map-project-print-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import { useTexts } from "../language-provider";
import styles from "./map-project-editor.module.css";

type State = { kind: "idle" } | { kind: "working" } | { kind: "ready"; url: string; text: string } | { kind: "problem"; text: string };
const POLL_MS = 1500, MAX_WAIT_MS = 5 * 60_000;

/** Ägaren 2026-11-15: «Skriv ut PDF» i kartläget – hela kartan (med ram och namn när kartan har dem) som PDF i kartans riktiga färger som standard. */
export function MapProjectPrintButton({ projectId, pending }: { projectId: string; pending: number }) {
  const text = useTexts(mapProjectPrintSv, mapProjectPrintEn);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightenForOffice, setLightenForOffice] = useState(false);
  const [pressMode, setPressMode] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => () => { if (state.kind === "ready") URL.revokeObjectURL(state.url); }, [state]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setMenuOpen(false); } };
    const onDown = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onDown, true); };
  }, [menuOpen]);

  const start = async () => {
    setMenuOpen(false);
    setState({ kind: "working" });
    const base = mapProjectBase(projectId);
    const body = { mode: pressMode ? "PRESS" as const : "OFFICE" as const, lightenForOffice: !pressMode && lightenForOffice };
    const started = await clubRequest(`${base}/pdf`, "POST", body);
    if (started.status === 429) { setState({ kind: "problem", text: text.busy }); return; }
    const jobId = (started.json as { jobId?: string } | undefined)?.jobId;
    if (started.status !== 202 || !jobId) { setState({ kind: "problem", text: text.failed(String(started.status)) }); return; }
    const deadline = Date.now() + MAX_WAIT_MS;
    while (alive.current && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
      const response = await fetch(`${base}/pdf?job=${encodeURIComponent(jobId)}`, { credentials: "same-origin", cache: "no-store" });
      if (response.status === 202) continue;
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const head = response.headers;
        const size = head.get("x-otid-paper-size") || undefined, landscape = head.get("x-otid-paper-landscape") === "true";
        setState({ kind: "ready", url, text: text.ready(size, landscape, Number(head.get("x-otid-paper-width")), Number(head.get("x-otid-paper-height"))) });
        window.open(url, "_blank", "noopener");
        return;
      }
      const error = await response.json().catch(() => undefined) as { error?: string } | undefined;
      setState({ kind: "problem", text: text.failed(error?.error ?? String(response.status)) });
      return;
    }
    if (alive.current) setState({ kind: "problem", text: text.slow });
  };

  return <span className={styles.printPdf}>
    <button type="button" className={styles.bareToggle} title={pending > 0 ? `${text.help} ${text.unsaved}` : text.help} disabled={state.kind === "working"}
      data-testid="map-project-print-pdf" onClick={() => { void start(); }}>{state.kind === "working" ? text.working : text.button}</button>
    <div className={styles.viewMenu} ref={menuRef}>
      <button type="button" className={styles.bareToggle} aria-label={text.options} title={text.options} aria-haspopup="true" aria-expanded={menuOpen}
        disabled={state.kind === "working"} data-testid="map-project-print-options" onClick={() => setMenuOpen(open => !open)}>
        <span aria-hidden="true">▾</span>
      </button>
      {menuOpen && <div className={styles.viewMenuList} role="group" aria-label={text.options}>
        <p className={styles.viewMenuHelp}>{text.optionsHelp}</p>
        <label className={styles.viewMenuItem}>
          <input type="checkbox" checked={!pressMode && lightenForOffice} disabled={pressMode}
            onChange={event => setLightenForOffice(event.target.checked)} data-testid="map-project-print-lighten" />
          <span>{text.lightenOffice}</span>
        </label>
        <p className={styles.viewMenuHelp}>{text.lightenOfficeHelp}</p>
        <label className={styles.viewMenuItem}>
          <input type="checkbox" checked={pressMode} onChange={event => setPressMode(event.target.checked)} data-testid="map-project-print-press" />
          <span>{text.pressMode}</span>
        </label>
        <p className={styles.viewMenuHelp}>{text.pressModeHelp}</p>
      </div>}
    </div>
    {state.kind === "ready" && <span role="status">{state.text} <a href={state.url} target="_blank" rel="noopener">{text.open}</a></span>}
    {state.kind === "problem" && <span role="alert">{state.text}</span>}
  </span>;
}
