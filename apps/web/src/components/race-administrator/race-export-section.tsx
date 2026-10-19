"use client";

import { useState } from "react";
import { raceExportSv as text } from "../../i18n/race-export-sv";
import { saveVerifiedDownload } from "../../lib/verified-download";
import { Button, Notice, Section } from "../ui";
import type { Workspace } from "./workspace-state";

/** Filnamnet ur svarets `content-disposition` (servern bildar det av tävlingens namn och datum). */
function fileName(response: Response): string {
  const match = /filename="([a-z0-9.-]{1,120})"/.exec(response.headers.get("content-disposition") ?? "");
  return match?.[1] ?? "otid-tavling.json";
}

/**
 * Inställningar → "Exportera tävlingen" (PLAN.md steg 27, `docs/export.md`): en JSON-fil med allt om loppet (banor, klasser,
 * anmälda, starttider, råa avläsningar, resultat och historik). Bara administratören.
 */
export function RaceExportSection({ ws }: { ws: Workspace }) {
  const { assertCurrent, beginRequest, current, finish, pending, raceId, request, requireSession, saving, workflowLocked, writingRef } = ws;
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  async function download() {
    if (writingRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setMessage(undefined);
    try {
      const response = await request("/export", op);
      if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) throw new Error("Export unavailable");
      await saveVerifiedDownload(response, fileName(response), undefined, () => assertCurrent(op), "application/json;charset=utf-8");
      setMessage({ tone: "ok", text: text.downloaded });
    } catch { if (current(op)) setMessage({ tone: "error", text: text.error }); }
    finally { finish(op); }
  }
  return <Section id={`settings-${raceId}-export`} title={text.title} help={text.help}>
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    <div><Button variant="secondary" disabled={saving || workflowLocked} onClick={() => void download()}>{text.action}</Button></div>
  </Section>;
}
