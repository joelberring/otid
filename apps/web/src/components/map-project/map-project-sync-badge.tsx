"use client";

import { useEffect, useState } from "react";
import { mapProjectEditorEn } from "../../i18n/map-project-en";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import type { Texts } from "../../lib/language";
import { useTexts } from "../language-provider";
import type { useMapProjectEditor } from "./use-map-project-editor";
import styles from "./map-project-editor.module.css";

/** Så länge får ändringar vänta på att sparas innan det blir en varning. */
const STUCK_MS = 20_000;

/**
 * Synkens läge i editorns huvud (utbrutet ur `map-project-editor.tsx`, översynen G1). Ägaren 2026-11-10: texten "Sparar …" och
 * "Sparat" som växlade överst störde. Nu är det en liten prick (fylld = sparat, tom ring = ändringar väntar; texten finns
 * för skärmläsare och när musen står över), och en varning i klartext först när något är fel: utan nät, servern svarar med
 * fel, eller ändringarna har väntat längre än 20 sekunder.
 */
export function SyncBadge({ sync, pending }: { sync: ReturnType<typeof useMapProjectEditor>["sync"]; pending: number }) {
  const text = useTexts(mapProjectEditorSv, mapProjectEditorEn);
  const copy = text.sync;
  const waiting = sync.kind === "syncing" || pending > 0;
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!waiting) { setStuck(false); return; }
    const timer = setTimeout(() => setStuck(true), STUCK_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  const loud = sync.kind === "offline" || sync.kind === "error" || (waiting && stuck);
  const label = sync.kind === "offline" ? copy.offlineShort(pending) : sync.kind === "error" ? copy.error(sync.status ?? 0)
    : waiting && stuck ? copy.stuck(pending)
    : waiting ? `${copy.syncing}${pending ? ` ${copy.pending(pending)}` : ""}` : copy.synced;
  return <p className={loud ? styles.syncLoud : styles.sync} role="status" data-testid="map-project-sync" data-state={sync.kind} data-pending={pending}
    data-loud={loud} title={sync.kind === "offline" ? copy.offline : label}>
    {loud ? label : <><span className={styles.syncDot} data-waiting={waiting || undefined} aria-hidden="true" /><span className={styles.srOnly}>{label}</span></>}
  </p>;
}

const NOTICES = ["noStore", "conflict", "conflictFirst", "rejected", "changedByOther", "proposed"] as const;
export function noticeText(notice: string, text: Texts<typeof mapProjectEditorSv>): string {
  const key = NOTICES.find(value => value === notice);
  return key ? text.sync[key] : notice;
}

