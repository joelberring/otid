"use client";

import { mapProjectEditorEn } from "../../i18n/map-project-en";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import type { Texts } from "../../lib/language";
import { useTexts } from "../language-provider";
import type { useMapProjectEditor } from "./use-map-project-editor";
import styles from "./map-project-editor.module.css";

/** Synkens läge i editorns huvud (utbrutet ur `map-project-editor.tsx`, översynen G1). */
export function SyncBadge({ sync, pending }: { sync: ReturnType<typeof useMapProjectEditor>["sync"]; pending: number }) {
  const text = useTexts(mapProjectEditorSv, mapProjectEditorEn);
  const copy = text.sync;
  const label = sync.kind === "offline" ? copy.offline : sync.kind === "error" ? copy.error(sync.status ?? 0)
    : sync.kind === "syncing" || pending > 0 ? `${copy.syncing}${pending ? ` ${copy.pending(pending)}` : ""}` : copy.synced;
  return <p className={styles.sync} role="status" data-testid="map-project-sync" data-state={sync.kind} data-pending={pending}>{label}</p>;
}

const NOTICES = ["noStore", "conflict", "conflictFirst", "rejected", "changedByOther", "proposed"] as const;
export function noticeText(notice: string, text: Texts<typeof mapProjectEditorSv>): string {
  const key = NOTICES.find(value => value === notice);
  return key ? text.sync[key] : notice;
}

