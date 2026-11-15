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

/** Ägaren 2026-11-15: «Skriv ut PDF» i kartläget – hela kartan (med ram och namn när kartan har dem) som PDF. */
export function MapProjectPrintButton({ projectId, pending }: { projectId: string; pending: number }) {
  const text = useTexts(mapProjectPrintSv, mapProjectPrintEn);
  const [state, setState] = useState<State>({ kind: "idle" });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => () => { if (state.kind === "ready") URL.revokeObjectURL(state.url); }, [state]);

  const start = async () => {
    setState({ kind: "working" });
    const base = mapProjectBase(projectId);
    const started = await clubRequest(`${base}/pdf`, "POST");
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
    {state.kind === "ready" && <span role="status">{state.text} <a href={state.url} target="_blank" rel="noopener">{text.open}</a></span>}
    {state.kind === "problem" && <span role="alert">{state.text}</span>}
  </span>;
}
